'use client'

import { useEffect, useLayoutEffect, useRef } from 'react'

// 프로젝트의 DOM 타입에 없는 Navigation API 중 사용하는 부분만 선언한다.
type HistoryNavigation = EventTarget & {
  traverseTo: (key: string) => { finished: Promise<unknown> }
}
type HistoryNavigateEvent = Event & {
  navigationType: string
  destination: { key: string; url: string }
}

// 위저드 밖의 링크와 취소 가능한 history 이동도 기존 저장 검증을 거친다.
export function useWizardNavigation(
  afterSaving: (action: () => void | Promise<void>) => Promise<void>,
  push: (url: string) => void
) {
  const callbacks = useRef({ afterSaving, push })
  useLayoutEffect(() => {
    callbacks.current = { afterSaving, push }
  })

  useEffect(() => {
    let active = true
    let allowedKey: string | null = null
    const navigation = (window as Window & { navigation?: HistoryNavigation }).navigation

    // ponytail: 미지원·취소 불가능한 history 이동은 통과한다. 전 브라우저 복구는 초안 보관으로 보완해야 한다.
    function onNavigate(event: Event) {
      const next = event as HistoryNavigateEvent
      if (
        next.navigationType !== 'traverse' ||
        !next.cancelable ||
        next.destination.key === allowedKey ||
        !next.destination.key
      )
        return
      next.preventDefault()
      void callbacks.current.afterSaving(async () => {
        if (!active || !navigation) return
        allowedKey = next.destination.key
        try {
          await navigation.traverseTo(next.destination.key).finished
        } finally {
          allowedKey = null
        }
      })
    }

    function onLinkClick(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.hasAttribute('download') ||
        (anchor.target && anchor.target !== '_self')
      )
        return
      const url = new URL(anchor.href)
      if (
        url.origin !== location.origin ||
        (url.pathname === location.pathname && url.search === location.search)
      )
        return
      event.preventDefault()
      event.stopPropagation()
      void callbacks.current.afterSaving(() => {
        if (active) callbacks.current.push(url.pathname + url.search + url.hash)
      })
    }

    navigation?.addEventListener('navigate', onNavigate)
    document.addEventListener('click', onLinkClick, true)
    return () => {
      active = false
      navigation?.removeEventListener('navigate', onNavigate)
      document.removeEventListener('click', onLinkClick, true)
    }
  }, [])
}
