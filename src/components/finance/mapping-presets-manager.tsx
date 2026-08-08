'use client'

/**
 * 업로드 매핑 규칙(FinMappingPreset) 관리 — 목록 / 이름 변경 / 삭제.
 * 규칙 식별은 파일명이 아니라 **파일 형식(헤더 서명)** 이므로, 이름은 표시용 라벨이다.
 * 잘못 쌓인 규칙을 정리하거나 이름을 정리할 때 사용한다.
 */
import { useCallback, useEffect, useState } from 'react'
import { Check, CreditCard, Landmark, Loader2, Pencil, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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
import { fieldLabel, type FinKind, type MappingEntry } from '@/components/finance/upload/types'

type PresetRow = {
  id: string
  name: string
  institution: string
  kind: FinKind
  mapping: MappingEntry[]
  defaultAccountId: string | null
  updatedAt: string
}

type AccountOption = { id: string; name: string }

/** 매핑 요약: "적요·내용 → 적요/내용" 형태로 필드별 헤더를 묶어 보여준다. */
function summarizeMapping(mapping: MappingEntry[], kind: FinKind): string {
  const byField = new Map<string, string[]>()
  for (const { headerName, field } of mapping ?? []) {
    const arr = byField.get(field) ?? []
    arr.push(headerName)
    byField.set(field, arr)
  }
  return [...byField.entries()]
    .map(([field, headers]) => `${headers.join('·')} → ${fieldLabel(field, kind)}`)
    .join(', ')
}

export function MappingPresetsManager() {
  const [rows, setRows] = useState<PresetRow[]>([])
  const [accounts, setAccounts] = useState<AccountOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<PresetRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/finance/mapping-presets')
      if (!res.ok) throw new Error('규칙 목록을 불러오지 못했습니다')
      const data = await res.json()
      setRows((data?.presets ?? []) as PresetRow[])
    } catch (e) {
      setError(e instanceof Error ? e.message : '규칙 목록을 불러오지 못했습니다')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/finance/accounts')
        if (!res.ok) return
        const data = await res.json()
        const list = (data?.accounts ?? data ?? []) as AccountOption[]
        if (Array.isArray(list)) setAccounts(list)
      } catch {
        // 계좌 이름은 부가 정보 — 실패해도 목록은 보여준다
      }
    })()
  }, [])

  async function submitRename(id: string) {
    const name = editingName.trim()
    if (!name) return
    setSaving(true)
    try {
      const res = await fetch(`/api/finance/mapping-presets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? '이름 변경 실패')
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, name } : r)))
      setEditingId(null)
      toast.success('규칙 이름을 변경했습니다')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '이름 변경 실패')
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/finance/mapping-presets/${deleteTarget.id}`, {
        method: 'DELETE',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? '삭제 실패')
      setRows((prev) => prev.filter((r) => r.id !== deleteTarget.id))
      toast.success('규칙을 삭제했습니다')
      setDeleteTarget(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '삭제 실패')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">업로드 매핑 규칙</CardTitle>
        <p className="text-sm text-muted-foreground">
          같은 <strong>파일 형식</strong>(헤더 구성)을 다시 올리면 자동 적용되는 컬럼 매핑입니다.
          파일 이름과는 무관합니다.
        </p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…
          </div>
        ) : error ? (
          <div className="flex items-center gap-3 py-6 text-sm text-destructive">
            {error}
            <Button variant="outline" size="sm" onClick={() => void load()}>
              다시 시도
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            저장된 규칙이 없습니다. 데이터 등록 화면에서 &quot;이 규칙 기억&quot;을 켜면 생성됩니다.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>규칙 이름</TableHead>
                  <TableHead className="w-20">종류</TableHead>
                  <TableHead className="w-32">기관</TableHead>
                  <TableHead>컬럼 매핑</TableHead>
                  <TableHead className="w-40">기본 계좌</TableHead>
                  <TableHead className="w-28">최근 갱신</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const account = accounts.find((a) => a.id === row.defaultAccountId)
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">
                        {editingId === row.id ? (
                          <div className="flex items-center gap-1">
                            <Input
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') void submitRename(row.id)
                                if (e.key === 'Escape') setEditingId(null)
                              }}
                              className="h-8 max-w-52 text-sm"
                              maxLength={100}
                              autoFocus
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              disabled={saving}
                              onClick={() => void submitRename(row.id)}
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
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="group flex items-center gap-1.5 text-left"
                            onClick={() => {
                              setEditingId(row.id)
                              setEditingName(row.name)
                            }}
                          >
                            {row.name}
                            <Pencil className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
                          </button>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="gap-1 font-normal">
                          {row.kind === 'CARD' ? (
                            <CreditCard className="h-3 w-3" />
                          ) : (
                            <Landmark className="h-3 w-3" />
                          )}
                          {row.kind === 'CARD' ? '카드' : '은행'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.institution}
                      </TableCell>
                      <TableCell className="text-xs break-keep text-muted-foreground">
                        {summarizeMapping(row.mapping, row.kind)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {account?.name ?? '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.updatedAt.slice(0, 10)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteTarget(row)}
                          aria-label="규칙 삭제"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>규칙 삭제</DialogTitle>
            <DialogDescription>
              &quot;{deleteTarget?.name}&quot; 규칙을 삭제합니다. 이미 등록한 거래에는 영향이 없고,
              다음에 같은 형식의 파일을 올리면 컬럼 매핑이 자동 인식으로 되돌아갑니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              취소
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()} disabled={deleting}>
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              삭제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
