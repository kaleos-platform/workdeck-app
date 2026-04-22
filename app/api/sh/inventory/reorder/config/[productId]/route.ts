import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

const DEFAULTS = {
  leadTimeDays: 7,
  safetyStockQty: 0,
  analysisWindowDays: 90,
}

async function assertProductInSpace(productId: string, spaceId: string) {
  const product = await prisma.invProduct.findFirst({
    where: { id: productId, spaceId },
    select: { id: true },
  })
  return product !== null
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId } = await params
  const ok = await assertProductInSpace(productId, resolved.space.id)
  if (!ok) return errorResponse('상품을 찾을 수 없습니다', 404)

  const cfg = await prisma.invReorderConfig.findUnique({ where: { productId } })
  return NextResponse.json({
    productId,
    leadTimeDays: cfg?.leadTimeDays ?? DEFAULTS.leadTimeDays,
    safetyStockQty: cfg?.safetyStockQty ?? DEFAULTS.safetyStockQty,
    analysisWindowDays: cfg?.analysisWindowDays ?? DEFAULTS.analysisWindowDays,
    isDefault: !cfg,
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId } = await params
  const ok = await assertProductInSpace(productId, resolved.space.id)
  if (!ok) return errorResponse('상품을 찾을 수 없습니다', 404)

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return errorResponse('요청 본문이 유효한 JSON이 아닙니다', 400)
  }

  const toInt = (v: unknown): number | undefined => {
    if (v === undefined || v === null) return undefined
    const n = typeof v === 'number' ? v : Number(v)
    if (!Number.isFinite(n)) return undefined
    return Math.trunc(n)
  }

  const leadTimeDays = toInt(body.leadTimeDays)
  const safetyStockQty = toInt(body.safetyStockQty)
  const analysisWindowDays = toInt(body.analysisWindowDays)

  if (leadTimeDays !== undefined && leadTimeDays < 0) {
    return errorResponse('leadTimeDays는 0 이상이어야 합니다', 400)
  }
  if (safetyStockQty !== undefined && safetyStockQty < 0) {
    return errorResponse('safetyStockQty는 0 이상이어야 합니다', 400)
  }
  if (analysisWindowDays !== undefined && analysisWindowDays < 1) {
    return errorResponse('analysisWindowDays는 1 이상이어야 합니다', 400)
  }

  const existing = await prisma.invReorderConfig.findUnique({ where: { productId } })

  const merged = {
    leadTimeDays: leadTimeDays ?? existing?.leadTimeDays ?? DEFAULTS.leadTimeDays,
    safetyStockQty: safetyStockQty ?? existing?.safetyStockQty ?? DEFAULTS.safetyStockQty,
    analysisWindowDays:
      analysisWindowDays ?? existing?.analysisWindowDays ?? DEFAULTS.analysisWindowDays,
  }

  const cfg = await prisma.invReorderConfig.upsert({
    where: { productId },
    create: { productId, ...merged },
    update: merged,
  })

  return NextResponse.json({
    productId: cfg.productId,
    leadTimeDays: cfg.leadTimeDays,
    safetyStockQty: cfg.safetyStockQty,
    analysisWindowDays: cfg.analysisWindowDays,
    isDefault: false,
  })
}
