import { NextRequest, NextResponse } from 'next/server'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error

  const excluded = await prisma.inventoryExcludedProduct.findMany({
    where: { workspaceId: resolved.workspace.id },
    orderBy: { excludedAt: 'desc' },
  })

  return NextResponse.json({ excluded })
}

export async function POST(req: NextRequest) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error

  const body = await req.json()
  const { productId, optionId, reason } = body as { productId: string; optionId: string; reason?: string }

  if (!optionId) {
    return errorResponse('optionId가 필요합니다', 400)
  }

  const record = await prisma.inventoryExcludedProduct.upsert({
    where: {
      workspaceId_optionId: {
        workspaceId: resolved.workspace.id,
        optionId,
      },
    },
    create: {
      workspaceId: resolved.workspace.id,
      productId: productId || '',
      optionId,
      reason: reason ?? null,
    },
    update: {
      reason: reason ?? undefined,
    },
  })

  return NextResponse.json({ excluded: record })
}

export async function DELETE(req: NextRequest) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error

  const body = await req.json()
  const { optionId } = body as { optionId: string }

  if (!optionId) {
    return errorResponse('optionId가 필요합니다', 400)
  }

  await prisma.inventoryExcludedProduct.deleteMany({
    where: {
      workspaceId: resolved.workspace.id,
      optionId,
    },
  })

  return NextResponse.json({ success: true })
}
