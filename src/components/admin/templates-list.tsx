'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Pencil, Trash2, Check, X, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
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

export type SampleTemplateRow = {
  id: string
  name: string
  imagePath: string | null
  updatedAt: string
  blockCount: number
}

function formatAt(at: string): string {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
}

export function TemplatesList({ initialTemplates }: { initialTemplates: SampleTemplateRow[] }) {
  const router = useRouter()
  const [templates, setTemplates] = useState(initialTemplates)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [creating, setCreating] = useState(false)

  async function refresh() {
    const res = await fetch('/api/admin/hiring-templates')
    if (!res.ok) return
    const { templates: rows } = await res.json()
    setTemplates(
      rows.map(
        (t: {
          id: string
          name: string
          imagePath: string | null
          updatedAt: string
          _count: { contents: number }
        }) => ({
          id: t.id,
          name: t.name,
          imagePath: t.imagePath,
          updatedAt: t.updatedAt,
          blockCount: t._count.contents,
        })
      )
    )
  }

  function openEdit(t: SampleTemplateRow) {
    setName(t.name)
    setEditingId(t.id)
  }

  async function handleRename() {
    if (!name.trim()) {
      toast.error('템플릿 이름을 입력하세요')
      return
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/hiring-templates/${editingId}`, {
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
    if (!confirm('이 샘플 템플릿을 삭제할까요? 전 워크스페이스에서 더 이상 불러올 수 없습니다.'))
      return
    try {
      const res = await fetch(`/api/admin/hiring-templates/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('삭제에 실패했습니다')
      await refresh()
      toast.success('템플릿을 삭제했습니다')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제에 실패했습니다')
    }
  }

  async function handleCreate() {
    if (!createName.trim()) {
      toast.error('템플릿 이름을 입력하세요')
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/admin/hiring-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: createName.trim() }),
      })
      if (!res.ok) throw new Error('템플릿 생성에 실패했습니다')
      const { template } = await res.json()
      setCreateOpen(false)
      setCreateName('')
      toast.success('템플릿을 생성했습니다')
      router.push(`/admin/templates/${template.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '템플릿 생성에 실패했습니다')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus /> 새 템플릿
        </Button>
      </div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>이름</TableHead>
              <TableHead className="w-24 text-right">블록 수</TableHead>
              <TableHead className="w-40">수정일</TableHead>
              <TableHead className="w-28 text-right">관리</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-sm text-muted-foreground">
                  샘플 템플릿이 없습니다. 새 템플릿 버튼으로 만들어 보세요.
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
                          autoFocus
                        />
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={handleRename}
                          disabled={busy}
                        >
                          <Check />
                        </Button>
                        <Button size="icon-sm" variant="ghost" onClick={() => setEditingId(null)}>
                          <X />
                        </Button>
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        <Link href={`/admin/templates/${t.id}`} className="hover:underline">
                          {t.name}
                        </Link>
                        {/* 블록 0개 — 고객 화면(불러오기 목록)에서는 자동 제외됨(빈 샘플 노출 방지) */}
                        {t.blockCount === 0 && (
                          <Badge variant="secondary" className="font-normal">
                            고객 미노출
                          </Badge>
                        )}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{t.blockCount}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatAt(t.updatedAt)}
                  </TableCell>
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

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>새 샘플 템플릿</DialogTitle>
          </DialogHeader>
          <Input
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder="예: 매장 알바 기본 상세"
            maxLength={200}
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              취소
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={creating}>
              생성
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
