'use client'

import { useCallback, useEffect, useState } from 'react'
import { Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type ChannelKind = 'ONLINE_MARKETPLACE' | 'ONLINE_MALL' | 'OFFLINE' | 'INTERNAL_TRANSFER' | 'OTHER'

const KIND_LABELS: Record<ChannelKind, string> = {
  ONLINE_MARKETPLACE: '온라인 마켓플레이스',
  ONLINE_MALL: '온라인 쇼핑몰',
  OFFLINE: '오프라인',
  INTERNAL_TRANSFER: '내부 이관',
  OTHER: '기타',
}

type ChannelGroup = { id: string; name: string }

type Channel = {
  id: string
  name: string
  kind: ChannelKind
  groupId: string | null
  group: ChannelGroup | null
  adminUrl: string | null
  freeShipping: boolean
  usesMarketingBudget: boolean
  shippingFee: number | null
  vatIncludedInFee: boolean
  isActive: boolean
}

const NO_GROUP = '__none__'

export function ShChannelManager() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [groups, setGroups] = useState<ChannelGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Channel | null>(null)
  const [saving, setSaving] = useState(false)

  // 폼 상태
  const [fName, setFName] = useState('')
  const [fKind, setFKind] = useState<ChannelKind>('ONLINE_MARKETPLACE')
  const [fGroupId, setFGroupId] = useState(NO_GROUP)
  const [fAdminUrl, setFAdminUrl] = useState('')
  const [fFreeShipping, setFFreeShipping] = useState(false)
  const [fUsesMarketing, setFUsesMarketing] = useState(false)
  const [fShippingFee, setFShippingFee] = useState('')
  const [fVatIncluded, setFVatIncluded] = useState(false)
  const [fIsActive, setFIsActive] = useState(true)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [cRes, gRes] = await Promise.all([fetch('/api/channels'), fetch('/api/channel-groups')])
      if (!cRes.ok) throw new Error('채널 조회 실패')
      const cData = await cRes.json()
      setChannels(cData.channels ?? [])
      if (gRes.ok) {
        const gData = await gRes.json()
        setGroups(gData.groups ?? [])
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '조회 실패')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  function openNew() {
    setEditing(null)
    setFName('')
    setFKind('ONLINE_MARKETPLACE')
    setFGroupId(NO_GROUP)
    setFAdminUrl('')
    setFFreeShipping(false)
    setFUsesMarketing(false)
    setFShippingFee('')
    setFVatIncluded(false)
    setFIsActive(true)
    setDialogOpen(true)
  }

  function openEdit(ch: Channel) {
    setEditing(ch)
    setFName(ch.name)
    setFKind(ch.kind)
    setFGroupId(ch.groupId ?? NO_GROUP)
    setFAdminUrl(ch.adminUrl ?? '')
    setFFreeShipping(ch.freeShipping)
    setFUsesMarketing(ch.usesMarketingBudget)
    setFShippingFee(ch.shippingFee != null ? String(ch.shippingFee) : '')
    setFVatIncluded(ch.vatIncludedInFee)
    setFIsActive(ch.isActive)
    setDialogOpen(true)
  }

  async function handleSave() {
    if (!fName.trim()) {
      toast.error('채널명을 입력해 주세요')
      return
    }
    setSaving(true)
    try {
      const url = editing ? `/api/channels/${editing.id}` : '/api/channels'
      const method = editing ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fName.trim(),
          kind: fKind,
          groupId: fGroupId !== NO_GROUP ? fGroupId : null,
          adminUrl: fAdminUrl.trim() || null,
          freeShipping: fFreeShipping,
          usesMarketingBudget: fUsesMarketing,
          shippingFee: fShippingFee ? parseFloat(fShippingFee) : null,
          vatIncludedInFee: fVatIncluded,
          isActive: fIsActive,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? '저장 실패')
      toast.success(editing ? '채널이 수정되었습니다' : '채널이 생성되었습니다')
      setDialogOpen(false)
      await loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(ch: Channel) {
    try {
      const res = await fetch(`/api/channels/${ch.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !ch.isActive }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? '상태 변경 실패')
      toast.success(!ch.isActive ? '활성화되었습니다' : '비활성화되었습니다')
      await loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '상태 변경 실패')
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>채널 관리</CardTitle>
          <CardDescription>판매 채널을 등록하고 관리합니다</CardDescription>
        </div>
        <Button size="sm" onClick={openNew}>
          <Plus className="mr-1 h-4 w-4" />새 채널
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">불러오는 중...</p>
        ) : channels.length === 0 ? (
          <p className="text-sm text-muted-foreground">등록된 채널이 없습니다</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>채널명</TableHead>
                <TableHead>종류</TableHead>
                <TableHead>그룹</TableHead>
                <TableHead>상태</TableHead>
                <TableHead className="text-right">액션</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {channels.map((ch) => (
                <TableRow key={ch.id}>
                  <TableCell className="font-medium">{ch.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {KIND_LABELS[ch.kind]}
                  </TableCell>
                  <TableCell>
                    {ch.group ? (
                      <Badge variant="secondary">{ch.group.name}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {ch.isActive ? <Badge>활성</Badge> : <Badge variant="outline">비활성</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(ch)}
                        aria-label="수정"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => toggleActive(ch)}>
                        {ch.isActive ? '비활성화' : '활성화'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* 채널 다이얼로그 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? '채널 수정' : '새 채널 만들기'}</DialogTitle>
            <DialogDescription>판매 채널 정보를 입력해 주세요</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-4 overflow-y-auto py-2 pr-1">
            <div className="space-y-2">
              <Label htmlFor="ch-name">채널명 *</Label>
              <Input
                id="ch-name"
                value={fName}
                onChange={(e) => setFName(e.target.value)}
                placeholder="예: 쿠팡"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>채널 종류</Label>
                <Select value={fKind} onValueChange={(v) => setFKind(v as ChannelKind)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(KIND_LABELS).map(([k, label]) => (
                      <SelectItem key={k} value={k}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>그룹 (선택)</Label>
                <Select value={fGroupId} onValueChange={setFGroupId}>
                  <SelectTrigger>
                    <SelectValue placeholder="그룹 없음" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_GROUP}>그룹 없음</SelectItem>
                    {groups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ch-admin-url">어드민 URL (선택)</Label>
              <Input
                id="ch-admin-url"
                value={fAdminUrl}
                onChange={(e) => setFAdminUrl(e.target.value)}
                placeholder="https://wing.coupang.com/..."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ch-shipping-fee">배송비 (원)</Label>
              <Input
                id="ch-shipping-fee"
                type="number"
                min="0"
                value={fShippingFee}
                onChange={(e) => setFShippingFee(e.target.value)}
                placeholder="0"
              />
            </div>

            {/* 스위치 그룹 */}
            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="ch-free-shipping">무료 배송</Label>
                  <p className="text-xs text-muted-foreground">이 채널은 무료 배송 제공</p>
                </div>
                <Switch
                  id="ch-free-shipping"
                  checked={fFreeShipping}
                  onCheckedChange={setFFreeShipping}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="ch-marketing">마케팅 예산 사용</Label>
                  <p className="text-xs text-muted-foreground">채널 광고비 별도 운영</p>
                </div>
                <Switch
                  id="ch-marketing"
                  checked={fUsesMarketing}
                  onCheckedChange={setFUsesMarketing}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="ch-vat">수수료에 VAT 포함</Label>
                  <p className="text-xs text-muted-foreground">부가세 포함 수수료율 기준</p>
                </div>
                <Switch id="ch-vat" checked={fVatIncluded} onCheckedChange={setFVatIncluded} />
              </div>
              {editing && (
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="ch-active">활성 상태</Label>
                    <p className="text-xs text-muted-foreground">비활성 시 신규 주문에 사용 불가</p>
                  </div>
                  <Switch id="ch-active" checked={fIsActive} onCheckedChange={setFIsActive} />
                </div>
              )}
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
