'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Pencil, Trash2, Check, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
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
  isSample: boolean
}

export function TemplatesManager({ initialTemplates }: { initialTemplates: TemplateRow[] }) {
  const router = useRouter()
  const busyRef = useRef(false)
  const [templates, setTemplates] = useState(initialTemplates)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  function openEdit(t: TemplateRow) {
    if (busyRef.current) return
    setName(t.name)
    setEditingId(t.id)
  }

  async function handleRename() {
    if (busyRef.current || !editingId) return
    if (!name.trim()) {
      toast.error('템플릿 이름을 입력하세요')
      return
    }
    busyRef.current = true
    setBusy(true)
    try {
      const res = await fetch(`/api/hiring-posts/templates/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (!res.ok) throw new Error('이름 변경에 실패했습니다')
      const { template } = await res.json()
      setTemplates((current) =>
        current.map((row) =>
          row.id === template.id
            ? { ...row, name: template.name, updatedAt: template.updatedAt }
            : row
        )
      )
      setEditingId(null)
      router.refresh()
      toast.success('템플릿 이름을 변경했습니다')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '이름 변경에 실패했습니다')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  async function handleDelete(id: string) {
    if (busyRef.current) return
    if (!confirm('이 템플릿을 삭제할까요?')) return
    busyRef.current = true
    setBusy(true)
    try {
      const res = await fetch(`/api/hiring-posts/templates/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('삭제에 실패했습니다')
      setTemplates((current) => current.filter((row) => row.id !== id))
      if (editingId === id) setEditingId(null)
      router.refresh()
      toast.success('템플릿을 삭제했습니다')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제에 실패했습니다')
    } finally {
      busyRef.current = false
      setBusy(false)
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
                저장된 템플릿이 없습니다. 공고 꾸미기에서 “템플릿으로 저장”하세요.
              </TableCell>
            </TableRow>
          ) : (
            templates.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">
                  {editingId === t.id ? (
                    <div className="flex items-center gap-2">
                      <Input
                        aria-label="템플릿 이름"
                        disabled={busy}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="h-8"
                      />
                      <Button
                        aria-label="이름 저장"
                        size="icon-sm"
                        variant="ghost"
                        onClick={handleRename}
                        disabled={busy}
                      >
                        <Check />
                      </Button>
                      <Button
                        disabled={busy}
                        aria-label="이름 변경 취소"
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => setEditingId(null)}
                      >
                        <X />
                      </Button>
                    </div>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      {t.name}
                      {t.isSample && (
                        <Badge variant="secondary" className="font-normal">
                          샘플
                        </Badge>
                      )}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{t.blockCount}</TableCell>
                <TableCell className="text-right">
                  {t.isSample ? (
                    <span className="text-xs text-muted-foreground">읽기전용</span>
                  ) : (
                    <>
                      <Button
                        disabled={busy}
                        aria-label={`${t.name} 이름 변경`}
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => openEdit(t)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        disabled={busy}
                        aria-label={`${t.name} 삭제`}
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => handleDelete(t.id)}
                      >
                        <Trash2 />
                      </Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
