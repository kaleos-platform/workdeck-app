/**
 * POST /api/finance/imports/preview
 * 업로드 파일(.xlsx/.xls/.csv)을 파싱해 미리보기 + 출처/종류 자동 인식 + 헤더 자동 매핑 +
 * 저장된 매핑 프리셋 매칭 + 계좌 후보를 반환한다(단일 화면 업로드용 — 아직 적재하지 않음).
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { previewFinanceFile } from '@/lib/finance/parser'
import {
  detectKind,
  guessInstitution,
  autoMapFinHeaders,
  findBestPreset,
  type PresetLike,
} from '@/lib/finance/automap'

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  const sheetName =
    typeof form?.get('sheetName') === 'string' ? String(form.get('sheetName')) : undefined
  if (!(file instanceof File)) return errorResponse('파일이 필요합니다', 400)

  let preview
  try {
    const buffer = await file.arrayBuffer()
    preview = previewFinanceFile(buffer, sheetName)
  } catch {
    return errorResponse('파일을 읽을 수 없습니다. 형식을 확인하세요(.xlsx/.xls/.csv)', 400)
  }

  const kind = detectKind(preview.headers)
  const institution = guessInstitution(file.name)
  const suggestedMapping = autoMapFinHeaders(preview.headers, kind)

  const presets = await prisma.finMappingPreset.findMany({
    where: { spaceId },
    select: {
      id: true,
      name: true,
      institution: true,
      kind: true,
      mapping: true,
      defaultAccountId: true,
    },
  })
  const matchedPreset = findBestPreset(presets as PresetLike[], preview.headers)

  const accounts = await prisma.finAccount.findMany({
    where: { spaceId },
    select: { id: true, name: true, kind: true, institution: true, accountNumber: true },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json({
    fileName: file.name,
    preview, // headers, sampleRows, totalRows, emptyColumns, sheetNames, activeSheet, preamble
    kind, // 자동 판별(BANK|CARD)
    institution, // 파일명 추정(없으면 null)
    suggestedMapping, // [{ headerName, field }]
    matchedPreset, // 헤더 서명 일치 프리셋(없으면 null)
    accounts, // 계좌 후보 — 사용자가 적재할 계좌 선택
  })
}
