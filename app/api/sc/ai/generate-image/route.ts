import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { selectImageProvider } from '@/lib/ai/providers'
import {
  reserveImageCredit,
  commitImageCredit,
  refundImageCredit,
  CreditExceededError,
} from '@/lib/ai/credit'

const bodySchema = z.object({
  prompt: z.string().min(1).max(4000),
  negativePrompt: z.string().max(2000).optional(),
  aspectRatio: z.enum(['1:1', '3:4', '4:3', '9:16', '16:9']).optional(),
})

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return errorResponse('요청 본문이 올바르지 않습니다', 400, {
      issues: parsed.error.flatten(),
    })
  }

  let provider
  try {
    provider = selectImageProvider()
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : '이미지 AI 공급자 미구성', 503)
  }

  let reservation
  try {
    reservation = await reserveImageCredit({
      spaceId: resolved.space.id,
      userId: resolved.user.id,
      provider: provider.name,
      model: process.env.GEMINI_IMAGE_MODEL ?? 'imagen-4.0-generate-001',
      prompt: parsed.data.prompt,
      negativePrompt: parsed.data.negativePrompt,
      aspectRatio: parsed.data.aspectRatio,
    })
  } catch (error) {
    if (error instanceof CreditExceededError) {
      return errorResponse('월간 이미지 크레딧이 소진되었습니다', 403, {
        code: error.code,
        yearMonth: error.yearMonth,
      })
    }
    throw error
  }

  try {
    const result = await provider.generate({
      prompt: parsed.data.prompt,
      negativePrompt: parsed.data.negativePrompt,
      aspectRatio: parsed.data.aspectRatio,
      numberOfImages: 1,
    })
    await commitImageCredit(reservation.reservationId, {
      outputCount: result.images.length,
    })
    return NextResponse.json({
      reservationId: reservation.reservationId,
      model: result.model,
      latencyMs: result.latencyMs,
      images: result.images.map((img) => ({
        mimeType: img.mimeType,
        base64: img.bytes.toString('base64'),
      })),
      credit: {
        yearMonth: reservation.yearMonth,
        imageUsed: reservation.imageUsedAfter,
        imageQuota: reservation.imageQuota,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await refundImageCredit(reservation.reservationId, { errorMessage: message })
    return errorResponse('이미지 생성에 실패했습니다', 502, { detail: message })
  }
}
