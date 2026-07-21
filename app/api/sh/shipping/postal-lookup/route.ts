import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import {
  isPostalLookupConfigured,
  isRateLimitError,
  lookupPostalCode,
} from '@/lib/del/postal-lookup'

// 대량 조회 대비 함수 타임아웃 여유 (Vercel)
export const maxDuration = 60

const MAX_ADDRESSES = 100
const CONCURRENCY = 4

type Item = { id: string; address: string }

/**
 * POST /api/sh/shipping/postal-lookup
 * body: { items: { id, address }[] }
 * → 각 주소를 카카오 Local API로 조회해 우편번호 반환.
 * 개별 실패는 null (전체 실패화 금지). 429는 남은 항목 null + rateLimited:true 로 조기 종료.
 */
export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  if (!isPostalLookupConfigured()) {
    return errorResponse('우편번호 조회가 설정되지 않았습니다 (KAKAO_REST_API_KEY 미설정)', 503)
  }

  const body = await req.json().catch(() => ({}))
  const rawItems: unknown = (body as { items?: unknown })?.items
  const items: Item[] = Array.isArray(rawItems)
    ? rawItems
        .filter(
          (it): it is Item =>
            !!it && typeof (it as Item).id === 'string' && typeof (it as Item).address === 'string'
        )
        .map((it) => ({ id: it.id, address: it.address }))
    : []

  if (items.length === 0) return errorResponse('조회할 주소가 없습니다', 400)

  const sliced = items.slice(0, MAX_ADDRESSES)
  const apiKey = process.env.KAKAO_REST_API_KEY!
  const results: { id: string; postalCode: string | null }[] = []
  let rateLimited = false

  for (let i = 0; i < sliced.length && !rateLimited; i += CONCURRENCY) {
    const chunk = sliced.slice(i, i + CONCURRENCY)
    const settled = await Promise.allSettled(
      chunk.map((it) => lookupPostalCode(it.address, apiKey))
    )
    settled.forEach((r, j) => {
      if (r.status === 'rejected') {
        if (isRateLimitError(r.reason)) rateLimited = true
        results.push({ id: chunk[j].id, postalCode: null })
      } else {
        results.push({ id: chunk[j].id, postalCode: r.value })
      }
    })
  }
  // 429로 조기 종료된 나머지 항목은 null 채움
  for (const it of sliced.slice(results.length)) {
    results.push({ id: it.id, postalCode: null })
  }

  return NextResponse.json({ results, rateLimited })
}
