'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

// ─── 타입 ────────────────────────────────────────────────────────────────────

type ChannelTypeDef = {
  id: string
  name: string
  isSalesChannel: boolean
  isSystem: boolean
  sortOrder: number
  channelCount: number
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  channelTypes: ChannelTypeDef[]
  onChanged: () => void
}

// ─── 컴포넌트 ─────────────────────────────────────────────────────────────────

export function ChannelTypeManageDialog({ open, onOpenChange, channelTypes, onChanged }: Props) {
  // 낙관적 업데이트를 위한 로컬 복사본
  const [localTypes, setLocalTypes] = useState<ChannelTypeDef[]>([])
  // Dialog가 열릴 때마다 동기화
  const [prevOpen, setPrevOpen] = useState(false)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) setLocalTypes(channelTypes)
  }

  // 인라인 편집 상태 (typeId → 편집 중인 이름)
  const [editingNames, setEditingNames] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null) // typeId or 'new'

  // 신규 추가 영역
  const [newName, setNewName] = useState('')
  const [newIsSales, setNewIsSales] = useState(true)

  // ── 유형 이름 즉시 PATCH ──

  async function handlePatchName(t: ChannelTypeDef, name: string) {
    const trimmed = name.trim()
    if (!trimmed || trimmed === t.name) {
      // 변경 없으면 editingNames에서 제거
      setEditingNames((prev) => {
        const next = { ...prev }
        delete next[t.id]
        return next
      })
      return
    }
    setSaving(t.id)
    try {
      const res = await fetch(`/api/channel-types/${t.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? '수정 실패')
      // 낙관적 업데이트
      setLocalTypes((prev) => prev.map((x) => (x.id === t.id ? { ...x, name: trimmed } : x)))
      setEditingNames((prev) => {
        const next = { ...prev }
        delete next[t.id]
        return next
      })
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '수정 실패')
    } finally {
      setSaving(null)
    }
  }

  // ── 판매채널 Switch 즉시 PATCH ──

  async function handlePatchIsSales(t: ChannelTypeDef, isSalesChannel: boolean) {
    setSaving(t.id)
    // 낙관적
    setLocalTypes((prev) => prev.map((x) => (x.id === t.id ? { ...x, isSalesChannel } : x)))
    try {
      const res = await fetch(`/api/channel-types/${t.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isSalesChannel }),
      })
      const data = await res.json()
      if (!res.ok) {
        // 롤백
        setLocalTypes((prev) =>
          prev.map((x) => (x.id === t.id ? { ...x, isSalesChannel: !isSalesChannel } : x))
        )
        throw new Error(data?.message ?? '수정 실패')
      }
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '수정 실패')
    } finally {
      setSaving(null)
    }
  }

  // ── 유형 삭제 ──

  async function handleDelete(t: ChannelTypeDef) {
    if (
      !confirm(
        `"${t.name}" 유형을 삭제하시겠습니까?${t.isSystem ? '\n(시스템 시드 유형입니다)' : ''}`
      )
    )
      return
    setSaving(t.id)
    try {
      const res = await fetch(`/api/channel-types/${t.id}`, { method: 'DELETE' })
      if (res.status === 409) {
        const data = await res.json().catch(() => ({}))
        toast.error(data?.message ?? '사용 중인 유형은 삭제할 수 없습니다')
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.message ?? '삭제 실패')
      }
      // 낙관적 — 목록에서 제거
      setLocalTypes((prev) => prev.filter((x) => x.id !== t.id))
      toast.success('유형이 삭제되었습니다')
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    } finally {
      setSaving(null)
    }
  }

  // ── 신규 추가 ──

  async function handleAddNew() {
    const trimmed = newName.trim()
    if (!trimmed) {
      toast.error('유형 이름을 입력해 주세요')
      return
    }
    setSaving('new')
    try {
      const res = await fetch('/api/channel-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, isSalesChannel: newIsSales }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? '생성 실패')
      const created: ChannelTypeDef = {
        id: data.type.id,
        name: data.type.name,
        isSalesChannel: data.type.isSalesChannel,
        isSystem: false,
        sortOrder: data.type.sortOrder ?? 99,
        channelCount: 0,
      }
      setLocalTypes((prev) => [...prev, created])
      setNewName('')
      setNewIsSales(true)
      toast.success(`"${created.name}" 유형이 추가되었습니다`)
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '생성 실패')
    } finally {
      setSaving(null)
    }
  }

  // ── 렌더 ─────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>채널 유형 관리</DialogTitle>
          <DialogDescription>채널 유형을 추가·수정·삭제합니다</DialogDescription>
        </DialogHeader>

        {/* 유형 목록 */}
        <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
          {localTypes.length === 0 && (
            <p className="text-sm text-muted-foreground">등록된 채널 유형이 없습니다</p>
          )}
          {localTypes.map((t) => {
            const editingName = editingNames[t.id] ?? t.name
            const isSaving = saving === t.id
            return (
              <div key={t.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
                {/* 이름 인라인 편집 */}
                <Input
                  className="h-8 flex-1 text-sm"
                  value={editingName}
                  onChange={(e) => setEditingNames((prev) => ({ ...prev, [t.id]: e.target.value }))}
                  onBlur={() => handlePatchName(t, editingName)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handlePatchName(t, editingName)
                    if (e.key === 'Escape') {
                      setEditingNames((prev) => {
                        const next = { ...prev }
                        delete next[t.id]
                        return next
                      })
                    }
                  }}
                  disabled={isSaving}
                  aria-label="유형 이름"
                />

                {/* 판매채널 Switch */}
                <div className="flex shrink-0 items-center gap-1.5">
                  <Switch
                    checked={t.isSalesChannel}
                    onCheckedChange={(v) => handlePatchIsSales(t, v)}
                    disabled={isSaving}
                    aria-label="판매채널 유형"
                  />
                  <span className="w-14 text-xs text-muted-foreground">판매채널</span>
                </div>

                {/* 채널 수 뱃지 */}
                <Badge variant="outline" className="shrink-0 text-xs">
                  {t.channelCount}개
                </Badge>

                {/* 삭제 버튼 — 시스템 시드도 활성화 */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                  onClick={() => handleDelete(t)}
                  disabled={isSaving}
                  aria-label="유형 삭제"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )
          })}
        </div>

        {/* 신규 추가 영역 */}
        <div className="border-t pt-4">
          <p className="mb-3 text-xs font-medium text-muted-foreground">새 유형 추가</p>
          <div className="flex items-center gap-2">
            <Input
              className="flex-1"
              placeholder="유형 이름"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddNew()
              }}
              disabled={saving === 'new'}
            />
            <div className="flex shrink-0 items-center gap-1.5">
              <Switch
                checked={newIsSales}
                onCheckedChange={setNewIsSales}
                disabled={saving === 'new'}
                id="new-type-is-sales"
              />
              <Label htmlFor="new-type-is-sales" className="w-14 cursor-pointer text-xs">
                판매채널
              </Label>
            </div>
            <Button
              size="sm"
              onClick={handleAddNew}
              disabled={saving === 'new' || !newName.trim()}
              className="shrink-0"
            >
              {saving === 'new' ? '추가 중...' : '추가'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
