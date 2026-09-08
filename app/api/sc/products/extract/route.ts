import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { SafeFetchError } from '@/lib/net/safe-fetch'
import { AiNotConfiguredError, ByokKeyError } from '@/lib/ai/resolve'
import { TextQuotaExceededError } from '@/lib/ai/credit'
import { productExtractRequestSchema } from '@/lib/sc/product-import/schemas'
import {
  EmptyProductSourceError,
  extractSalesProduct,
  readProductPage,
} from '@/lib/sc/product-import/extract'

export const maxDuration = 180

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error
  const body: unknown = await req.json().catch(() => null)
  const parsed = productExtractRequestSchema.safeParse(body)
  if (!parsed.success) return errorResponse('상품 URL 또는 상세 내용을 입력하세요', 400)
  const { url, pastedText } = parsed.data
  try {
    const source = pastedText
      ? { text: pastedText, imageUrls: [], sourceUrl: url }
      : await readProductPage(url!)
    const result = await extractSalesProduct(resolved.space.id, source)
    await prisma.textGenerationLog.create({
      data: {
        spaceId: resolved.space.id,
        userId: resolved.user.id,
        provider: result.providerName,
        model: result.model ?? null,
        responseFormat: 'json',
        status: 'SUCCEEDED',
        contentPreview: result.draft.name,
      },
    })
    return NextResponse.json({
      draft: result.draft,
      imageAnalysis: result.imageAnalysis,
      warnings: result.draft.warnings,
    })
  } catch (error) {
    if (error instanceof AiNotConfiguredError || error instanceof ByokKeyError)
      return errorResponse(error.message, 409, { settingsPath: '/settings/ai' })
    if (error instanceof TextQuotaExceededError)
      return errorResponse('이번 달 AI 사용량을 모두 사용했습니다', 429, {
        settingsPath: '/settings/ai',
      })
    if (error instanceof SafeFetchError) {
      if (
        [
          'INVALID_URL',
          'SCHEME_NOT_ALLOWED',
          'USERINFO_NOT_ALLOWED',
          'PORT_NOT_ALLOWED',
          'PRIVATE_ADDRESS',
          'DNS_FAILED',
        ].includes(error.code)
      )
        return errorResponse('접근할 수 없는 상품 URL입니다', 400)
      return errorResponse(
        '상품 페이지를 읽지 못했습니다. 상세 내용을 붙여넣거나 초기 설정에 PDF·Markdown 자료를 등록해주세요',
        422,
        { recovery: 'paste' }
      )
    }
    if (error instanceof EmptyProductSourceError)
      return errorResponse(error.message, 422, { recovery: 'paste' })
    await prisma.textGenerationLog
      .create({
        data: {
          spaceId: resolved.space.id,
          userId: resolved.user.id,
          provider: 'unknown',
          responseFormat: 'json',
          status: 'FAILED',
          errorMessage: (error instanceof Error ? error.message : '상품 분석 실패').slice(0, 500),
        },
      })
      .catch(() => {})
    return errorResponse('상품 분석에 실패했습니다. AI 설정을 확인한 뒤 다시 시도해주세요', 502)
  }
}
