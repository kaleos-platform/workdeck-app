'use client'

import { useImperativeHandle, useRef, useState, type Ref } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { WizardStore } from './build-types'
import { AutoSaveIndicator } from './autosave-indicator'
import { useQueuedSave, type SaveHandle } from './use-queued-save'

type StoresValue = {
  stores: WizardStore[]
  storeIds: string[]
  noStores: boolean
}

type Props = {
  ref?: Ref<SaveHandle>
  postingId: string
  value: StoresValue
  onChange: (patch: Partial<StoresValue>) => void
}

// 모집 장소 섹션 (controlled) — 매장 체크리스트 + "모집 장소 없음" 스위치.
export function StepStores({ ref, postingId, value, onChange }: Props) {
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newAddress, setNewAddress] = useState('')
  const creatingRef = useRef(false)
  const valueRef = useRef(value)
  valueRef.current = value
  const { stores, storeIds, noStores } = value
  const saver = useQueuedSave(noStores ? [] : storeIds, async (nextStoreIds) => {
    const res = await fetch(`/api/hiring-posts/postings/${postingId}/stores`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeIds: nextStoreIds }),
    })
    if (!res.ok) throw new Error('매장 연결 저장에 실패했습니다. 이동 버튼을 눌러 다시 저장하세요.')
    router.refresh()
  })
  useImperativeHandle(ref, () => ({
    flush: () =>
      creatingRef.current
        ? Promise.reject(new Error('매장 추가가 진행 중입니다. 완료 후 다시 이동하세요.'))
        : saver.flush(valueRef.current.noStores ? [] : valueRef.current.storeIds),
  }))

  function debouncedSave(nextStoreIds: string[], nextNoStores: boolean) {
    saver.schedule(nextNoStores ? [] : nextStoreIds)
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
    if (creatingRef.current) return
    if (!newName.trim()) {
      toast.error('매장명을 입력하세요')
      return
    }
    creatingRef.current = true
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
      const current = valueRef.current
      const next = {
        stores: [...current.stores, created],
        storeIds: [...current.storeIds, created.id],
        noStores: false,
      }
      valueRef.current = next
      onChange(next)
      setNewName('')
      setNewAddress('')
      setDialogOpen(false)
      toast.success('매장을 추가했습니다')
      // 생성은 완료됐으므로 연결 실패 시 기존 매장의 연결만 재시도한다.
      await saver.flush(next.storeIds)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '매장 생성에 실패했습니다')
    } finally {
      creatingRef.current = false
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
                등록된 매장이 없습니다. 매장 추가 버튼으로 추가하세요.
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

          <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
            <Plus /> 매장 추가
          </Button>

          <Dialog
            open={dialogOpen}
            onOpenChange={(open) => {
              if (!open && !creatingRef.current) {
                setDialogOpen(false)
                setNewName('')
                setNewAddress('')
              }
            }}
          >
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>매장 추가</DialogTitle>
                <DialogDescription>새 매장을 만들고 이 공고에 연결합니다.</DialogDescription>
              </DialogHeader>
              <div inert={creating} className="space-y-3">
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
              <DialogFooter>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDialogOpen(false)
                    setNewName('')
                    setNewAddress('')
                  }}
                  disabled={creating}
                >
                  취소
                </Button>
                <Button size="sm" onClick={handleCreate} disabled={creating}>
                  <Plus /> 추가
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}

      <div className="flex justify-end">
        <AutoSaveIndicator status={saver.status} />
      </div>
    </div>
  )
}
