// 지원자 엑셀 내보내기 — PII 복호화 포함이므로 쓰기 권한(hiring-applicants) + spaceId 스코프.
// 서버에서만 복호화하고 xlsx 바이너리로 스트림한다(복호화 값이 클라이언트 번들로 넘어가지 않음).
import { projectApplicationHistory } from '@/lib/hiring/migration/application-history'
import { decodeMigrationSnapshot } from '@/lib/hiring/migration/ledger'
import { NextRequest } from 'next/server'
import * as XLSX from 'xlsx'
import { prisma } from '@/lib/prisma'
import { resolveDeckContext, assertRole, errorResponse } from '@/lib/api-helpers'
import { decryptApplicationPii, type ApplicationEntryValue } from '@/lib/hiring/pii'
import { STAGE_LABELS, PROCESS_STAGE_LABELS } from '@/lib/hiring/applications'
import type { HiringApplicationStage } from '@/generated/prisma/client'

import { parseYmdDateKst, formatDateToYmdKst } from '@/lib/date-range'

export const runtime = 'nodejs'

const VALID_STAGES = new Set(['HIRING', 'ACCEPTED', 'REJECTED'])

const EXPORT_ROW_CAP = 2000

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) return resolved.error

  const roleError = assertRole(resolved.role, 'ADMIN')
  if (roleError) return roleError
  const spaceId = resolved.space.id

  const sp = req.nextUrl.searchParams
  const posting = sp.get('posting') || undefined
  const stageRaw = sp.get('stage') || undefined
  const stage =
    stageRaw && VALID_STAGES.has(stageRaw) ? (stageRaw as HiringApplicationStage) : undefined
  const fromRaw = sp.get('from')
  const toRaw = sp.get('to')
  const from = parseYmdDateKst(fromRaw ?? '') ?? undefined
  const toDate = parseYmdDateKst(toRaw ?? '')
  const to = toDate ? new Date(toDate.getTime() + 24 * 60 * 60 * 1000 - 1) : undefined

  const applications = await prisma.hiringApplication.findMany({
    where: {
      spaceId,
      deletedAt: null,
      ...(posting ? { postingId: posting } : {}),
      ...(stage ? { stage } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: {
      posting: { select: { title: true } },
      files: {
        select: { id: true, applicationId: true, spaceId: true, fileName: true, sizeBytes: true },
      },
    },
    // 전량 복호화 export 는 가장 무거운 연산 — 상한으로 메모리/지연 폭주 방지.
    // 초과 시 기간 필터로 나눠 받도록 안내한다.
    take: EXPORT_ROW_CAP + 1,
  })
  if (applications.length > EXPORT_ROW_CAP) {
    return errorResponse(
      `한 번에 내보낼 수 있는 최대 건수(${EXPORT_ROW_CAP.toLocaleString()}건)를 초과했습니다. 기간을 나눠 내보내 주세요`,
      400
    )
  }

  // 커스텀 항목 라벨 수집(컬럼 헤더 안정화)
  const customLabels = new Map<string, string>()
  for (const app of applications) {
    const entries = (app.applicationEntries as ApplicationEntryValue[] | null) ?? []
    for (const e of entries) {
      if (['name', 'phone', 'email', 'address'].includes(e.key)) continue
      if (e.value == null || (Array.isArray(e.value) && e.value.length === 0)) continue
      if (!customLabels.has(e.key)) customLabels.set(e.key, e.label || e.key)
    }
  }

  const headers = ['이름', '전화', '이메일', '주소', '공고', '결과', '단계', '지원일']
  const usedHeaders = new Set(headers)
  for (const label of customLabels.values()) {
    let header = label
    let suffix = 2
    while (usedHeaders.has(header)) header = `${label} (${suffix++})`
    usedHeaders.add(header)
    headers.push(header)
  }

  const rows = applications.map((app) => {
    const pii = decryptApplicationPii(app)
    const row = [
      pii.name ?? '',
      pii.phone ?? '',
      pii.email ?? '',
      pii.address ?? '',
      app.posting?.title ?? '',
      STAGE_LABELS[app.stage],
      PROCESS_STAGE_LABELS[app.hiringStage],
      formatDateToYmdKst(app.createdAt),
    ]
    const entries = (app.applicationEntries as ApplicationEntryValue[] | null) ?? []
    const byKey = new Map(entries.map((e) => [e.key, e]))
    for (const key of customLabels.keys()) {
      const e = byKey.get(key)
      const val = e?.value
      row.push(Array.isArray(val) ? val.join(', ') : typeof val === 'string' ? val : '')
    }
    return row
  })

  // 사용자 라벨을 객체 속성으로 사용하지 않아 중복·특수 이름도 값을 덮어쓰지 않는다.
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows])
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, '지원자')
  // 현재 양식으로 해석하지 않고, 권한 검사를 통과한 지원서의 이전 원문만 별도 제공한다.
  const records = applications.length
    ? await prisma.hiringMigrationRecord.findMany({
        where: {
          spaceId,
          targetModel: 'HiringApplication',
          targetId: { in: applications.map((a) => a.id) },
        },
        select: {
          targetId: true,
          sourceSnapshotAt: true,
          sourceSnapshotEnc: true,
          sourceSnapshotIv: true,
          sourceHash: true,
        },
      })
    : []
  const historyRows: (string | number)[][] = [
    [
      '지원서ID',
      '이름',
      '공고',
      '원본수집일',
      '항목순서',
      '질문',
      '원본유형',
      '원본값',
      '해석',
      '검증된선택라벨',
      '원본기타표시',
      '첨부파일',
      '미확정첨부수',
    ],
  ]
  const appsById = new Map(applications.map((app) => [app.id, app]))
  try {
    for (const record of records) {
      const app = appsById.get(record.targetId)
      if (!app) throw new Error('History scope mismatch')
      const history = projectApplicationHistory(decodeMigrationSnapshot(record), {
        applicationId: app.id,
        spaceId,
        sourceSnapshotAt: record.sourceSnapshotAt.toISOString(),
        files: app.files,
      })
      if (!history) throw new Error('History unavailable')
      const name = decryptApplicationPii(app).name ?? ''
      for (const entry of history.entries) {
        if (entry.kind === 'value' && entry.value.kind === 'unsupported') {
          throw new Error('Unsupported history entry')
        }
        const value =
          entry.kind === 'files'
            ? ''
            : entry.value.kind === 'scalar'
              ? JSON.stringify(entry.value.value)
              : entry.value.kind === 'array'
                ? JSON.stringify(entry.value.values)
                : entry.value.kind === 'missing'
                  ? '값 누락'
                  : '표시할 수 없는 원본 값 형식'
        historyRows.push([
          app.id,
          name,
          app.posting?.title ?? '',
          history.sourceSnapshotAt,
          entry.index + 1,
          entry.label ?? '',
          entry.sourceType ?? '',
          value,
          entry.kind === 'files'
            ? '첨부 대응'
            : entry.interpretation === 'unresolved'
              ? '미확정'
              : entry.interpretation === 'verified'
                ? '검증됨'
                : '원문',
          entry.kind === 'value' ? JSON.stringify(entry.verifiedLabels ?? []) : '',
          entry.otherMarker,
          entry.kind === 'files' ? JSON.stringify(entry.files.map((f) => f.fileName)) : '',
          entry.kind === 'files' ? entry.unresolvedCount : 0,
        ])
      }
    }
  } catch {
    return errorResponse(
      '이전 원문을 확인할 수 없어 내보내기를 중단했습니다. 다시 시도해 주세요',
      422
    )
  }
  if (
    historyRows.some((row) =>
      row.some((value) => typeof value === 'string' && value.length > 32767)
    )
  ) {
    return errorResponse(
      '이전 원문이 엑셀 셀 길이 한도를 초과합니다. 지원자 상세에서 원문을 확인해 주세요',
      422
    )
  }
  if (records.length)
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(historyRows), '이전 원문')
  const buf: Buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })

  const filename = `applicants_${formatDateToYmdKst(new Date())}.xlsx`
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
