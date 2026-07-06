'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Pencil, Trash2, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export type TemplateRow = {
  id: string
  name: string
  blockCount: number
  updatedAt: string
}

export function TemplatesManager({ initialTemplates }: { initialTemplates: TemplateRow[] }) {
  const [templates, setTemplates] = useState(initialTemplates)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  function openEdit(t: TemplateRow) {
    setName(t.name)
    setEditingId(t.id)
  }

  async function refresh() {
    const res = await fetch('/api/hiring-posts/templates')
    if (!res.ok) return
    const { templates: rows } = await res.json()
    setTemplates(
      rows.map(
        (t: { id: string; name: string; updatedAt: string; _count: { contents: number } }) => ({
          id: t.id,
          name: t.name,
          blockCount: t._count.contents,
          updatedAt: t.updatedAt,
        })
      )
    )
  }

  async function handleRename() {
    if (!name.trim()) {
      toast.error('템플릿 이름을 입력하세요')
      return
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/hiring-posts/templates/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (!res.ok) throw new Error('이름 변경에 실패했습니다')
      await refresh()
      setEditingId(null)
      toast.success('템플릿 이름을 변경했습니다')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '이름 변경에 실패했습니다')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('이 템플릿을 삭제할까요?')) return
    try {
      const res = await fetch(`/api/hiring-posts/templates/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('삭제에 실패했습니다')
      await refresh()
      toast.success('템플릿을 삭제했습니다')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제에 실패했습니다')
    }
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>이름</TableHead>
            <TableHead className="w-24 text-right">블록 수</TableHead>
            <TableHead className="w-28 text-right">관리</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {templates.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="h-24 text-center text-sm text-muted-foreground">
                저장된 템플릿이 없습니다. 공고 상세 스텝에서 “템플릿으로 저장”하세요.
              </TableCell>
            </TableRow>
          ) : (
            templates.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">
                  {editingId === t.id ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="h-8"
                      />
                      <Button size="icon-sm" variant="ghost" onClick={handleRename} disabled={busy}>
                        <Check />
                      </Button>
                      <Button size="icon-sm" variant="ghost" onClick={() => setEditingId(null)}>
                        <X />
                      </Button>
                    </div>
                  ) : (
                    t.name
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{t.blockCount}</TableCell>
                <TableCell className="text-right">
                  <Button size="icon-sm" variant="ghost" onClick={() => openEdit(t)}>
                    <Pencil />
                  </Button>
                  <Button size="icon-sm" variant="ghost" onClick={() => handleDelete(t.id)}>
                    <Trash2 />
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
