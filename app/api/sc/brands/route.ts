import { NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

// 브랜드 원본은 seller-hub Brand 테이블. 세일즈 콘텐츠는 읽기만 한다(목록 관리는 seller-hub).
export async function GET() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const brands = await prisma.brand.findMany({
    where: { spaceId: resolved.space.id },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  })
  return NextResponse.json({ brands })
}
