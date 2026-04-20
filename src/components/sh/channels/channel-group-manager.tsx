'use client'

import { useCallback, useEffect, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type ChannelGroup = {
  id: string
  name: string
  _count?: { channels: number }
}

export function ChannelGroupManager() {
  const [groups, setGroups] = useState<ChannelGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ChannelGroup | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  const loadGroups = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/channel-groups')
      if (!res.ok) throw new Error('채널 그룹 조회 실패')
      const data = await res.json()
      setGroups(data.groups ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '조회 실패')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadGroups()
  }, [loadGroups])

  function openNew() {
    setEditing(null)
    setName('')
    setDialogOpen(true)
  }

  function openEdit(group: ChannelGroup) {
    setEditing(group)
    setName(group.name)
    setDialogOpen(true)
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error('그룹 이름을 입력해 주세요')
      return
    }
    setSaving(true)
    try {
      const url = editing ? `/api/channel-groups/${editing.id}` : '/api/channel-groups'
      const method = editing ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? '저장 실패')
      toast.success(editing ? '그룹이 수정되었습니다' : '그룹이 생성되었습니다')
      setDialogOpen(false)
      await loadGroups()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(group: ChannelGroup) {
    if (!confirm(`"${group.name}" 그룹을 삭제하시겠습니까?`)) return
    try {
      const res = await fetch(`/api/channel-groups/${group.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? '삭제 실패')
      toast.success('그룹이 삭제되었습니다')
      await loadGroups()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>채널 그룹 관리</CardTitle>
          <CardDescription>채널을 묶어 분류합니다</CardDescription>
        </div>
        <Button size="sm" onClick={openNew}>
          <Plus className="mr-1 h-4 w-4" />새 그룹
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">불러오는 중...</p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">등록된 그룹이 없습니다</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>그룹명</TableHead>
                <TableHead className="text-right">채널 수</TableHead>
                <TableHead className="w-24 text-right">액션</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => (
                <TableRow key={group.id}>
                  <TableCell className="font-medium">{group.name}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {group._count?.channels ?? 0}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(group)}
                        aria-label="수정"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(group)}
                        aria-label="삭제"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? '그룹 수정' : '새 채널 그룹'}</DialogTitle>
            <DialogDescription>채널 그룹 이름을 입력해 주세요</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="cg-name">그룹명 *</Label>
            <Input
              id="cg-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 온라인몰"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              취소
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? '저장 중...' : '저장'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
