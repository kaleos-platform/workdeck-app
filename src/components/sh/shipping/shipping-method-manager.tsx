'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Pencil, Plus, Trash2, Upload } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FormatEditor } from '@/components/sh/shipping/format-editor'
import { FormatAnalyzeDialog } from '@/components/sh/shipping/format-analyze-dialog'
import type { DelFormatColumn } from '@/lib/del/format-templates'

type ShippingMethod = {
  id: string
  name: string
  isActive: boolean
  formatConfig: DelFormatColumn[]
}

export function ShippingMethodManager() {
  const [methods, setMethods] = useState<ShippingMethod[]>([])
  const [loading, setLoading] = useState(true)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ShippingMethod | null>(null)
  const [name, setName] = useState('')
  const [formatConfig, setFormatConfig] = useState<DelFormatColumn[]>([])
  const [saving, setSaving] = useState(false)
  const [analyzeOpen, setAnalyzeOpen] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/sh/shipping/shipping-methods')
      if (!res.ok) throw new Error('조회 실패')
      const data = await res.json()
      setMethods(data.methods ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '데이터 조회 실패')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  function openNew() {
    setEditing(null)
    setName('')
    setFormatConfig([])
    setDialogOpen(true)
  }

  function openEdit(method: ShippingMethod) {
    setEditing(method)
    setName(method.name)
    setFormatConfig(method.formatConfig)
    setDialogOpen(true)
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error('배송 방식 이름을 입력해 주세요')
      return
    }
    if (formatConfig.length === 0) {
      toast.error('포맷 설정을 추가해 주세요')
      return
    }
    setSaving(true)
    try {
      const url = editing
        ? `/api/sh/shipping/shipping-methods/${editing.id}`
        : '/api/sh/shipping/shipping-methods'
      const method = editing ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), formatConfig }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? '저장 실패')
      toast.success(editing ? '배송 방식이 수정되었습니다' : '배송 방식이 생성되었습니다')
      setDialogOpen(false)
      await loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(method: ShippingMethod) {
    if (!confirm(`"${method.name}" 배송 방식을 삭제(비활성화)하시겠습니까?`)) return
    try {
      const res = await fetch(`/api/sh/shipping/shipping-methods/${method.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('삭제 실패')
      toast.success('배송 방식이 비활성화되었습니다')
      await loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    }
  }

  const activeMethods = methods.filter((m) => m.isActive)
  const inactiveMethods = methods.filter((m) => !m.isActive)

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>배송 방식</CardTitle>
            <CardDescription>택배사 및 배송 파일 포맷을 관리합니다</CardDescription>
          </div>
          <Button size="sm" onClick={openNew}>
            <Plus className="mr-1 h-4 w-4" />새 배송 방식
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">불러오는 중...</p>
          ) : activeMethods.length === 0 && inactiveMethods.length === 0 ? (
            <p className="text-sm text-muted-foreground">등록된 배송 방식이 없습니다</p>
          ) : (
            <div className="space-y-3">
              {activeMethods.map((method) => (
                <div
                  key={method.id}
                  className="flex items-center justify-between rounded-md border px-4 py-3"
                >
                  <div>
                    <p className="font-medium">{method.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {method.formatConfig.length}개 컬럼
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge>활성</Badge>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(method)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(method)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
              {inactiveMethods.map((method) => (
                <div
                  key={method.id}
                  className="flex items-center justify-between rounded-md border border-dashed px-4 py-3 opacity-60"
                >
                  <div>
                    <p className="font-medium">{method.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {method.formatConfig.length}개 컬럼
                    </p>
                  </div>
                  <Badge variant="outline">비활성</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[80vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? '배송 방식 수정' : '새 배송 방식 만들기'}</DialogTitle>
            <DialogDescription>
              배송 방식 이름과 파일 포맷(컬럼 매핑)을 설정해 주세요
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="method-name">배송 방식 이름</Label>
              <Input
                id="method-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 한진택배"
              />
            </div>
            <div className="flex items-start justify-between gap-3 rounded-md border border-dashed bg-muted/30 p-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">양식에서 불러오기</p>
                <p className="text-xs text-muted-foreground">
                  택배사 엑셀 양식을 업로드하면 컬럼 매핑을 자동으로 분석합니다
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAnalyzeOpen(true)}
              >
                <Upload className="mr-1 h-4 w-4" />
                양식 업로드
              </Button>
            </div>
            <FormatEditor value={formatConfig} onChange={setFormatConfig} />
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

      <FormatAnalyzeDialog
        open={analyzeOpen}
        onOpenChange={setAnalyzeOpen}
        onApply={(cols) => {
          setFormatConfig(cols)
          setAnalyzeOpen(false)
          toast.success(`${cols.length}개 컬럼을 불러왔습니다`)
        }}
      />
    </>
  )
}
