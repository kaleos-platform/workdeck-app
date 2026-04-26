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

type Category = {
  id: string
  name: string
  _count?: { products: number }
}

type Props = {
  /** 외부에서 Dialog 열림 상태 제어 (undefined이면 Card 모드로 렌더) */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** 카테고리 변경 후 콜백 */
  onChanged?: () => void
}

/**
 * 상품 카테고리 관리 컴포넌트.
 * - open/onOpenChange props가 있으면 Dialog 모드(외부 트리거)
 * - props 없으면 Card 모드로 렌더
 */
export function ShCategoryManager({ open, onOpenChange, onChanged }: Props) {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)

  // 편집 다이얼로그 상태
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Category | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  const loadCategories = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/sh/categories')
      if (!res.ok) throw new Error('카테고리 조회 실패')
      const data = await res.json()
      setCategories(data.categories ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '조회 실패')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Dialog 모드: open이 true가 될 때마다 로드
    if (open === undefined || open) {
      void loadCategories()
    }
  }, [open, loadCategories])

  function openNew() {
    setEditing(null)
    setName('')
    setEditDialogOpen(true)
  }

  function openEdit(cat: Category) {
    setEditing(cat)
    setName(cat.name)
    setEditDialogOpen(true)
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error('카테고리명을 입력해 주세요')
      return
    }
    setSaving(true)
    try {
      const url = editing ? `/api/sh/categories/${editing.id}` : '/api/sh/categories'
      const method = editing ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? '저장 실패')
      toast.success(editing ? '카테고리가 수정되었습니다' : '카테고리가 생성되었습니다')
      setEditDialogOpen(false)
      await loadCategories()
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(cat: Category) {
    if (!confirm(`"${cat.name}" 카테고리를 삭제하시겠습니까?`)) return
    try {
      const res = await fetch(`/api/sh/categories/${cat.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? '삭제 실패')
      toast.success('카테고리가 삭제되었습니다')
      await loadCategories()
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    }
  }

  // 카테고리 목록 테이블 (Card/Dialog 공통)
  const listContent = (
    <>
      {loading ? (
        <p className="text-sm text-muted-foreground">불러오는 중...</p>
      ) : categories.length === 0 ? (
        <p className="text-sm text-muted-foreground">등록된 카테고리가 없습니다</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>카테고리명</TableHead>
              <TableHead className="text-right">상품 수</TableHead>
              <TableHead className="w-24 text-right">액션</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.map((cat) => (
              <TableRow key={cat.id}>
                <TableCell className="font-medium">{cat.name}</TableCell>
                <TableCell className="text-right text-sm text-muted-foreground">
                  {cat._count?.products ?? 0}개
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEdit(cat)}
                      aria-label="수정"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(cat)}
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
    </>
  )

  // 편집/생성 다이얼로그 (공통)
  const editDialog = (
    <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? '카테고리 수정' : '새 카테고리 만들기'}</DialogTitle>
          <DialogDescription>카테고리 이름을 입력해 주세요</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="cat-name">카테고리명 *</Label>
            <Input
              id="cat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 상의, 하의, 잡화"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSave()
              }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setEditDialogOpen(false)} disabled={saving}>
            취소
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? '저장 중...' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  // Dialog 모드: 외부 open/onOpenChange로 제어
  if (open !== undefined && onOpenChange) {
    return (
      <>
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>카테고리 관리</DialogTitle>
              <DialogDescription>상품에 연결할 카테고리를 등록합니다</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="flex justify-end">
                <Button size="sm" onClick={openNew}>
                  <Plus className="mr-1 h-4 w-4" />새 카테고리
                </Button>
              </div>
              {listContent}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                닫기
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {editDialog}
      </>
    )
  }

  // Card 모드: 페이지에 직접 삽입
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>카테고리 관리</CardTitle>
          <CardDescription>상품에 연결할 카테고리를 등록합니다</CardDescription>
        </div>
        <Button size="sm" onClick={openNew}>
          <Plus className="mr-1 h-4 w-4" />새 카테고리
        </Button>
      </CardHeader>
      <CardContent>{listContent}</CardContent>
      {editDialog}
    </Card>
  )
}
