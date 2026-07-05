'use client'

import { useEffect, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type Item = {
  id: string
  maskedPhone: string
  reason: string | null
  isActive: boolean
  createdAt: string
}

export function BlacklistManager() {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [phone, setPhone] = useState('')
  const [reason, setReason] = useState('')
  const [adding, setAdding] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/hiring-applicants/blacklist')
      if (!res.ok) throw new Error()
      const d = await res.json()
      setItems(d.items ?? [])
    } catch {
      toast.error('목록을 불러오지 못했습니다')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function add() {
    if (!phone.trim()) return
    setAdding(true)
    try {
      const res = await fetch('/api/hiring-applicants/blacklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim(), reason: reason.trim() || undefined }),
      })
      if (!res.ok) throw new Error()
      setPhone('')
      setReason('')
      toast.success('등록했습니다')
      load()
    } catch {
      toast.error('등록에 실패했습니다')
    } finally {
      setAdding(false)
    }
  }

  async function toggle(item: Item) {
    setBusyId(item.id)
    try {
      const res = await fetch(`/api/hiring-applicants/blacklist/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !item.isActive }),
      })
      if (!res.ok) throw new Error()
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, isActive: !i.isActive } : i)))
    } catch {
      toast.error('변경에 실패했습니다')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(id: string) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/hiring-applicants/blacklist/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      setItems((prev) => prev.filter((i) => i.id !== id))
    } catch {
      toast.error('삭제에 실패했습니다')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* 등록 폼 */}
      <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">전화번호</label>
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="010-1234-5678"
            className="w-44"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">사유 (선택)</label>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="등록 사유"
            className="w-56"
          />
        </div>
        <Button size="sm" onClick={add} disabled={adding || !phone.trim()}>
          {adding ? (
            <Loader2 className="mr-1 size-4 animate-spin" />
          ) : (
            <Plus className="mr-1 size-4" />
          )}
          추가
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>전화번호</TableHead>
              <TableHead>사유</TableHead>
              <TableHead className="w-24">활성</TableHead>
              <TableHead className="w-24 text-right">삭제</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                  불러오는 중...
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                  등록된 항목이 없습니다
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-mono text-sm">{item.maskedPhone}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {item.reason || '-'}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={item.isActive}
                      onCheckedChange={() => toggle(item)}
                      disabled={busyId === item.id}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => remove(item.id)}
                      disabled={busyId === item.id}
                      aria-label="삭제"
                    >
                      <Trash2 className="size-4 text-destructive" />
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
