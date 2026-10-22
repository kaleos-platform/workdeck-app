// POST: 상품 페이지 URL 로 판매채널을 추정하고 상품명을 가져온다. 저장하지 않는다.
// 페이지를 못 가져와도 URL 자체는 쓸 수 있으므로 실패는 200 + fetchError 로 돌려준다.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { safeFetchHtml, SafeFetchError } from '@/lib/net/safe-fetch'
import { mapSafeFetchError } from '@/lib/net/safe-fetch-message'
import { htmlToText } from '@/lib/sh/html-to-text'
import { detectChannelForUrl, normalizeHttpUrl } from '@/lib/sh/product-page-url'

export const runtime = 'nodejs'
export const maxDuration = 30

const bodySchema = z.object({ url: z.string().min(1).max(2000) })

// 제목 끝 사이트명 꼬리(" - 쿠팡!", " : 네이버 쇼핑" 등)만 단순 제거
const SITE_SUFFIX_RE = /\s*[-:|]\s*(쿠팡!?|네이버.*|스마트스토어.*|[^-:|]*스토어)\s*$/

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub', { write: true })
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errorResponse('URL 을 입력해 주세요', 400)
  const url = normalizeHttpUrl(parsed.data.url)
  if (!url) return errorResponse('http(s) URL 형식이 아닙니다', 400)

  const channels = await prisma.channel.findMany({
    // 생성 폼의 채널 목록(isSalesChannel)과 같은 모집단에서만 고른다 — 아니면 폼 선택지에 없는 채널이 잡힌다.
    where: { spaceId: resolved.space.id, channelTypeDef: { isSalesChannel: true } },
    select: { id: true, name: true, storeUrl: true, externalSource: true, isActive: true },
  })
  const { channelId, candidates } = detectChannelForUrl(url.href, channels)

  let searchName: string | null = null
  let fetchError: string | null = null
  try {
    const { finalUrl, html } = await safeFetchHtml(url.href)
    const { title, structured } = htmlToText(html, undefined, { baseUrl: finalUrl })
    const raw = (structured?.name ?? title ?? '').trim()
    searchName = raw.replace(SITE_SUFFIX_RE, '').trim() || null
    if (!searchName) fetchError = '페이지에서 상품명을 찾지 못했습니다'
  } catch (err) {
    if (err instanceof SafeFetchError) {
      fetchError = mapSafeFetchError(err)
    } else {
      console.error('[listings/from-url] fetch 실패', err)
      fetchError = '페이지를 가져오는 중 오류가 발생했습니다'
    }
  }

  return NextResponse.json({ pageUrl: url.href, channelId, candidates, searchName, fetchError })
}
