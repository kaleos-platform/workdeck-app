'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import type { WizardStore } from './build-types'

type Props = {
  postingId: string
  initialStoreIds: string[]
  initialStores: WizardStore[]
}

export function StepStores({ postingId, initialStoreIds, initialStores }: Props) {
  const router = useRouter()
  const [stores, setStores] = useState(initialStores)
  const [selected, setSelected] = useState<Set<string>>(new Set(initialStoreIds))
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newAddress, setNewAddress] = useState('')

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch(`/api/hiring-posts/postings/${postingId}/stores`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeIds: Array.from(selected) }),
      })
      if (!res.ok) throw new Error('매장 연결 저장에 실패했습니다')
      toast.success('매장 연결을 저장했습니다')
      // 스텝 이동 시 언마운트되므로 서버 props 최신화
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '매장 연결 저장에 실패했습니다')
    } finally {
      setSaving(false)
    }
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
      setStores((prev) => [
        ...prev,
        { id: store.id, name: store.name, roadAddress: store.roadAddress },
      ])
      setSelected((prev) => new Set(prev).add(store.id))
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
    <div className="max-w-2xl space-y-6">
      <p className="text-sm text-muted-foreground">이 공고와 연결할 근무 매장을 선택합니다.</p>

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
              <Checkbox checked={selected.has(s.id)} onCheckedChange={() => toggle(s.id)} />
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

      <Button onClick={handleSave} disabled={saving}>
        연결 저장
      </Button>
    </div>
  )
}
