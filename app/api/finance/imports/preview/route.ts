/**
 * POST /api/finance/imports/preview
 * 업로드 파일(.xlsx/.xls/.csv)을 파싱해 미리보기 + 출처/종류 자동 인식 + 헤더 자동 매핑 +
 * 저장된 매핑 프리셋 매칭 + 계좌 후보를 반환한다(단일 화면 업로드용 — 아직 적재하지 않음).
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { toNumOrNull } from '@/lib/finance/serialize'
import { previewFinanceFile, extractFirstTxn } from '@/lib/finance/parser'
import {
  detectKind,
  guessInstitution,
  autoMapFinHeaders,
  findBestPreset,
  extractCardNumberColumn,
  resolveMapping,
  type PresetLike,
  type MappingPair,
} from '@/lib/finance/automap'

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('finance', { write: true })
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  const sheetName =
    typeof form?.get('sheetName') === 'string' ? String(form.get('sheetName')) : undefined
  if (!(file instanceof File)) return errorResponse('파일이 필요합니다', 400)

  // 파일 크기 제한(10MB) — arrayBuffer() 로드 전에 체크해 OOM/타임아웃 방지.
  if (file.size > 10 * 1024 * 1024) {
    return errorResponse('파일 크기가 10MB를 초과합니다. 더 작은 파일을 사용하세요', 413)
  }

  let preview
  let dataRows: unknown[][] = []
  try {
    const buffer = await file.arrayBuffer()
    // dataRows 는 계좌 추론에만 쓰고 응답에서 제외한다(수천 행 페이로드 방지)
    const { dataRows: rawRows, ...rest } = previewFinanceFile(buffer, sheetName)
    preview = rest
    dataRows = rawRows
  } catch {
    return errorResponse('파일을 읽을 수 없습니다. 형식을 확인하세요(.xlsx/.xls/.csv)', 400)
  }

  const kind = detectKind(preview.headers)
  // 카드 export는 카드번호가 preamble이 아닌 행 컬럼인 경우가 많다 — 컬럼에서 보강
  if (kind === 'CARD' && !preview.preamble.accountNumber) {
    const cardNo = extractCardNumberColumn(preview.headers, preview.sampleRows)
    if (cardNo) preview.preamble.accountNumber = cardNo
  }
  const institution = guessInstitution(file.name)
  const suggestedMapping = autoMapFinHeaders(preview.headers, kind)

  // 후보 집합은 저장 경로(commit-staging)와 **동일하게 kind 필터 없이** 헤더로만 고른다.
  // kind로 좁히면 두 경로의 kind 의미가 달라(여기=detectKind 휴리스틱, 저장=사용자 선택 계좌
  // 종류) 저장한 프리셋이 다시는 매칭되지 않는 사각지대가 생긴다. 헤더 서명이 이미 은행/카드를
  // 충분히 구분한다. orderBy는 findBestPreset의 동점 tie-break를 안정화한다.
  const presets = await prisma.finMappingPreset.findMany({
    where: { spaceId },
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    select: {
      id: true,
      name: true,
      institution: true,
      kind: true,
      mapping: true,
      defaultAccountId: true,
      updatedAt: true,
    },
  })
  const matchedPreset = findBestPreset(presets as PresetLike[], preview.headers)

  const accountRows = await prisma.finAccount.findMany({
    where: { spaceId },
    select: {
      id: true,
      name: true,
      kind: true,
      institution: true,
      holder: true,
      accountNumber: true,
      openingBalance: true,
      currentBalance: true,
      currentBalanceAsOf: true,
    },
    orderBy: { createdAt: 'asc' },
  })
  const accounts = accountRows.map((a) => ({
    ...a,
    openingBalance: toNumOrNull(a.openingBalance),
    currentBalance: toNumOrNull(a.currentBalance),
  }))

  // ── 적재 계좌 추론·검증 ────────────────────────────────────────────────────
  // 신한 grid export 처럼 파일에 계좌번호가 없는 형식에서, 어느 계좌의 내역인지 판단할
  // 근거를 만든다. 추정 매핑(프리셋 > automap) 기준으로 가장 오래된 거래 1건을 뽑아
  //   exact   = 그 거래가 이미 있는 계좌 (재업로드 — 가장 흔하고 가장 확실)
  //   balance = 그 거래 직전 잔액이 이어지는 계좌 (신규 구간)
  // 두 판정을 계좌별로 내려준다. 선택은 사용자가 하고, 서버는 근거만 제공한다.
  const presetPairs = Array.isArray(matchedPreset?.mapping)
    ? (matchedPreset.mapping as MappingPair[])
    : null
  const probeMapping = resolveMapping(preview.headers, presetPairs ?? suggestedMapping)
  const firstTxn = extractFirstTxn(dataRows, probeMapping, kind)

  const accountHints: Record<string, 'exact' | 'balance'> = {}
  if (firstTxn) {
    const at = new Date(firstTxn.txnDate.replace(' ', 'T'))
    // ① 같은 거래가 이미 있는 계좌 — identityKey 구성요소 전부 일치
    if (firstTxn.balanceAfter != null) {
      const same = await prisma.finTransaction.findMany({
        where: {
          spaceId,
          txnDate: at,
          direction: firstTxn.direction,
          amount: firstTxn.amount,
          balanceAfter: firstTxn.balanceAfter,
        },
        select: { accountId: true },
        distinct: ['accountId'],
      })
      for (const t of same) accountHints[t.accountId] = 'exact'

      // ② 잔액이 이어지는 계좌 — 이 거래 직전 잔액과 각 계좌의 직전 거래 잔액 비교
      const balanceBefore =
        firstTxn.direction === 'IN'
          ? firstTxn.balanceAfter - firstTxn.amount
          : firstTxn.balanceAfter + firstTxn.amount
      const prior = await prisma.$queryRaw<{ accountId: string; balanceAfter: unknown }[]>`
        select distinct on ("accountId") "accountId", "balanceAfter"
        from "FinTransaction"
        where "spaceId" = ${spaceId} and "txnDate" < ${at} and "balanceAfter" is not null
        order by "accountId", "txnDate" desc
      `
      for (const row of prior) {
        if (accountHints[row.accountId]) continue
        if (toNumOrNull(row.balanceAfter as never) === balanceBefore)
          accountHints[row.accountId] = 'balance'
      }
    }
  }

  return NextResponse.json({
    fileName: file.name,
    /** 파일 最古 거래(BANK만) — 계좌 추론·잔액 검증 근거. 없으면 null */
    firstTxn,
    /** { accountId: 'exact' | 'balance' } — 추론 근거. 비어 있으면 판단 불가 */
    accountHints,
    preview, // headers, sampleRows, totalRows, emptyColumns, sheetNames, activeSheet, preamble
    kind, // 자동 판별(BANK|CARD)
    institution, // 파일명 추정(없으면 null)
    suggestedMapping, // [{ headerName, field }]
    matchedPreset, // 헤더 서명 일치 프리셋(없으면 null)
    accounts, // 계좌 후보 — 사용자가 적재할 계좌 선택
  })
}
