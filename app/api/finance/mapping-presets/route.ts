import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

const VALID_KINDS = ['BANK', 'CARD'] as const
type AccountKind = (typeof VALID_KINDS)[number]

// 매핑 항목 타입
type PresetMappingEntry = {
  headerName: string
  field: string
}

function isValidMapping(value: unknown): value is PresetMappingEntry[] {
  if (!Array.isArray(value)) return false
  return value.every(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      typeof item.headerName === 'string' &&
      typeof item.field === 'string' &&
      item.headerName.trim() !== '' &&
      item.field.trim() !== ''
  )
}

// 조회: spaceId 기준 매핑 프리셋 전체 (updatedAt desc)
export async function GET() {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const presets = await prisma.finMappingPreset.findMany({
    where: { spaceId },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      name: true,
      institution: true,
      kind: true,
      mapping: true,
      defaultAccountId: true,
      dateFormat: true,
      updatedAt: true,
    },
  })

  return NextResponse.json({ presets })
}

// 저장: (spaceId, name) upsert
export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const body = await req.json().catch(() => ({}))
  const { name, institution, kind, mapping, defaultAccountId, dateFormat } = body as {
    name?: string
    institution?: string
    kind?: string
    mapping?: unknown
    defaultAccountId?: string
    dateFormat?: string
  }

  if (!name || typeof name !== 'string' || name.trim() === '') {
    return errorResponse('프리셋 이름이 필요합니다', 400)
  }
  if (name.trim().length > 100) {
    return errorResponse('프리셋 이름은 100자 이하여야 합니다', 400)
  }
  if (!institution || typeof institution !== 'string' || institution.trim() === '') {
    return errorResponse('금융기관명이 필요합니다', 400)
  }
  if (!kind || !VALID_KINDS.includes(kind as AccountKind)) {
    return errorResponse('kind는 BANK 또는 CARD여야 합니다', 400)
  }
  if (!isValidMapping(mapping)) {
    return errorResponse('유효하지 않은 매핑 형식입니다', 400)
  }

  // defaultAccountId 소유 검증 (nullable)
  if (defaultAccountId) {
    const account = await prisma.finAccount.findFirst({
      where: { id: defaultAccountId, spaceId },
      select: { id: true },
    })
    if (!account) return errorResponse('선택한 계좌를 찾을 수 없습니다', 400)
  }

  const trimmedName = name.trim()

  const preset = await prisma.finMappingPreset.upsert({
    where: { spaceId_name: { spaceId, name: trimmedName } },
    update: {
      institution: institution.trim(),
      kind: kind as AccountKind,
      mapping,
      defaultAccountId: defaultAccountId ?? null,
      dateFormat: dateFormat ?? null,
    },
    create: {
      spaceId,
      name: trimmedName,
      institution: institution.trim(),
      kind: kind as AccountKind,
      mapping,
      defaultAccountId: defaultAccountId ?? null,
      dateFormat: dateFormat ?? null,
    },
    select: {
      id: true,
      name: true,
      institution: true,
      kind: true,
      mapping: true,
      defaultAccountId: true,
      dateFormat: true,
      updatedAt: true,
    },
  })

  return NextResponse.json({ preset }, { status: 201 })
}
