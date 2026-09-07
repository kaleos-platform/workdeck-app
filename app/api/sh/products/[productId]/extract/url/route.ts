// POST: 사용자가 입력한 상품 상세페이지 URL을 SSRF 가드로 안전하게 가져와 평문으로 변환한다.
// 결과는 저장하지 않고 그대로 클라이언트에 반환 — 최종 추출 요청(extract/route.ts POST)에서
// urlText 로 되돌려 받아 소재로 사용한다.

import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { safeFetchHtml, SafeFetchError } from '@/lib/net/safe-fetch'
import { htmlToText } from '@/lib/sh/html-to-text'
import { productExtractUrlSchema } from '@/lib/sh/schemas'

export const runtime = 'nodejs'
export const maxDuration = 30

type Params = { params: Promise<{ productId: string }> }

// SafeFetchError 코드 → 사용자에게 보여줄 한국어 메시지.
// 내부 IP나 해석된 주소는 절대 노출하지 않는다 — 에러 원문 대신 고정 메시지만 사용.
function mapSafeFetchError(err: SafeFetchError): string {
  switch (err.code) {
    case 'PRIVATE_ADDRESS':
    case 'SCHEME_NOT_ALLOWED':
    case 'USERINFO_NOT_ALLOWED':
    case 'PORT_NOT_ALLOWED':
      return '접근할 수 없는 주소입니다'
    case 'INVALID_URL':
      return 'URL 형식이 올바르지 않습니다'
    case 'DNS_FAILED':
      return '주소를 확인할 수 없습니다'
    case 'TOO_MANY_REDIRECTS':
      return '리다이렉트가 너무 많습니다'
    case 'TIMEOUT':
      return '페이지 응답이 너무 느립니다'
    case 'CONTENT_TYPE_NOT_ALLOWED':
      return 'HTML 페이지가 아닙니다'
    case 'HTTP_ERROR':
      return '페이지를 불러올 수 없습니다'
    case 'FETCH_FAILED':
    default:
      return '페이지를 가져오는 중 오류가 발생했습니다'
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId } = await params
  const product = await prisma.invProduct.findFirst({
    where: { id: productId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!product) return errorResponse('상품을 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = productExtractUrlSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  try {
    const { finalUrl, html, truncated: fetchTruncated } = await safeFetchHtml(parsed.data.url)
    // baseUrl 을 넘겨야 상대경로·프로토콜상대(//) 이미지가 절대 URL 로 정규화된다.
    const {
      title,
      text,
      truncated: textTruncated,
      imageUrls,
    } = htmlToText(html, undefined, { baseUrl: finalUrl })
    // 한국 상세페이지는 소재·인증 같은 핵심 정보가 본문이 아니라 상세 이미지 안에 있다.
    // URL 만으로는 그 정보를 못 읽으므로 이미지 후보를 함께 돌려주고, 추출 단계에서
    // 내려받아 멀티모달 입력으로 넣는다.
    return NextResponse.json({
      title,
      text,
      finalUrl,
      truncated: fetchTruncated || textTruncated,
      imageUrls,
    })
  } catch (err) {
    if (err instanceof SafeFetchError) {
      return errorResponse(mapSafeFetchError(err), 400, { code: err.code })
    }
    const detail = err instanceof Error ? err.message : String(err)
    console.error('[extract/url] fetch 실패', { productId, detail })
    return errorResponse('페이지를 가져오는 중 오류가 발생했습니다', 500)
  }
}
