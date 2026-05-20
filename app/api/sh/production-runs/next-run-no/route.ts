import { NextResponse } from 'next/server'

import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

// 현재 연도 기준 `YYYY-NNN` 다음 차수 번호 반환
export async function GET() {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const year = new Date().getFullYear()
  const prefix = `${year}-`

  const latest = await prisma.productionRun.findFirst({
    where: {
      spaceId: resolved.space.id,
      runNo: { startsWith: prefix },
    },
    orderBy: { runNo: 'desc' },
    select: { runNo: true },
  })

  let nextSeq = 1
  if (latest) {
    const suffix = latest.runNo.slice(prefix.length)
    const parsed = parseInt(suffix, 10)
    if (!Number.isNaN(parsed) && parsed > 0) {
      nextSeq = parsed + 1
    }
  }

  const runNo = `${prefix}${String(nextSeq).padStart(3, '0')}`
  return NextResponse.json({ runNo })
}
