'use client'

import { useEffect, useState, type MutableRefObject } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useCurrentSpace } from '@/hooks/use-current-space'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const ADAPTER_LABELS = { naver: '스마트스토어', coupang: '쿠팡', cafe24: '카페24' } as const
type AdapterKey = keyof typeof ADAPTER_LABELS
const MODE_LABELS = { diagnose: '키 진단(판정 안 함)', judge: '판정' } as const
type ModeKey = keyof typeof MODE_LABELS
const MATCH_LABELS = {
  externalOrderId: '채널 주문번호',
  externalLineKey: '채널 주문 행 번호',
  lineKeyOrderPart: '행 번호의 주문번호 부분',
} as const
type MatchKey = keyof typeof MATCH_LABELS
type Cafe24Mall = { mallId: string; status: 'needs_auth' | 'connected' | 'reauth_required' }
/** 팝업 「저장」이 호출하는 관측 저장기. 바뀐 값이 없으면 null. */
export type ObserveSaver = { invalid: boolean; save: () => Promise<void> }

/** 채널 편집 팝업 고급 탭 — 주문 관측(그림자 수집). ADMIN 이상만 보이고, 팝업 하단 「저장」이 saverRef 로 함께 저장한다. */
export function ChannelOrderObserveSection({
  channelId,
  saverRef,
}: {
  channelId: string
  saverRef: MutableRefObject<ObserveSaver | null>
}) {
  const [canEdit, setCanEdit] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [adapter, setAdapter] = useState<AdapterKey | ''>('')
  const [storeKey, setStoreKey] = useState('')
  const [mode, setMode] = useState<ModeKey>('diagnose')
  const [matchField, setMatchField] = useState<MatchKey | ''>('')
  const [loaded, setLoaded] = useState('')
  const spaceId = useCurrentSpace()?.id
  const [malls, setMalls] = useState<Cafe24Mall[] | null>(null)
  const [mallsFailed, setMallsFailed] = useState(false)

  // 카페24 쇼핑몰 목록은 카페24를 고른 때만 조회한다.
  useEffect(() => {
    if (adapter !== 'cafe24' || !spaceId) return
    let alive = true
    // 조회 실패(권한·네트워크)는 「연결된 몰 없음」과 구분한다.
    fetch(`/api/integrations/cafe24/status?spaceId=${encodeURIComponent(spaceId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return
        if (Array.isArray(d?.malls)) setMalls(d.malls)
        else setMallsFailed(true)
      })
      .catch(() => alive && setMallsFailed(true))
    return () => {
      alive = false
    }
  }, [adapter, spaceId])

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
        setMode(d.setting.reconcileMode === 'judge' ? 'judge' : 'diagnose')
        setMatchField(d.setting.matchKeyRule?.field ?? '')
        setLoaded(
          JSON.stringify([
            Boolean(d.setting.observeEnabled),
            d.setting.adapter ?? '',
            d.setting.storeKey ?? '',
            d.setting.reconcileMode === 'judge' ? 'judge' : 'diagnose',
            d.setting.matchKeyRule?.field ?? '',
          ])
        )
      })
      .catch(() => null)
    return () => {
      alive = false
    }
  }, [channelId])

  const invalid =
    enabled && (!adapter || ((adapter === 'naver' || adapter === 'cafe24') && !storeKey.trim()))
  const dirty = canEdit && JSON.stringify([enabled, adapter, storeKey, mode, matchField]) !== loaded

  async function save() {
    const res = await fetch(`/api/channels/${channelId}/order-observe`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        observeEnabled: enabled,
        adapter: adapter || 'cafe24',
        storeKey,
        reconcileMode: mode,
        matchKeyRule: matchField ? { field: matchField } : null,
      }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => null)
      throw new Error(d?.message ?? '주문 관측 설정을 저장하지 못했습니다')
    }
  }

  // 바뀐 값이 있을 때만 팝업 저장에 끼운다(권한 없는 사용자·미변경은 PUT 생략).
  useEffect(() => {
    saverRef.current = dirty ? { invalid, save } : null
    return () => {
      saverRef.current = null
    }
  })

  if (!canEdit) return null

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
        <Select
          value={adapter}
          onValueChange={(v) => {
            setAdapter(v as AdapterKey)
            setStoreKey('')
            setMallsFailed(false)
          }}
        >
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
      {adapter === 'cafe24' && (
        <div className="space-y-2">
          <Label>쇼핑몰</Label>
          {mallsFailed ? (
            <p className="text-xs text-destructive">쇼핑몰 목록을 불러오지 못했습니다</p>
          ) : malls && malls.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              설정 &gt; 연동 &gt; 카페24에서 먼저 쇼핑몰을 연결하세요
            </p>
          ) : (
            <Select value={storeKey} onValueChange={setStoreKey}>
              <SelectTrigger>
                <SelectValue placeholder="연결된 쇼핑몰 선택" />
              </SelectTrigger>
              <SelectContent>
                {(malls ?? []).map((m) => (
                  <SelectItem key={m.mallId} value={m.mallId}>
                    {m.mallId}
                    {m.status !== 'connected' && ' (승인 필요)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}
      <div className="space-y-2">
        <Label>대사 방식</Label>
        <Select value={mode} onValueChange={(v) => setMode(v as ModeKey)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(MODE_LABELS) as ModeKey[]).map((k) => (
              <SelectItem key={k} value={k}>
                {MODE_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {mode === 'judge' && (
        <div className="space-y-2">
          <Label>매칭 키</Label>
          <Select value={matchField} onValueChange={(v) => setMatchField(v as MatchKey)}>
            <SelectTrigger>
              <SelectValue placeholder="엑셀 주문번호와 맞출 값" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(MATCH_LABELS) as MatchKey[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {MATCH_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {invalid && (
        <p className="text-xs text-destructive">
          {adapter ? '스토어 키 또는 쇼핑몰을 선택하세요' : '가져올 곳을 선택하세요'}
        </p>
      )}
    </div>
  )
}
