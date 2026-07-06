'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export type PositionRow = {
  id: string
  name: string
  category: string | null
  isActive: boolean
}

type FormState = { name: string; category: string }
const EMPTY: FormState = { name: '', category: '' }

export function PositionsManager({ initialPositions }: { initialPositions: PositionRow[] }) {
  const [positions, setPositions] = useState(initialPositions)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [saving, setSaving] = useState(false)

  function openNew() {
    setForm(EMPTY)
    setEditingId('new')
  }
  function openEdit(p: PositionRow) {
    setForm({ name: p.name, category: p.category ?? '' })
    setEditingId(p.id)
  }

  async function refresh() {
    const res = await fetch('/api/hiring-posts/positions')
    if (res.ok) setPositions((await res.json()).positions)
  }

  async function handleSubmit() {
    if (!form.name.trim()) {
      toast.error('직무명을 입력하세요')
      return
    }
    setSaving(true)
    try {
      const isNew = editingId === 'new'
      const res = await fetch(
        isNew ? '/api/hiring-posts/positions' : `/api/hiring-posts/positions/${editingId}`,
        {
          method: isNew ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: form.name.trim(),
            category: form.category.trim() || undefined,
          }),
        }
      )
      if (!res.ok) throw new Error('저장에 실패했습니다')
      await refresh()
      toast.success('직무를 저장했습니다')
      setEditingId(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장에 실패했습니다')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(p: PositionRow) {
    try {
      const res = await fetch(`/api/hiring-posts/positions/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !p.isActive }),
      })
      if (!res.ok) throw new Error('상태 변경에 실패했습니다')
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '상태 변경에 실패했습니다')
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('이 직무를 삭제할까요?')) return
    try {
      const res = await fetch(`/api/hiring-posts/positions/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('삭제에 실패했습니다')
      await refresh()
      toast.success('직무를 삭제했습니다')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제에 실패했습니다')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {editingId === null && (
          <Button size="sm" onClick={openNew}>
            <Plus /> 직무 추가
          </Button>
        )}
      </div>

      {editingId !== null && (
        <div className="grid gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>직무명</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>직군 분류</Label>
            <Input
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              placeholder="예: 서비스직"
            />
          </div>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditingId(null)}
              disabled={saving}
            >
              취소
            </Button>
            <Button size="sm" onClick={handleSubmit} disabled={saving}>
              저장
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>직무명</TableHead>
              <TableHead>직군</TableHead>
              <TableHead className="w-20">상태</TableHead>
              <TableHead className="w-28 text-right">관리</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {positions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-sm text-muted-foreground">
                  등록된 직무가 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              positions.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-muted-foreground">{p.category ?? '-'}</TableCell>
                  <TableCell>
                    <button type="button" onClick={() => toggleActive(p)}>
                      {p.isActive ? (
                        <Badge variant="secondary">활성</Badge>
                      ) : (
                        <Badge variant="ghost">비활성</Badge>
                      )}
                    </button>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="icon-sm" variant="ghost" onClick={() => openEdit(p)}>
                      <Pencil />
                    </Button>
                    <Button size="icon-sm" variant="ghost" onClick={() => handleDelete(p.id)}>
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
