'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import type { WizardStore } from './build-types'
import { AutoSaveIndicator } from './autosave-indicator'

type StoresValue = {
  stores: WizardStore[]
  storeIds: string[]
  noStores: boolean
}

type Props = {
  postingId: string
  value: StoresValue
  onChange: (patch: Partial<StoresValue>) => void
}

// 모집 장소 섹션 (controlled) — 매장 체크리스트 + "모집 장소 없음" 스위치.
export function StepStores({ postingId, value, onChange }: Props) {
  const router = useRouter()
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newAddress, setNewAddress] = useState('')
  const savingRef = useRef(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { stores, storeIds, noStores } = value

  async function doSave(nextStoreIds: string[], nextNoStores: boolean) {
    if (savingRef.current) return
    savingRef.current = true
    setStatus('saving')
    try {
      const res = await fetch(`/api/hiring-posts/postings/${postingId}/stores`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeIds: nextNoStores ? [] : nextStoreIds }),
      })
      if (!res.ok) throw new Error('매장 연결 저장에 실패했습니다')
      setStatus('saved')
      router.refresh()
      setTimeout(() => setStatus('idle'), 2000)
    } catch (err) {
      setStatus('idle')
      toast.error(err instanceof Error ? err.message : '매장 연결 저장에 실패했습니다')
    } finally {
      savingRef.current = false
    }
  }

  function debouncedSave(nextStoreIds: string[], nextNoStores: boolean) {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      doSave(nextStoreIds, nextNoStores)
    }, 600)
  }

  function toggle(id: string) {
    const next = storeIds.includes(id) ? storeIds.filter((s) => s !== id) : [...storeIds, id]
    onChange({ storeIds: next })
    debouncedSave(next, noStores)
  }

  function toggleNoStores(on: boolean) {
    const nextStoreIds = on ? [] : storeIds
    onChange(on ? { noStores: true, storeIds: [] } : { noStores: false })
    debouncedSave(nextStoreIds, on)
  }

  async function handleCreate() {
    if (!newName.trim()) {
      toast.error('매장명을 입력하세요')
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/hiring-posts/stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), roadAddress: newAddress.trim() || undefined }),
      })
      if (!res.ok) throw new Error('매장 생성에 실패했습니다')
      const { store } = await res.json()
      const created: WizardStore = {
        id: store.id,
        name: store.name,
        roadAddress: store.roadAddress,
      }
      onChange({ stores: [...stores, created], storeIds: [...storeIds, created.id] })
      setNewName('')
      setNewAddress('')
      toast.success('매장을 추가했습니다')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '매장 생성에 실패했습니다')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border px-4 py-3">
        <div className="space-y-0.5">
          <Label htmlFor="no-stores">모집 장소 없음</Label>
          <p className="text-xs text-muted-foreground">특정 매장 없이 모집하는 경우 켜세요.</p>
        </div>
        <Switch id="no-stores" checked={noStores} onCheckedChange={toggleNoStores} />
      </div>

      {noStores ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          이 공고는 특정 근무 매장 없이 모집합니다.
        </div>
      ) : (
        <>
          <div className="space-y-1">
            {stores.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                등록된 매장이 없습니다. 아래에서 추가하세요.
              </div>
            ) : (
              stores.map((s) => (
                <label
                  key={s.id}
                  className="flex cursor-pointer items-center gap-3 rounded-md border px-4 py-2.5 hover:bg-accent/50"
                >
                  <Checkbox
                    checked={storeIds.includes(s.id)}
                    onCheckedChange={() => toggle(s.id)}
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{s.name}</div>
                    {s.roadAddress && (
                      <div className="truncate text-xs text-muted-foreground">{s.roadAddress}</div>
                    )}
                  </div>
                </label>
              ))
            )}
          </div>

          <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
            <div className="text-sm font-medium">매장 추가</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="store-name">매장명</Label>
                <Input
                  id="store-name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="예: 강남점"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="store-addr">도로명 주소</Label>
                <Input
                  id="store-addr"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  placeholder="예: 서울 강남구 테헤란로 1"
                />
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={handleCreate} disabled={creating}>
              <Plus /> 매장 추가
            </Button>
          </div>
        </>
      )}

      <div className="flex justify-end">
        <AutoSaveIndicator status={status} />
      </div>
    </div>
  )
}
