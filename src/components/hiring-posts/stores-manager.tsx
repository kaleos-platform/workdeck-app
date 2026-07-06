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

export type StoreRow = {
  id: string
  name: string
  roadAddress: string | null
  detailAddress: string | null
  zipcode: string | null
  isActive: boolean
}

type FormState = { name: string; roadAddress: string; detailAddress: string; zipcode: string }
const EMPTY: FormState = { name: '', roadAddress: '', detailAddress: '', zipcode: '' }

export function StoresManager({ initialStores }: { initialStores: StoreRow[] }) {
  const [stores, setStores] = useState(initialStores)
  const [editingId, setEditingId] = useState<string | null>(null) // null=닫힘, 'new'=신규
  const [form, setForm] = useState<FormState>(EMPTY)
  const [saving, setSaving] = useState(false)

  function openNew() {
    setForm(EMPTY)
    setEditingId('new')
  }
  function openEdit(s: StoreRow) {
    setForm({
      name: s.name,
      roadAddress: s.roadAddress ?? '',
      detailAddress: s.detailAddress ?? '',
      zipcode: s.zipcode ?? '',
    })
    setEditingId(s.id)
  }

  async function refresh() {
    const res = await fetch('/api/hiring-posts/stores')
    if (res.ok) setStores((await res.json()).stores)
  }

  async function handleSubmit() {
    if (!form.name.trim()) {
      toast.error('매장명을 입력하세요')
      return
    }
    setSaving(true)
    try {
      const isNew = editingId === 'new'
      const res = await fetch(
        isNew ? '/api/hiring-posts/stores' : `/api/hiring-posts/stores/${editingId}`,
        {
          method: isNew ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: form.name.trim(),
            roadAddress: form.roadAddress.trim() || undefined,
            detailAddress: form.detailAddress.trim() || undefined,
            zipcode: form.zipcode.trim() || undefined,
          }),
        }
      )
      if (!res.ok) throw new Error('저장에 실패했습니다')
      await refresh()
      toast.success('매장을 저장했습니다')
      setEditingId(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장에 실패했습니다')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(s: StoreRow) {
    try {
      const res = await fetch(`/api/hiring-posts/stores/${s.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !s.isActive }),
      })
      if (!res.ok) throw new Error('상태 변경에 실패했습니다')
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '상태 변경에 실패했습니다')
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('이 매장을 삭제할까요?')) return
    try {
      const res = await fetch(`/api/hiring-posts/stores/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('삭제에 실패했습니다')
      await refresh()
      toast.success('매장을 삭제했습니다')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제에 실패했습니다')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {editingId === null && (
          <Button size="sm" onClick={openNew}>
            <Plus /> 매장 추가
          </Button>
        )}
      </div>

      {editingId !== null && (
        <div className="grid gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>매장명</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>우편번호</Label>
            <Input
              value={form.zipcode}
              onChange={(e) => setForm((f) => ({ ...f, zipcode: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>도로명 주소</Label>
            <Input
              value={form.roadAddress}
              onChange={(e) => setForm((f) => ({ ...f, roadAddress: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>상세 주소</Label>
            <Input
              value={form.detailAddress}
              onChange={(e) => setForm((f) => ({ ...f, detailAddress: e.target.value }))}
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
              <TableHead>매장명</TableHead>
              <TableHead>주소</TableHead>
              <TableHead className="w-20">상태</TableHead>
              <TableHead className="w-28 text-right">관리</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stores.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-sm text-muted-foreground">
                  등록된 매장이 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              stores.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-muted-foreground">{s.roadAddress ?? '-'}</TableCell>
                  <TableCell>
                    <button type="button" onClick={() => toggleActive(s)}>
                      {s.isActive ? (
                        <Badge variant="secondary">활성</Badge>
                      ) : (
                        <Badge variant="ghost">비활성</Badge>
                      )}
                    </button>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="icon-sm" variant="ghost" onClick={() => openEdit(s)}>
                      <Pencil />
                    </Button>
                    <Button size="icon-sm" variant="ghost" onClick={() => handleDelete(s.id)}>
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
