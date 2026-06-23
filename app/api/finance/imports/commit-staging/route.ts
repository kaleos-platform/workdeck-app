/**
 * POST /api/finance/imports/commit-staging
 * 파일 + 매핑 + 계좌로 거래를 파싱 → 규칙 자동 분류 → 기존 거래와 중복 판정 →
 * FinImport(DRAFT) + FinStagedRow[] 적재. (선택) 매핑 프리셋 저장.
 * 실제 거래 확정/중복 처리는 거래 내역 화면(staging/commit)에서 한다.
 *
 * multipart/form-data:
 *   file        업로드 파일(.xlsx/.xls/.csv)
 *   accountId   적재 대상 FinAccount
 *   kind        BANK | CARD
 *   mapping     JSON: Array<{ headerName, field }>
 *   sheetName   (선택) 시트명
 *   savePreset  "true"면 프리셋 저장
 *   presetName  프리셋 이름(savePreset 시)
 *   institution 프리셋 기관명(savePreset 시)
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { previewFinanceFile, parseFinanceWithMapping, type FinKind } from '@/lib/finance/parser'
import { resolveMapping, type MappingPair } from '@/lib/finance/automap'
import { loadSpaceRules, classifyRow } from '@/lib/finance/classify'
import type { FinStagedResolution } from '@/generated/prisma/enums'

/** 'YYYY-MM-DD HH:MM:SS' | 'YYYY-MM-DD' → Date(로컬). */
function toDate(s: string): Date {
  const iso = s.includes(' ') ? s.replace(' ', 'T') : s
  const dt = new Date(iso)
  return Number.isNaN(dt.getTime()) ? new Date(s) : dt
}

function parseMappingPairs(raw: unknown): MappingPair[] | null {
  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!Array.isArray(value)) return null
  const pairs = value.filter(
    (m): m is MappingPair =>
      !!m &&
      typeof m === 'object' &&
      typeof m.headerName === 'string' &&
      typeof m.field === 'string'
  )
  return pairs.length > 0 ? pairs : null
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const form = await req.formData().catch(() => null)
  if (!form) return errorResponse('잘못된 요청입니다', 400)

  const file = form.get('file')
  const accountId = String(form.get('accountId') ?? '')
  const kind = String(form.get('kind') ?? '') as FinKind
  const sheetName =
    typeof form.get('sheetName') === 'string' ? String(form.get('sheetName')) : undefined

  if (!(file instanceof File)) return errorResponse('파일이 필요합니다', 400)
  if (!accountId) return errorResponse('적재할 계좌를 선택하세요', 400)
  if (kind !== 'BANK' && kind !== 'CARD') return errorResponse('계좌 종류가 올바르지 않습니다', 400)

  const pairs = parseMappingPairs(form.get('mapping'))
  if (!pairs) return errorResponse('유효한 컬럼 매핑이 필요합니다', 400)

  // 계좌 소유 검증 + 종류 일치 검증
  const account = await prisma.finAccount.findFirst({
    where: { id: accountId, spaceId },
    select: { id: true, kind: true },
  })
  if (!account) return errorResponse('계좌를 찾을 수 없습니다', 404)
  if (account.kind !== kind) {
    return errorResponse(
      `선택한 계좌(${account.kind === 'BANK' ? '은행' : '카드'})와 업로드 종류(${kind === 'BANK' ? '은행' : '카드'})가 일치하지 않습니다`,
      400
    )
  }

  // 파싱
  let parsed
  let headers: string[]
  let preamble: { periodFrom?: string; periodTo?: string }
  try {
    const buffer = await file.arrayBuffer()
    const preview = previewFinanceFile(buffer, sheetName)
    headers = preview.headers
    preamble = preview.preamble
    const mapping = resolveMapping(headers, pairs)
    parsed = parseFinanceWithMapping(buffer, mapping, kind, accountId, sheetName)
  } catch {
    return errorResponse('파일 파싱에 실패했습니다. 매핑을 확인하세요', 400)
  }

  if (parsed.rows.length === 0) {
    return errorResponse('파싱된 거래가 없습니다. 헤더/매핑을 확인하세요', 400, {
      errors: parsed.errors.slice(0, 10),
    })
  }

  // 기존 거래와 중복 판정 — identityKey 일치 시 contentHash 비교
  const identityKeys = [...new Set(parsed.rows.map((r) => r.identityKey))]
  const existing = await prisma.finTransaction.findMany({
    where: { spaceId, accountId, identityKey: { in: identityKeys } },
    select: { identityKey: true, contentHash: true },
  })
  const existingMap = new Map(existing.map((e) => [e.identityKey, e.contentHash]))

  // 규칙 로드 후 분류
  const rules = await loadSpaceRules(spaceId)

  // 기간(preamble 우선, 없으면 거래일 min/max)
  const dates = parsed.rows.map((r) => toDate(r.txnDate)).sort((a, b) => a.getTime() - b.getTime())
  const periodFrom = preamble.periodFrom ? toDate(preamble.periodFrom) : dates[0]
  const periodTo = preamble.periodTo ? toDate(preamble.periodTo) : dates[dates.length - 1]

  const importRow = await prisma.finImport.create({
    data: {
      spaceId,
      accountId,
      fileName: file.name,
      institution: String(form.get('institution') ?? '') || '미지정',
      kind,
      status: 'DRAFT',
      periodFrom,
      periodTo,
      totalRows: parsed.rows.length,
    },
    select: { id: true },
  })

  // 배치 내 중복도 추적(동일 identityKey 2회 → 두번째는 DUP_SAME)
  const seenInBatch = new Set<string>()
  let cNew = 0
  let cDupSame = 0
  let cDupChanged = 0
  let cClassified = 0
  let cReview = 0
  let cUnclassified = 0

  const stagedData = parsed.rows.map((r) => {
    const cls = classifyRow({ description: r.description, counterparty: r.counterparty }, rules)
    if (cls.classStatus === 'CLASSIFIED') cClassified++
    else if (cls.classStatus === 'REVIEW') cReview++
    else cUnclassified++

    let resolution: FinStagedResolution
    const priorHash = existingMap.get(r.identityKey)
    if (seenInBatch.has(r.identityKey)) {
      resolution = 'DUP_SAME'
      cDupSame++
    } else if (priorHash !== undefined) {
      if (priorHash === r.contentHash) {
        resolution = 'DUP_SAME'
        cDupSame++
      } else {
        resolution = 'DUP_CHANGED'
        cDupChanged++
      }
    } else {
      resolution = 'NEW'
      cNew++
    }
    seenInBatch.add(r.identityKey)

    return {
      importId: importRow.id,
      spaceId,
      accountId,
      raw: {
        sourceRowNumber: r.sourceRowNumber,
        txnDate: r.txnDate,
        description: r.description ?? null,
        counterparty: r.counterparty ?? null,
        amount: r.amount,
        balanceAfter: r.balanceAfter ?? null,
        approvalNo: r.approvalNo ?? null,
        cancelFlag: r.cancelFlag ?? null,
      },
      txnDate: toDate(r.txnDate),
      direction: r.direction,
      amount: r.amount,
      balanceAfter: r.balanceAfter ?? null,
      description: r.description ?? null,
      counterparty: r.counterparty ?? null,
      approvalNo: r.approvalNo ?? null,
      cancelFlag: r.cancelFlag ?? null,
      categoryId: cls.categoryId,
      classStatus: cls.classStatus,
      matchedRuleId: cls.matchedRuleId,
      identityKey: r.identityKey,
      contentHash: r.contentHash,
      resolution,
    }
  })

  await prisma.finStagedRow.createMany({ data: stagedData })

  // 매핑 프리셋 저장(선택)
  if (form.get('savePreset') === 'true') {
    const presetName = String(form.get('presetName') ?? '').trim()
    const institution = String(form.get('institution') ?? '').trim() || '미지정'
    if (presetName) {
      await prisma.finMappingPreset.upsert({
        where: { spaceId_name: { spaceId, name: presetName } },
        update: { institution, kind, mapping: pairs, defaultAccountId: accountId },
        create: {
          spaceId,
          name: presetName,
          institution,
          kind,
          mapping: pairs,
          defaultAccountId: accountId,
        },
      })
    }
  }

  return NextResponse.json(
    {
      importId: importRow.id,
      counts: {
        total: parsed.rows.length,
        new: cNew,
        dupSame: cDupSame,
        dupChanged: cDupChanged,
        classified: cClassified,
        review: cReview,
        unclassified: cUnclassified,
        parseErrors: parsed.errors.length,
      },
    },
    { status: 201 }
  )
}
