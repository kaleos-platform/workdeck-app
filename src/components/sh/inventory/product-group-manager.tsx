'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Pencil, Trash2, Plus, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'

type GroupItem = { id: string; name: string; productCount: number }

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => void
}

export function ProductGroupManager({ open, onOpenChange, onChanged }: Props) {
  const [groups, setGroups] = useState<GroupItem[]>([])
  const [loading, setLoading] = useState(false)
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const loadGroups = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/inv/product-groups')
      if (res.ok) {
        const json = await res.json()
        setGroups(json.groups ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) void loadGroups()
  }, [open, loadGroups])

  const handleAdd = async () => {
    const name = newName.trim()
    if (!name) return
    setAdding(true)
    try {
      const res = await fetch('/api/inv/product-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.message ?? '그룹 추가 실패')
        return
      }
      toast.success(`그룹 "${name}" 추가됨`)
      setNewName('')
      await loadGroups()
      onChanged()
    } finally {
      setAdding(false)
    }
  }

  const handleRename = async (groupId: string) => {
    const name = editName.trim()
    if (!name) return
    try {
      const res = await fetch(`/api/inv/product-groups/${groupId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.message ?? '그룹명 변경 실패')
        return
      }
      toast.success('그룹명이 변경되었습니다')
      setEditingId(null)
      await loadGroups()
      onChanged()
    } catch {
      toast.error('그룹명 변경 실패')
    }
  }

  const handleDelete = async (group: GroupItem) => {
    if (
      !confirm(
        `"${group.name}" 그룹을 삭제하시겠습니까?\n소속 상품 ${group.productCount}개는 기본 그룹으로 이동됩니다.`
      )
    )
      return
    try {
      const res = await fetch(`/api/inv/product-groups/${group.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.message ?? '그룹 삭제 실패')
        return
      }
      toast.success(`"${group.name}" 그룹이 삭제되었습니다`)
      await loadGroups()
      onChanged()
    } catch {
      toast.error('그룹 삭제 실패')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>그룹 관리</DialogTitle>
          <DialogDescription>상품 그룹을 추가, 수정, 삭제할 수 있습니다.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Add new group */}
          <div className="flex gap-2">
            <Input
              placeholder="새 그룹명"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleAdd()
              }}
            />
            <Button size="sm" onClick={handleAdd} disabled={adding || !newName.trim()}>
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </Button>
          </div>

          {/* Group list */}
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : groups.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">등록된 그룹이 없습니다</p>
          ) : (
            <div className="space-y-1">
              {groups.map((g) => (
                <div key={g.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
                  {editingId === g.id ? (
                    <>
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="h-8 flex-1"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleRename(g.id)
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleRename(g.id)}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setEditingId(null)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-sm">{g.name}</span>
                      <span className="text-xs text-muted-foreground">{g.productCount}개</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => {
                          setEditingId(g.id)
                          setEditName(g.name)
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(g)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
