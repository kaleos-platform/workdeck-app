'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCurrentSpace } from '@/hooks/use-current-space'
import { redirectIfMfaRequired } from '@/lib/auth/mfa-client'

type Option = { id: string; name: string; externalSource?: string | null }

type StoreRow = {
  key: string
  label: string
  startDate: string
  representativeChannelId: string | null
  clientId: string
  clientSecret: string
  // 서버에 이미 있는 스토어는 key 를 바꿀 수 없다(N배송 채널·alias 가 key 에 묶임).
  saved: boolean
}

type Settings = {
  configured: boolean
  locationId: string | null
  stores: {
    key: string
    label: string
    startDate: string
    representativeChannelId: string | null
    backfilledThrough: string | null
  }[]
  lastError: string | null
}

const NONE = '__none__'
const STORE_KEY = /^[a-z0-9-]{2,20}$/
const emptyRow = (): StoreRow => ({
  key: '',
  label: '',
  startDate: '',
  representativeChannelId: null,
  clientId: '',
  clientSecret: '',
  saved: false,
})

export function NaverNbaesongCard() {
  const space = useCurrentSpace()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [locations, setLocations] = useState<Option[]>([])
  const [channels, setChannels] = useState<Option[]>([])
  const [locationId, setLocationId] = useState('')
  const [rows, setRows] = useState<StoreRow[]>([])
  const [locked, setLocked] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)

  async function load() {
    try {
      const [s, l, c] = await Promise.all([
        fetch('/api/sh/nbaesong/settings').then((r) => (r.ok ? r.json() : null)),
        fetch('/api/sh/inventory/locations').then((r) => (r.ok ? r.json() : null)),
        fetch('/api/channels?isActive=true&isSalesChannel=true').then((r) =>
          r.ok ? r.json() : null
        ),
      ])
      setLocations(l?.locations ?? [])
      // N배송 전용 채널은 대표 채널이 될 수 없다.
      setChannels(
        ((c?.channels ?? []) as Option[]).filter(
          (ch) => !ch.externalSource?.startsWith('naver_nbaesong:')
        )
      )
      const settings = s as Settings | null
      if (settings) {
        setLocationId(settings.locationId ?? '')
        setLastError(settings.lastError)
        setLocked(settings.stores.some((st) => st.backfilledThrough))
        setRows(
          settings.stores.map((st) => ({
            key: st.key,
            label: st.label,
            startDate: st.startDate,
            representativeChannelId: st.representativeChannelId,
            clientId: '',
            clientSecret: '',
            saved: true,
          }))
        )
      }
    } catch {
      toast.error('N배송 연동 설정을 불러오지 못했습니다')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const patchRow = (i: number, p: Partial<StoreRow>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...p } : r)))

  async function save() {
    if (!space) return
    if (!locationId) return toast.error('출고 위치를 선택해 주세요')
    if (rows.length === 0) return toast.error('스토어를 1개 이상 추가해 주세요')
    if (rows.length > 5) return toast.error('스토어는 최대 5개까지 등록할 수 있습니다')
    for (const r of rows) {
      if (!STORE_KEY.test(r.key))
        return toast.error('스토어 키는 영문 소문자·숫자·하이픈 2~20자여야 합니다')
      if (!r.label.trim() || !r.startDate) return toast.error('이름과 N배송 시작일을 입력해 주세요')
      if (r.clientId.trim().length < 10 || r.clientSecret.trim().length < 20)
        return toast.error('애플리케이션 ID와 시크릿을 모두 입력해 주세요 (저장 시 매번 다시 입력)')
    }
    if (new Set(rows.map((r) => r.key)).size !== rows.length)
      return toast.error('스토어 키가 중복되었습니다')

    setSaving(true)
    try {
      const res = await fetch(`/api/spaces/${space.id}/credentials/naver-commerce`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: {
            stores: Object.fromEntries(
              rows.map((r) => [
                r.key,
                { clientId: r.clientId.trim(), clientSecret: r.clientSecret.trim() },
              ])
            ),
          },
          config: {
            locationId,
            stores: rows.map((r) => ({
              key: r.key,
              label: r.label.trim(),
              startDate: r.startDate,
              representativeChannelId: r.representativeChannelId,
            })),
          },
        }),
      })
      if (await redirectIfMfaRequired(res)) return
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error((data as { error?: string }).error ?? '저장에 실패했습니다')
        return
      }
      toast.success('N배송 연동 설정을 저장했습니다')
      await load()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>스마트스토어 N배송 연동</CardTitle>
        <CardDescription>
          스토어별 커머스API 키로 N배송 주문을 자동 수집해 출고 위치 재고를 차감합니다
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">불러오는 중...</p>
        ) : (
          <>
            {lastError && (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                최근 오류: {lastError}
              </p>
            )}

            <div className="max-w-xs space-y-1.5">
              <Label>출고 위치</Label>
              <Select value={locationId} onValueChange={setLocationId} disabled={locked}>
                <SelectTrigger>
                  <SelectValue placeholder="위치 선택" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {locations.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  등록된 위치가 없습니다.{' '}
                  <Link href="/d/seller-ops/inventory/locations" className="underline">
                    보관 위치 관리
                  </Link>
                  에서 3PL 위치를 먼저 추가해 주세요
                </p>
              )}
              {locked && (
                <p className="text-xs text-muted-foreground">
                  위치 변경은 재고 대조 후 재등록이 필요합니다
                </p>
              )}
            </div>

            <div className="space-y-3">
              {rows.map((r, i) => (
                <div key={i} className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>스토어 키</Label>
                    <Input
                      value={r.key}
                      disabled={r.saved}
                      placeholder="예: shop1"
                      onChange={(e) => patchRow(i, { key: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>이름</Label>
                    <Input
                      value={r.label}
                      maxLength={30}
                      onChange={(e) => patchRow(i, { label: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>N배송 시작일</Label>
                    <Input
                      type="date"
                      value={r.startDate}
                      onChange={(e) => patchRow(i, { startDate: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>대표 채널</Label>
                    <Select
                      value={r.representativeChannelId ?? NONE}
                      onValueChange={(v) =>
                        patchRow(i, { representativeChannelId: v === NONE ? null : v })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>선택 안 함</SelectItem>
                        {channels.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>애플리케이션 ID</Label>
                    <Input
                      value={r.clientId}
                      autoComplete="off"
                      onChange={(e) => patchRow(i, { clientId: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>시크릿</Label>
                    <Input
                      type="password"
                      value={r.clientSecret}
                      autoComplete="new-password"
                      onChange={(e) => patchRow(i, { clientSecret: e.target.value })}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      스토어 삭제
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={rows.length >= 5}
                onClick={() => setRows((rs) => [...rs, emptyRow()])}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                스토어 추가
              </Button>
            </div>

            <div className="flex items-center gap-3">
              <Button type="button" onClick={save} disabled={saving || !space}>
                {saving ? '저장 중...' : '저장'}
              </Button>
              <p className="text-xs text-muted-foreground">
                시크릿은 저장 후 다시 표시되지 않습니다
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
