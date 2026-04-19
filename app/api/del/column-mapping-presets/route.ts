import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

// preset mapping 항목 타입
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

// 조회: 현재 space의 모든 프리셋
export async function GET() {
  const resolved = await resolveDeckContext('delivery-mgmt')
  if ('error' in resolved) return resolved.error

  const presets = await prisma.delColumnMappingPreset.findMany({
    where: { spaceId: resolved.space.id },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, name: true, mapping: true, updatedAt: true },
  })

  return NextResponse.json({ presets })
}

// 저장: 이름이 같으면 upsert, 다르면 새로 생성
export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('delivery-mgmt')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => ({}))
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const mapping: unknown = body?.mapping

  if (!name) return errorResponse('프리셋 이름이 필요합니다', 400)
  if (name.length > 100) return errorResponse('프리셋 이름은 100자 이하여야 합니다', 400)
  if (!isValidMapping(mapping)) {
    return errorResponse('유효하지 않은 매핑 형식입니다', 400)
  }

  const preset = await prisma.delColumnMappingPreset.upsert({
    where: {
      spaceId_name: { spaceId: resolved.space.id, name },
    },
    update: { mapping },
    create: {
      spaceId: resolved.space.id,
      name,
      mapping,
    },
    select: { id: true, name: true, mapping: true, updatedAt: true },
  })

  return NextResponse.json({ preset }, { status: 201 })
}
