'use client'

import { useEffect, useState } from 'react'

export type NavigationCampaign = {
  id: string
  name: string
  displayName: string
  adTypes: string[]
}

const CAMPAIGNS_CHANGED = 'coupang-ads:campaigns-changed'

export function notifyCampaignsChanged() {
  window.dispatchEvent(new Event(CAMPAIGNS_CHANGED))
}

export function useCampaignNavigation(enabled: boolean) {
  const [campaigns, setCampaigns] = useState<NavigationCampaign[]>([])

  useEffect(() => {
    if (!enabled) return
    let controller: AbortController | undefined
    async function refresh() {
      controller?.abort()
      const request = new AbortController()
      controller = request
      try {
        const response = await fetch('/api/campaigns?view=navigation', { signal: request.signal })
        if (!response.ok) return
        const list: NavigationCampaign[] = await response.json()
        if (!request.signal.aborted) setCampaigns(list)
      } catch {
        // 일시적인 실패에서는 기존 목록을 유지하고 다음 갱신 시 재시도한다.
      }
    }
    void refresh()
    window.addEventListener(CAMPAIGNS_CHANGED, refresh)
    window.addEventListener('focus', refresh)
    return () => {
      controller?.abort()
      window.removeEventListener(CAMPAIGNS_CHANGED, refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [enabled])

  return enabled ? campaigns : []
}
