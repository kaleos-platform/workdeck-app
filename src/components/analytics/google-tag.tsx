'use client'

import { useEffect, useState } from 'react'
import Script from 'next/script'
import { usePathname } from 'next/navigation'
import { syncPageContext, track } from '@/lib/analytics'
import { getAppOrigin } from '@/lib/domain'
import { MARKETING_DECK_SLUGS } from '@/lib/marketing/routes'

const GA_ID = process.env.NEXT_PUBLIC_GA_ID

const INIT_SCRIPT = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config',${JSON.stringify(
  GA_ID
)},{send_page_view:false,allow_google_signals:false,allow_ad_personalization_signals:false});`

// 가입·로그인 링크 클릭 → cta_click. deck 은 redirectTo 의 subscribe= 값, 없으면 현재 랜딩 슬러그.
function onDocumentClick(event: MouseEvent) {
  const anchor = (event.target as Element | null)?.closest?.('a')
  if (!anchor?.href) return
  let url: URL
  try {
    url = new URL(anchor.href, window.location.href)
  } catch {
    return
  }
  // app 오리진 + 같은 오리진(dev·preview)
  if (url.origin !== getAppOrigin() && url.origin !== window.location.origin) return
  const cta = url.pathname === '/signup' ? 'signup' : url.pathname === '/login' ? 'login' : null
  if (!cta) return
  const redirectTo = url.searchParams.get('redirectTo') ?? ''
  const subscribe = new URLSearchParams(redirectTo.split('?')[1] ?? '').get('subscribe')
  const slug = window.location.pathname.split('/')[1]
  const pageDeck = (MARKETING_DECK_SLUGS as readonly string[]).includes(slug) ? slug : undefined
  track('cta_click', { cta, deck: subscribe || pageDeck })
}

/**
 * GA4 gtag 로더 + page_view. NEXT_PUBLIC_GA_ID 가 없으면 아무것도 렌더하지 않는다.
 * 레이아웃이 중첩되는 경로에 둘 중 하나에만 둔다(중복 로딩 방지).
 */
export function GoogleTag({ trackCtaClicks = false }: { trackCtaClicks?: boolean }) {
  const pathname = usePathname()
  const [ready, setReady] = useState(false)

  // set 은 gtag 로더 전에도 dataLayer 에 쌓이므로 ready 와 무관하게 먼저 고정한다
  useEffect(() => {
    syncPageContext()
    if (ready) track('page_view')
  }, [ready, pathname])

  useEffect(() => {
    if (!GA_ID || !trackCtaClicks) return
    document.addEventListener('click', onDocumentClick, true)
    return () => document.removeEventListener('click', onDocumentClick, true)
  }, [trackCtaClicks])

  if (!GA_ID) return null
  return (
    <>
      <Script id="ga-init" strategy="afterInteractive">
        {INIT_SCRIPT}
      </Script>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
        strategy="afterInteractive"
        onReady={() => setReady(true)}
      />
    </>
  )
}
