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
import { Textarea } from '@/components/ui/textarea'

type Brand = {
  id: string
  name: string
  logoUrl: string | null
  memo: string | null
  _count?: { products: number }
}

export function BrandManager() {
  const [brands, setBrands] = useState<Brand[]>([])
  const [loading, setLoading] = useState(true)

  // 다이얼로그 상태
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Brand | null>(null)
  const [name, setName] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [memo, setMemo] = useState('')
  const [saving, setSaving] = useState(false)

  const loadBrands = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/sh/brands')
      if (!res.ok) throw new Error('브랜드 조회 실패')
      const data = await res.json()
      setBrands(data.brands ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '조회 실패')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadBrands()
  }, [loadBrands])

  function openNew() {
    setEditing(null)
    setName('')
    setLogoUrl('')
    setMemo('')
    setDialogOpen(true)
  }

  function openEdit(brand: Brand) {
    setEditing(brand)
    setName(brand.name)
    setLogoUrl(brand.logoUrl ?? '')
    setMemo(brand.memo ?? '')
    setDialogOpen(true)
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error('브랜드명을 입력해 주세요')
      return
    }
    setSaving(true)
    try {
      const url = editing ? `/api/sh/brands/${editing.id}` : '/api/sh/brands'
      const method = editing ? 'PATCH' : 'POST'
      const trimmedLogo = logoUrl.trim()
      const trimmedMemo = memo.trim()
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          ...(trimmedLogo ? { logoUrl: trimmedLogo } : {}),
          ...(trimmedMemo ? { memo: trimmedMemo } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? '저장 실패')
      toast.success(editing ? '브랜드가 수정되었습니다' : '브랜드가 생성되었습니다')
      setDialogOpen(false)
      await loadBrands()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(brand: Brand) {
    if (!confirm(`"${brand.name}" 브랜드를 삭제하시겠습니까?`)) return
    try {
      const res = await fetch(`/api/sh/brands/${brand.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? '삭제 실패')
      toast.success('브랜드가 삭제되었습니다')
      await loadBrands()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>브랜드 관리</CardTitle>
          <CardDescription>상품에 연결할 브랜드를 등록합니다</CardDescription>
        </div>
        <Button size="sm" onClick={openNew}>
          <Plus className="mr-1 h-4 w-4" />새 브랜드
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">불러오는 중...</p>
        ) : brands.length === 0 ? (
          <p className="text-sm text-muted-foreground">등록된 브랜드가 없습니다</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>브랜드명</TableHead>
                <TableHead>메모</TableHead>
                <TableHead className="w-24 text-right">액션</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {brands.map((brand) => (
                <TableRow key={brand.id}>
                  <TableCell className="font-medium">{brand.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {brand.memo ?? '-'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(brand)}
                        aria-label="수정"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(brand)}
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
            <DialogTitle>{editing ? '브랜드 수정' : '새 브랜드 만들기'}</DialogTitle>
            <DialogDescription>브랜드 정보를 입력해 주세요</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="brand-name">브랜드명 *</Label>
              <Input
                id="brand-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 나이키"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="brand-logo">로고 URL (선택)</Label>
              <Input
                id="brand-logo"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="brand-memo">메모 (선택)</Label>
              <Textarea
                id="brand-memo"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="브랜드에 대한 메모"
                rows={3}
              />
            </div>
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
