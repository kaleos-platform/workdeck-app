/**
 * POST /api/sc/products/extract — 상품 링크에서 상품 정보 초안을 뽑는다.
 *
 * 저장은 하지 않고 초안만 반환한다. 실제 생성은 클라이언트 폼이 기존
 * POST /api/sc/products 로 한다(사용자가 검토·수정한 값으로).
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { fetchPageHtml, CrawlError } from '@/lib/bo/crawler'
import { htmlToText, HTML_TEXT_MAX_CHARS } from '@/lib/sh/html-to-text'
import { generateTextForSpace, AiNotConfiguredError, ByokKeyError } from '@/lib/ai/resolve'
import { TextQuotaExceededError } from '@/lib/ai/credit'
import {
  productExtractRequestSchema,
  productExtractSchema,
  normalizeExtracted,
} from '@/lib/sc/product-import/schemas'
import {
  PRODUCT_EXTRACT_SYSTEM_PROMPT,
  buildProductExtractPrompt,
} from '@/lib/sc/product-import/prompts'

export const maxDuration = 120

// 봇 차단·JS 렌더링 페이지는 200 + 빈 껍데기로 오는 경우가 많다.
// 상태코드만 보면 주 타깃(쿠팡·스마트스토어)을 놓치므로 본문 길이로도 판정한다.
// 실측: 스마트스토어는 로그인 페이지로 보내는데 그 폼 텍스트가 390자였다 —
// 길이 문턱만으로는 못 거르므로 아래 추출 결과 공백 판정과 2중으로 막는다.
const MIN_USABLE_TEXT = 600
const BLOCKED_STATUSES = new Set([401, 403, 405, 406, 429, 503])

function parseDraftJson(content: string) {
  const stripped = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  try {
    const parsed = productExtractSchema.safeParse(JSON.parse(stripped))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }
  const parsed = productExtractRequestSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('상품 URL 또는 상세 내용을 입력하세요', 400, {
      issues: parsed.error.flatten(),
    })
  }
  const { url, pastedText } = parsed.data

  // ── 1. 소재 확보 — 붙여넣기가 있으면 크롤을 건너뛴다
  let sourceText: string
  let sourceLabel: string

  if (pastedText) {
    sourceText = pastedText
    sourceLabel = url ?? '붙여넣은 상세 내용'
  } else if (url) {
    try {
      const page = await fetchPageHtml(url)
      const extracted = htmlToText(page.html, HTML_TEXT_MAX_CHARS, { baseUrl: url })
      if (extracted.text.trim().length < MIN_USABLE_TEXT) {
        return errorResponse(
          '이 페이지에서는 상품 정보를 읽지 못했습니다. 브라우저에서 상세 내용을 복사해 붙여넣어 주세요',
          422,
          { recovery: 'paste' }
        )
      }
      sourceText = extracted.title ? `${extracted.title}\n\n${extracted.text}` : extracted.text
      sourceLabel = url
    } catch (err) {
      if (err instanceof CrawlError) {
        if (err.code === 'INVALID_URL') return errorResponse('올바른 상품 URL을 입력하세요', 400)
        if (err.code === 'BLOCKED_HOST') return errorResponse('접근할 수 없는 주소입니다', 400)
        if (err.status && BLOCKED_STATUSES.has(err.status)) {
          return errorResponse(
            '이 사이트는 자동 수집을 차단합니다. 브라우저에서 상세 내용을 복사해 붙여넣어 주세요',
            422,
            { recovery: 'paste' }
          )
        }
        return errorResponse(
          '페이지를 가져오지 못했습니다. 상세 내용을 붙여넣어 주세요',
          422,
          { recovery: 'paste' }
        )
      }
      throw err
    }
  } else {
    return errorResponse('상품 URL 또는 상세 내용을 입력하세요', 400)
  }

  // ── 2. AI 추출
  const userPrompt = buildProductExtractPrompt({ sourceLabel, text: sourceText })

  try {
    let raw: ReturnType<typeof parseDraftJson> = null
    let providerName = 'unknown'
    let model: string | null | undefined
    let contentPreview = ''

    // JSON 파싱/검증 실패 시 1회 재시도
    for (let attempt = 0; attempt < 2 && !raw; attempt++) {
      const { result, providerName: pn } = await generateTextForSpace(spaceId, {
        system: PRODUCT_EXTRACT_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
        responseFormat: 'json',
        maxTokens: 4096,
        temperature: 0.2,
      })
      providerName = pn
      model = result.model
      contentPreview = result.content.slice(0, 500)
      raw = parseDraftJson(result.content)
    }

    await prisma.textGenerationLog.create({
      data: {
        spaceId,
        userId: resolved.user.id,
        provider: providerName,
        model: model ?? null,
        responseFormat: 'json',
        status: raw ? 'SUCCEEDED' : 'FAILED',
        contentPreview,
        errorMessage: raw ? null : '상품 추출 JSON 검증 실패',
      },
    })

    if (!raw) {
      return errorResponse('상품 정보를 해석하지 못했습니다. 직접 입력해주세요', 502)
    }

    const draft = normalizeExtracted(raw)
    // 로그인 벽·안내 페이지를 읽으면 모델이 형식만 맞는 빈 JSON 을 준다.
    // 빈 폼을 성공처럼 띄우지 않고 붙여넣기로 유도한다.
    if (!draft.name && draft.customFields.length === 0) {
      return errorResponse(
        '페이지에서 상품 정보를 찾지 못했습니다. 브라우저에서 상세 내용을 복사해 붙여넣어 주세요',
        422,
        { recovery: 'paste' }
      )
    }

    return NextResponse.json({ draft })
  } catch (error) {
    if (error instanceof AiNotConfiguredError) {
      return errorResponse('AI 공급자를 먼저 설정해주세요', 409, { settingsPath: '/settings/ai' })
    }
    if (error instanceof ByokKeyError) {
      return errorResponse('AI 키에 문제가 있습니다. 설정에서 다시 등록해주세요', 400, {
        settingsPath: '/settings/ai',
      })
    }
    if (error instanceof TextQuotaExceededError) {
      return errorResponse('이번 달 AI 사용량을 모두 사용했습니다', 429, {
        settingsPath: '/settings/ai',
      })
    }
    const message = error instanceof Error ? error.message : String(error)
    await prisma.textGenerationLog
      .create({
        data: {
          spaceId,
          userId: resolved.user.id,
          provider: 'unknown',
          responseFormat: 'json',
          status: 'FAILED',
          errorMessage: message.slice(0, 500),
        },
      })
      .catch(() => {})
    return errorResponse('상품 정보 추출에 실패했습니다', 502, { detail: message })
  }
}
