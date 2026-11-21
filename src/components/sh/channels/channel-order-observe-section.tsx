'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const ADAPTER_LABELS = { naver: '스마트스토어', coupang: '쿠팡', cafe24: '카페24' } as const
type AdapterKey = keyof typeof ADAPTER_LABELS

/** 채널 편집 팝업 고급 탭 — 주문 관측(그림자 수집). ADMIN 이상만 보이고, 이 영역은 자체 저장 버튼으로 저장한다. */
export function ChannelOrderObserveSection({ channelId }: { channelId: string }) {
  const [canEdit, setCanEdit] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [adapter, setAdapter] = useState<AdapterKey | ''>('')
  const [storeKey, setStoreKey] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    fetch(`/api/channels/${channelId}/order-observe`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d) return
        setCanEdit(Boolean(d.canEdit))
        setEnabled(Boolean(d.setting.observeEnabled))
        setAdapter(d.setting.adapter ?? '')
        setStoreKey(d.setting.storeKey ?? '')
      })
      .catch(() => null)
    return () => {
      alive = false
    }
  }, [channelId])

  if (!canEdit) return null

  const invalid = enabled && (!adapter || (adapter === 'naver' && !storeKey.trim()))

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`/api/channels/${channelId}/order-observe`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ observeEnabled: enabled, adapter: adapter || 'cafe24', storeKey }),
      })
      if (!res.ok) throw new Error('저장하지 못했습니다')
      toast.success('주문 관측 설정을 저장했습니다')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장하지 못했습니다')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <p className="text-xs font-medium text-muted-foreground">주문 관측 (그림자 수집)</p>
      <p className="text-xs text-muted-foreground">
        채널의 주문을 읽기만 해서 기록하고, 엑셀로 등록한 배송과 비교합니다. 채널에는 아무것도 쓰지
        않으며 재고·판매에는 영향이 없습니다.
      </p>
      <div className="flex items-center justify-between">
        <Label htmlFor="ch-observe" className="cursor-pointer">
          주문 관측 사용
        </Label>
        <Switch id="ch-observe" checked={enabled} onCheckedChange={setEnabled} />
      </div>
      <div className="space-y-2">
        <Label>가져올 곳</Label>
        <Select value={adapter} onValueChange={(v) => setAdapter(v as AdapterKey)}>
          <SelectTrigger>
            <SelectValue placeholder="판매 채널 선택" />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(ADAPTER_LABELS) as AdapterKey[]).map((k) => (
              <SelectItem key={k} value={k}>
                {ADAPTER_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {adapter === 'naver' && (
        <div className="space-y-2">
          <Label htmlFor="ch-observe-store">스토어 키</Label>
          <Input
            id="ch-observe-store"
            value={storeKey}
            onChange={(e) => setStoreKey(e.target.value)}
            placeholder="설정 > 연동에 등록한 스마트스토어 키"
          />
        </div>
      )}
      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={save} disabled={saving || invalid}>
          {saving ? '저장 중...' : '관측 설정 저장'}
        </Button>
      </div>
    </div>
  )
}
