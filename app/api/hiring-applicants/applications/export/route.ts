// 지원자 엑셀 내보내기 — PII 복호화 포함이므로 쓰기 권한(hiring-applicants) + spaceId 스코프.
// 서버에서만 복호화하고 xlsx 바이너리로 스트림한다(복호화 값이 클라이언트 번들로 넘어가지 않음).
import { NextRequest } from 'next/server'
import * as XLSX from 'xlsx'
import { prisma } from '@/lib/prisma'
import { resolveDeckContext, assertRole, errorResponse } from '@/lib/api-helpers'
import { decryptApplicationPii, type ApplicationEntryValue } from '@/lib/hiring/pii'
import { STAGE_LABELS, PROCESS_STAGE_LABELS } from '@/lib/hiring/applications'
import type { HiringApplicationStage } from '@/generated/prisma/client'

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
  const from = fromRaw ? new Date(fromRaw) : undefined
  const to = toRaw ? new Date(new Date(toRaw).getTime() + 24 * 60 * 60 * 1000 - 1) : undefined

  const applications = await prisma.hiringApplication.findMany({
    where: {
      spaceId,
      deletedAt: null,
      ...(posting ? { postingId: posting } : {}),
      ...(stage ? { stage } : {}),
      ...(from || (to && !Number.isNaN(to.getTime()))
        ? {
            createdAt: {
              ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}),
              ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}),
            },
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: { posting: { select: { title: true } } },
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

  const rows = applications.map((app) => {
    const pii = decryptApplicationPii(app)
    const base: Record<string, string> = {
      이름: pii.name ?? '',
      전화: pii.phone ?? '',
      이메일: pii.email ?? '',
      주소: pii.address ?? '',
      공고: app.posting?.title ?? '',
      결과: STAGE_LABELS[app.stage],
      단계: PROCESS_STAGE_LABELS[app.hiringStage],
      지원일: app.createdAt.toISOString().slice(0, 10),
    }
    const entries = (app.applicationEntries as ApplicationEntryValue[] | null) ?? []
    const byKey = new Map(entries.map((e) => [e.key, e]))
    for (const [key, label] of customLabels) {
      const e = byKey.get(key)
      const val = e?.value
      base[label] = Array.isArray(val) ? val.join(', ') : typeof val === 'string' ? val : ''
    }
    return base
  })

  const worksheet = XLSX.utils.json_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, '지원자')
  const buf: Buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })

  const filename = `applicants_${new Date().toISOString().slice(0, 10)}.xlsx`
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
