import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { DEFAULT_PRODUCTION_LEAD_TIME_DAYS } from '@/lib/inv/reorder-calculator'

const DEFAULTS = {
  leadTimeDays: DEFAULT_PRODUCTION_LEAD_TIME_DAYS,
  analysisWindowDays: 90,
  targetCoverDays: 30,
}

const FORECAST_MODELS = ['MA30', 'MA90', 'MA_BLEND', 'SES_TREND', 'CROSTON']

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
    analysisWindowDays: cfg?.analysisWindowDays ?? DEFAULTS.analysisWindowDays,
    targetCoverDays: cfg?.targetCoverDays ?? DEFAULTS.targetCoverDays,
    excludeFromForecast: cfg?.excludeFromForecast ?? false,
    forecastModel: cfg?.forecastModel ?? null,
    isDefault: !cfg,
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const resolved = await resolveDeckContext('seller-hub', { write: true })
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
  const analysisWindowDays = toInt(body.analysisWindowDays)

  if (leadTimeDays !== undefined && leadTimeDays < 0) {
    return errorResponse('leadTimeDays는 0 이상이어야 합니다', 400)
  }
  if (analysisWindowDays !== undefined && analysisWindowDays < 1) {
    return errorResponse('analysisWindowDays는 1 이상이어야 합니다', 400)
  }

  // 목표 커버일수: 1~365 정수만 허용 (toInt 절삭 없이 엄격 검증)
  let targetCoverDays: number | undefined
  if (body.targetCoverDays !== undefined) {
    const n = body.targetCoverDays
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 365) {
      return errorResponse('targetCoverDays는 1~365 정수여야 합니다', 400)
    }
    targetCoverDays = n
  }

  let forecastModel: string | null | undefined
  if (body.forecastModel !== undefined) {
    if (body.forecastModel !== null && !FORECAST_MODELS.includes(body.forecastModel as string)) {
      return errorResponse('forecastModel이 유효하지 않습니다', 400)
    }
    forecastModel = body.forecastModel as string | null
  }

  if (body.excludeFromForecast !== undefined && typeof body.excludeFromForecast !== 'boolean') {
    return errorResponse('excludeFromForecast는 boolean이어야 합니다', 400)
  }
  const excludeFromForecast = body.excludeFromForecast as boolean | undefined

  const existing = await prisma.invReorderConfig.findUnique({ where: { productId } })

  const merged = {
    leadTimeDays: leadTimeDays ?? existing?.leadTimeDays ?? DEFAULTS.leadTimeDays,
    analysisWindowDays:
      analysisWindowDays ?? existing?.analysisWindowDays ?? DEFAULTS.analysisWindowDays,
    targetCoverDays: targetCoverDays ?? existing?.targetCoverDays ?? DEFAULTS.targetCoverDays,
    excludeFromForecast: excludeFromForecast ?? existing?.excludeFromForecast ?? false,
    forecastModel: forecastModel !== undefined ? forecastModel : (existing?.forecastModel ?? null),
  }

  const cfg = await prisma.invReorderConfig.upsert({
    where: { productId },
    create: { productId, ...merged },
    update: merged,
  })

  return NextResponse.json({
    productId: cfg.productId,
    leadTimeDays: cfg.leadTimeDays,
    analysisWindowDays: cfg.analysisWindowDays,
    targetCoverDays: cfg.targetCoverDays,
    excludeFromForecast: cfg.excludeFromForecast,
    forecastModel: cfg.forecastModel,
    isDefault: false,
  })
}
