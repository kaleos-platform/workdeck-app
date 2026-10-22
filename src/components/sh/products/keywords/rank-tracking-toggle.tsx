'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

type Props = {
  /** PATCH 대상 — 채널상품 또는 리스팅 API 경로 */
  url: string
  /** 서버 저장값 */
  checked: boolean
  hasPageUrl: boolean
  onChange?: (next: boolean) => void
  idPrefix: string
}

/** 자동저장 배치와 별개로 즉시 PATCH 한다. 실패하면 되돌리고 서버 메시지를 띄운다. */
export function RankTrackingToggle({ url, checked, hasPageUrl, onChange, idPrefix }: Props) {
  const [value, setValue] = useState(checked)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setValue(checked)
  }, [checked])

  async function toggle(next: boolean) {
    setValue(next)
    setBusy(true)
    try {
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rankTracking: next }),
      })
      if (!res.ok) {
        const body: { message?: string } = await res.json().catch(() => ({}))
        throw new Error(body.message ?? '키워드 순위 추적 설정에 실패했습니다')
      }
      onChange?.(next)
    } catch (e) {
      setValue(!next)
      toast.error(e instanceof Error ? e.message : '키워드 순위 추적 설정에 실패했습니다')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Switch
          id={`${idPrefix}-rank-tracking`}
          checked={value}
          disabled={busy}
          onCheckedChange={(v) => void toggle(v)}
        />
        <Label htmlFor={`${idPrefix}-rank-tracking`}>키워드 순위 추적</Label>
      </div>
      <p className="text-xs text-muted-foreground">
        등록 키워드의 검색 순위를 매일 기록합니다 · 슬롯 = 키워드 수
      </p>
      {value && !hasPageUrl && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          상품 페이지 URL이 있어야 수집됩니다
        </p>
      )}
    </div>
  )
}
