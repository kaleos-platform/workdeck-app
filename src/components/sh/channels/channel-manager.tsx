'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react'
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
import { ChannelFeeRatesInline } from './channel-fee-rates-inline'

// ─── 타입 ────────────────────────────────────────────────────────────────────

type ChannelKind = 'ONLINE_MARKETPLACE' | 'ONLINE_MALL' | 'OFFLINE' | 'INTERNAL_TRANSFER' | 'OTHER'
type ChannelType = 'OPEN_MARKET' | 'DEPT_STORE' | 'SELF_MALL' | 'SOCIAL' | 'WHOLESALE' | 'OTHER'

const KIND_LABELS: Record<ChannelKind, string> = {
  ONLINE_MARKETPLACE: '온라인 마켓플레이스',
  ONLINE_MALL: '온라인 쇼핑몰',
  OFFLINE: '오프라인',
  INTERNAL_TRANSFER: '내부 이관',
  OTHER: '기타',
}

const CHANNEL_TYPE_LABELS: Record<ChannelType, string> = {
  OPEN_MARKET: '오픈마켓',
  DEPT_STORE: '백화점 온라인',
  SELF_MALL: '자사몰',
  SOCIAL: 'SNS 채널',
  WHOLESALE: '도매',
  OTHER: '기타',
}

type ChannelGroup = {
  id: string
  name: string
}

type Channel = {
  id: string
  name: string
  kind: ChannelKind
  channelType: ChannelType
  groupId: string | null
  group: ChannelGroup | null
  adminUrl: string | null
  freeShipping: boolean
  freeShippingThreshold: number | null
  defaultFeePct: number | null
  usesMarketingBudget: boolean
  applyAdCost: boolean
  shippingFee: number | null
  vatIncludedInFee: boolean
  paymentFeeIncluded: boolean
  paymentFeePct: number | null
  isActive: boolean
}

// 채널 편집 폼에서 그룹 없음을 표현하는 센티널 값
const NO_GROUP = '__none__'
// 필터에서 "전체"를 표현하는 센티널 값
const ALL = '__all__'

// ─── 컴포넌트 ─────────────────────────────────────────────────────────────────

export function ShChannelManager() {
  // ── 데이터 상태 ──
  const [channels, setChannels] = useState<Channel[]>([])
  const [groups, setGroups] = useState<ChannelGroup[]>([])
  const [loading, setLoading] = useState(true)

  // ── 채널 테이블 확장 ──
  const [expandedChannelId, setExpandedChannelId] = useState<string | null>(null)

  // ── 채널 필터 ──
  const [filterGroupId, setFilterGroupId] = useState(ALL)
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all')
  const [filterSearch, setFilterSearch] = useState('')

  // ── 채널 다이얼로그 상태 ──
  const [channelDialogOpen, setChannelDialogOpen] = useState(false)
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null)
  const [savingChannel, setSavingChannel] = useState(false)

  // 채널 폼 필드 — 기존
  const [fName, setFName] = useState('')
  const [fKind, setFKind] = useState<ChannelKind>('ONLINE_MARKETPLACE')
  const [fGroupId, setFGroupId] = useState(NO_GROUP)
  const [fAdminUrl, setFAdminUrl] = useState('')
  const [fFreeShipping, setFFreeShipping] = useState(false)
  const [fUsesMarketing, setFUsesMarketing] = useState(false)
  const [fShippingFee, setFShippingFee] = useState('')
  const [fVatIncluded, setFVatIncluded] = useState(false)
  const [fIsActive, setFIsActive] = useState(true)

  // 채널 폼 필드 — 신규
  const [fChannelType, setFChannelType] = useState<ChannelType>('OTHER')
  const [fFreeShippingThreshold, setFFreeShippingThreshold] = useState('')
  const [fDefaultFeePct, setFDefaultFeePct] = useState('')
  const [fApplyAdCost, setFApplyAdCost] = useState(false)
  const [fPaymentFeeIncluded, setFPaymentFeeIncluded] = useState(true)
  const [fPaymentFeePct, setFPaymentFeePct] = useState('')

  // ── 그룹 다이얼로그 상태 ──
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<ChannelGroup | null>(null)
  const [gName, setGName] = useState('')
  const [savingGroup, setSavingGroup] = useState(false)

  // ── 데이터 로드 ──

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

  // ── 채널 필터 적용 ──

  const filteredChannels = useMemo(() => {
    return channels.filter((ch) => {
      if (filterGroupId !== ALL) {
        if (filterGroupId === NO_GROUP && ch.groupId !== null) return false
        if (filterGroupId !== NO_GROUP && ch.groupId !== filterGroupId) return false
      }
      if (filterStatus === 'active' && !ch.isActive) return false
      if (filterStatus === 'inactive' && ch.isActive) return false
      if (filterSearch) {
        const q = filterSearch.toLowerCase()
        return ch.name.toLowerCase().includes(q)
      }
      return true
    })
  }, [channels, filterGroupId, filterStatus, filterSearch])

  // ── 채널 편집 다이얼로그 ──

  function openNewChannel() {
    setEditingChannel(null)
    setFName('')
    setFKind('ONLINE_MARKETPLACE')
    setFChannelType('OTHER')
    setFGroupId(NO_GROUP)
    setFAdminUrl('')
    setFFreeShipping(false)
    setFFreeShippingThreshold('')
    setFDefaultFeePct('')
    setFUsesMarketing(false)
    setFApplyAdCost(false)
    setFShippingFee('')
    setFVatIncluded(false)
    setFPaymentFeeIncluded(true)
    setFPaymentFeePct('')
    setFIsActive(true)
    setChannelDialogOpen(true)
  }

  function openEditChannel(ch: Channel) {
    setEditingChannel(ch)
    setFName(ch.name)
    setFKind(ch.kind)
    setFChannelType(ch.channelType)
    setFGroupId(ch.groupId ?? NO_GROUP)
    setFAdminUrl(ch.adminUrl ?? '')
    setFFreeShipping(ch.freeShipping)
    setFFreeShippingThreshold(
      ch.freeShippingThreshold != null ? String(ch.freeShippingThreshold) : ''
    )
    setFDefaultFeePct(ch.defaultFeePct != null ? String(ch.defaultFeePct * 100) : '')
    setFUsesMarketing(ch.usesMarketingBudget)
    setFApplyAdCost(ch.applyAdCost)
    setFShippingFee(ch.shippingFee != null ? String(ch.shippingFee) : '')
    setFVatIncluded(ch.vatIncludedInFee)
    setFPaymentFeeIncluded(ch.paymentFeeIncluded)
    setFPaymentFeePct(ch.paymentFeePct != null ? String(ch.paymentFeePct * 100) : '')
    setFIsActive(ch.isActive)
    setChannelDialogOpen(true)
  }

  async function handleSaveChannel() {
    if (!fName.trim()) {
      toast.error('채널명을 입력해 주세요')
      return
    }
    setSavingChannel(true)
    try {
      const url = editingChannel ? `/api/channels/${editingChannel.id}` : '/api/channels'
      const method = editingChannel ? 'PATCH' : 'POST'

      const body: Record<string, unknown> = {
        name: fName.trim(),
        kind: fKind,
        channelType: fChannelType,
        freeShipping: fFreeShipping,
        usesMarketingBudget: fUsesMarketing,
        applyAdCost: fApplyAdCost,
        vatIncludedInFee: fVatIncluded,
        paymentFeeIncluded: fPaymentFeeIncluded,
        isActive: fIsActive,
      }
      if (fGroupId !== NO_GROUP) body.groupId = fGroupId
      if (fAdminUrl.trim()) body.adminUrl = fAdminUrl.trim()
      if (fShippingFee) body.shippingFee = parseFloat(fShippingFee)
      if (fFreeShippingThreshold) body.freeShippingThreshold = parseFloat(fFreeShippingThreshold)
      // UI에서 % 단위로 입력 → 0~1로 변환
      if (fDefaultFeePct) body.defaultFeePct = parseFloat(fDefaultFeePct) / 100
      if (fPaymentFeePct) body.paymentFeePct = parseFloat(fPaymentFeePct) / 100

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        const fieldErrors = data?.errors?.fieldErrors as
          | Record<string, string[] | undefined>
          | undefined
        const firstField = fieldErrors
          ? Object.entries(fieldErrors).find(([, v]) => v && v.length > 0)
          : undefined
        const suffix = firstField ? ` (${firstField[0]}: ${firstField[1]?.[0]})` : ''
        throw new Error((data?.message ?? '저장 실패') + suffix)
      }
      toast.success(editingChannel ? '채널이 수정되었습니다' : '채널이 생성되었습니다')
      setChannelDialogOpen(false)
      await loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSavingChannel(false)
    }
  }

  async function toggleChannelActive(ch: Channel) {
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

  // ── 그룹 편집 다이얼로그 ──

  function openNewGroup() {
    setEditingGroup(null)
    setGName('')
    setGroupDialogOpen(true)
  }

  function openEditGroup(group: ChannelGroup) {
    setEditingGroup(group)
    setGName(group.name)
    setGroupDialogOpen(true)
  }

  async function handleSaveGroup() {
    if (!gName.trim()) {
      toast.error('그룹 이름을 입력해 주세요')
      return
    }
    setSavingGroup(true)
    try {
      const url = editingGroup ? `/api/channel-groups/${editingGroup.id}` : '/api/channel-groups'
      const method = editingGroup ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: gName.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? '저장 실패')
      toast.success(editingGroup ? '그룹이 수정되었습니다' : '그룹이 생성되었습니다')
      setGroupDialogOpen(false)
      await loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSavingGroup(false)
    }
  }

  async function handleDeleteGroup(group: ChannelGroup) {
    if (!confirm(`"${group.name}" 그룹을 삭제하시겠습니까?`)) return
    try {
      const res = await fetch(`/api/channel-groups/${group.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? '삭제 실패')
      toast.success('그룹이 삭제되었습니다')
      await loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    }
  }

  // ── 렌더 ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* ── 채널 그룹 섹션 ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>채널 그룹</CardTitle>
            <CardDescription>채널을 묶어 분류합니다</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={openNewGroup}>
            <Plus className="mr-1 h-4 w-4" />새 그룹
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">불러오는 중...</p>
          ) : groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">등록된 그룹이 없습니다</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {groups.map((group) => {
                const count = channels.filter((ch) => ch.groupId === group.id).length
                return (
                  <div
                    key={group.id}
                    className="flex items-center gap-2 rounded-md border bg-card px-3 py-1.5"
                  >
                    <span className="text-sm font-medium">{group.name}</span>
                    <Badge variant="secondary" className="text-xs">
                      {count}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => openEditGroup(group)}
                      aria-label="그룹 수정"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => handleDeleteGroup(group)}
                      aria-label="그룹 삭제"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── 채널 테이블 섹션 ────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>채널</CardTitle>
            <CardDescription>판매 채널을 등록하고 수수료를 관리합니다</CardDescription>
          </div>
          <Button size="sm" onClick={openNewChannel}>
            <Plus className="mr-1 h-4 w-4" />새 채널
          </Button>
        </CardHeader>
        <CardContent>
          {/* 필터 바 */}
          <div className="mb-4 flex flex-wrap gap-2">
            <Select value={filterGroupId} onValueChange={setFilterGroupId}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="그룹 전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>그룹 전체</SelectItem>
                <SelectItem value={NO_GROUP}>그룹 없음</SelectItem>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filterStatus}
              onValueChange={(v) => setFilterStatus(v as typeof filterStatus)}
            >
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 상태</SelectItem>
                <SelectItem value="active">활성</SelectItem>
                <SelectItem value="inactive">비활성</SelectItem>
              </SelectContent>
            </Select>
            <Input
              className="w-48"
              placeholder="채널명 검색"
              value={filterSearch}
              onChange={(e) => setFilterSearch(e.target.value)}
            />
          </div>

          {/* 테이블 */}
          {loading ? (
            <p className="text-sm text-muted-foreground">불러오는 중...</p>
          ) : filteredChannels.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {channels.length === 0 ? '등록된 채널이 없습니다' : '조건에 맞는 채널이 없습니다'}
            </p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-9" />
                    <TableHead>채널명</TableHead>
                    <TableHead>종류</TableHead>
                    <TableHead>그룹</TableHead>
                    <TableHead>배송비</TableHead>
                    <TableHead>상태</TableHead>
                    <TableHead className="text-right">액션</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredChannels.map((ch) => {
                    const isExpanded = expandedChannelId === ch.id
                    return (
                      <Fragment key={ch.id}>
                        <TableRow
                          className="cursor-pointer"
                          onClick={() =>
                            setExpandedChannelId((cur) => (cur === ch.id ? null : ch.id))
                          }
                        >
                          <TableCell>
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                          </TableCell>
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
                          <TableCell className="text-sm text-muted-foreground">
                            {ch.freeShipping
                              ? '무료'
                              : ch.shippingFee != null
                                ? new Intl.NumberFormat('ko-KR', {
                                    style: 'currency',
                                    currency: 'KRW',
                                    maximumFractionDigits: 0,
                                  }).format(ch.shippingFee)
                                : '-'}
                          </TableCell>
                          <TableCell>
                            {ch.isActive ? (
                              <Badge>활성</Badge>
                            ) : (
                              <Badge variant="outline">비활성</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div
                              className="flex items-center justify-end gap-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openEditChannel(ch)}
                                aria-label="수정"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => toggleChannelActive(ch)}
                              >
                                {ch.isActive ? '비활성화' : '활성화'}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>

                        {isExpanded && (
                          <TableRow className="hover:bg-transparent">
                            <TableCell colSpan={7} className="p-0">
                              <ChannelFeeRatesInline channelId={ch.id} />
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── 채널 편집 다이얼로그 ─────────────────────────────────────────────── */}
      <Dialog open={channelDialogOpen} onOpenChange={setChannelDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingChannel ? '채널 수정' : '새 채널 만들기'}</DialogTitle>
            <DialogDescription>판매 채널 정보를 입력해 주세요</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-4 overflow-y-auto py-2 pr-1">
            {/* 채널명 */}
            <div className="space-y-2">
              <Label htmlFor="ch-name">채널명 *</Label>
              <Input
                id="ch-name"
                value={fName}
                onChange={(e) => setFName(e.target.value)}
                placeholder="예: 쿠팡"
              />
            </div>

            {/* 종류 / 유형 */}
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
                <Label>채널 유형 (시뮬레이션)</Label>
                <Select
                  value={fChannelType}
                  onValueChange={(v) => {
                    const ct = v as ChannelType
                    setFChannelType(ct)
                    // 자사몰은 결제 수수료 포함 기본 false
                    if (ct === 'SELF_MALL') setFPaymentFeeIncluded(false)
                    else setFPaymentFeeIncluded(true)
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(CHANNEL_TYPE_LABELS).map(([k, label]) => (
                      <SelectItem key={k} value={k}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* 그룹 */}
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

            {/* 어드민 URL */}
            <div className="space-y-2">
              <Label htmlFor="ch-admin-url">어드민 URL (선택)</Label>
              <Input
                id="ch-admin-url"
                value={fAdminUrl}
                onChange={(e) => setFAdminUrl(e.target.value)}
                placeholder="https://wing.coupang.com/..."
              />
            </div>

            {/* 가격 시뮬레이션 기본값 */}
            <div className="space-y-3 rounded-md border p-3">
              <p className="text-xs font-medium text-muted-foreground">가격 시뮬레이션 기본값</p>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="ch-default-fee">기본 수수료율 (%)</Label>
                  <Input
                    id="ch-default-fee"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={fDefaultFeePct}
                    onChange={(e) => setFDefaultFeePct(e.target.value)}
                    placeholder="예: 10.8"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ch-payment-fee">결제 수수료율 (%)</Label>
                  <Input
                    id="ch-payment-fee"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={fPaymentFeePct}
                    onChange={(e) => setFPaymentFeePct(e.target.value)}
                    placeholder="예: 3.5"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ch-free-threshold">무료배송 기준금액 (원)</Label>
                <Input
                  id="ch-free-threshold"
                  type="number"
                  min="0"
                  step="1000"
                  value={fFreeShippingThreshold}
                  onChange={(e) => setFFreeShippingThreshold(e.target.value)}
                  placeholder="예: 50000"
                />
              </div>
            </div>

            {/* 배송비 */}
            <div className="space-y-2">
              <Label htmlFor="ch-shipping-fee">기본 배송비 (원)</Label>
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
                  <Label htmlFor="ch-apply-ad">광고비 자동 적용</Label>
                  <p className="text-xs text-muted-foreground">시뮬레이션 시 광고비 자동 포함</p>
                </div>
                <Switch id="ch-apply-ad" checked={fApplyAdCost} onCheckedChange={setFApplyAdCost} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="ch-vat">수수료에 VAT 포함</Label>
                  <p className="text-xs text-muted-foreground">부가세 포함 수수료율 기준</p>
                </div>
                <Switch id="ch-vat" checked={fVatIncluded} onCheckedChange={setFVatIncluded} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="ch-payment-included">결제 수수료 포함</Label>
                  <p className="text-xs text-muted-foreground">수수료율에 결제 수수료 포함 여부</p>
                </div>
                <Switch
                  id="ch-payment-included"
                  checked={fPaymentFeeIncluded}
                  onCheckedChange={setFPaymentFeeIncluded}
                />
              </div>
              {editingChannel && (
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
            <Button
              variant="outline"
              onClick={() => setChannelDialogOpen(false)}
              disabled={savingChannel}
            >
              취소
            </Button>
            <Button onClick={handleSaveChannel} disabled={savingChannel}>
              {savingChannel ? '저장 중...' : '저장'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 그룹 편집 다이얼로그 ──────────────────────────────────────────────── */}
      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingGroup ? '그룹 수정' : '새 채널 그룹'}</DialogTitle>
            <DialogDescription>채널 그룹 이름을 입력해 주세요</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="cg-name">그룹명 *</Label>
            <Input
              id="cg-name"
              value={gName}
              onChange={(e) => setGName(e.target.value)}
              placeholder="예: 온라인몰"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setGroupDialogOpen(false)}
              disabled={savingGroup}
            >
              취소
            </Button>
            <Button onClick={handleSaveGroup} disabled={savingGroup}>
              {savingGroup ? '저장 중...' : '저장'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
