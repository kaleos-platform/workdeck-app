'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Pencil, Plus, PowerOff, ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { LocationMappingTable } from '@/components/inv/location-mapping-table'

type LocationRow = {
  id: string
  name: string
  isActive: boolean
  createdAt: string
  _count?: { stockLevels: number }
}

export function LocationManager() {
  const [locations, setLocations] = useState<LocationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<LocationRow | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/inv/locations')
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? '위치 목록 조회 실패')
      setLocations(data.locations ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '위치 목록 조회 실패')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function openCreate() {
    setEditing(null)
    setName('')
    setDialogOpen(true)
  }

  function openEdit(loc: LocationRow) {
    setEditing(loc)
    setName(loc.name)
    setDialogOpen(true)
  }

  async function handleSave() {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('위치명을 입력하세요')
      return
    }
    setSaving(true)
    try {
      const url = editing
        ? `/api/inv/locations/${editing.id}`
        : '/api/inv/locations'
      const method = editing ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? '저장 실패')
      toast.success(editing ? '위치를 수정했습니다' : '위치를 추가했습니다')
      setDialogOpen(false)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeactivate(loc: LocationRow) {
    if (!confirm(`"${loc.name}" 위치를 비활성화하시겠습니까?`)) return
    setDeactivatingId(loc.id)
    try {
      const res = await fetch(`/api/inv/locations/${loc.id}`, {
        method: 'DELETE',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? '비활성화 실패')
      toast.success('비활성화했습니다')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '비활성화 실패')
    } finally {
      setDeactivatingId(null)
    }
  }

  async function handleReactivate(loc: LocationRow) {
    try {
      const res = await fetch(`/api/inv/locations/${loc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? '활성화 실패')
      toast.success('활성화했습니다')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '활성화 실패')
    }
  }

  function toggleExpand(id: string) {
    setExpandedId((cur) => (cur === id ? null : id))
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />새 위치
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]"></TableHead>
              <TableHead>위치명</TableHead>
              <TableHead>상태</TableHead>
              <TableHead>재고 항목</TableHead>
              <TableHead>생성일</TableHead>
              <TableHead className="text-right">액션</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                </TableCell>
              </TableRow>
            ) : locations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  등록된 보관 장소가 없습니다. "새 위치"로 추가하세요.
                </TableCell>
              </TableRow>
            ) : (
              locations.map((loc) => {
                const expanded = expandedId === loc.id
                return (
                  <Fragment key={loc.id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => toggleExpand(loc.id)}
                    >
                      <TableCell>
                        {expanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </TableCell>
                      <TableCell className="font-medium">{loc.name}</TableCell>
                      <TableCell>
                        {loc.isActive ? (
                          <Badge variant="default">활성</Badge>
                        ) : (
                          <Badge variant="secondary">비활성</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {loc._count?.stockLevels ?? 0}건
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(loc.createdAt).toLocaleDateString('ko-KR')}
                      </TableCell>
                      <TableCell
                        className="text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEdit(loc)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {loc.isActive ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={deactivatingId === loc.id}
                              onClick={() => handleDeactivate(loc)}
                            >
                              {deactivatingId === loc.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <PowerOff className="h-4 w-4" />
                              )}
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleReactivate(loc)}
                            >
                              활성화
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    {expanded && (
                      <TableRow>
                        <TableCell colSpan={6} className="bg-muted/30 p-4">
                          <LocationMappingTable locationId={loc.id} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing ? '위치 수정' : '새 보관 장소'}
            </DialogTitle>
            <DialogDescription>
              재고가 보관되는 장소의 이름을 입력하세요. (예: 쿠팡 로켓그로스, 자사창고)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="location-name">위치명</Label>
            <Input
              id="location-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 자사창고 1층"
              disabled={saving}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              취소
            </Button>
            <Button onClick={handleSave} disabled={saving || !name.trim()}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  저장 중
                </>
              ) : (
                '저장'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
