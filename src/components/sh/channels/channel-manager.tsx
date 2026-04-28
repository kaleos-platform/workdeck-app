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

type ChannelTypeDef = {
  id: string
  name: string
  isSalesChannel: boolean
  isSystem: boolean
  sortOrder: number
  channelCount: number
}

type Channel = {
  id: string
  name: string
  channelTypeDefId: string | null
  channelTypeDef: { id: string; name: string; isSalesChannel: boolean } | null
  useSimulation: boolean
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

// 채널 편집 폼에서 유형 없음을 표현하는 센티널
const NO_TYPE = '__none__'
// 새 유형 인라인 생성 센티널
const NEW_TYPE = '__new__'
// 상태 필터 "전체"
const ALL = '__all__'

// ─── 컴포넌트 ─────────────────────────────────────────────────────────────────

export function ShChannelManager() {
  // ── 데이터 상태 ──
  const [channels, setChannels] = useState<Channel[]>([])
  const [channelTypes, setChannelTypes] = useState<ChannelTypeDef[]>([])
  const [loading, setLoading] = useState(true)

  // ── 채널 테이블 확장 ──
  const [expandedChannelId, setExpandedChannelId] = useState<string | null>(null)

  // ── 채널 필터 ──
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all')
  const [filterSearch, setFilterSearch] = useState('')

  // ── 채널 다이얼로그 상태 ──
  const [channelDialogOpen, setChannelDialogOpen] = useState(false)
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null)
  const [savingChannel, setSavingChannel] = useState(false)

  // 채널 폼 필드
  const [fName, setFName] = useState('')
  const [fTypeDefId, setFTypeDefId] = useState(NO_TYPE)
  const [fAdminUrl, setFAdminUrl] = useState('')
  const [fFreeShipping, setFFreeShipping] = useState(false)
  const [fFreeShippingThreshold, setFFreeShippingThreshold] = useState('')
  const [fDefaultFeePct, setFDefaultFeePct] = useState('')
  const [fUsesMarketing, setFUsesMarketing] = useState(false)
  const [fApplyAdCost, setFApplyAdCost] = useState(false)
  const [fShippingFee, setFShippingFee] = useState('')
  const [fVatIncluded, setFVatIncluded] = useState(false)
  const [fPaymentFeeIncluded, setFPaymentFeeIncluded] = useState(true)
  const [fPaymentFeePct, setFPaymentFeePct] = useState('')
  const [fIsActive, setFIsActive] = useState(true)
  const [fUseSimulation, setFUseSimulation] = useState(true)

  // 채널 폼 — 인라인 유형 생성
  const [creatingType, setCreatingType] = useState(false)
  const [newTypeName, setNewTypeName] = useState('')
  const [newTypeIsSales, setNewTypeIsSales] = useState(true)
  const [savingNewType, setSavingNewType] = useState(false)

  // ── 채널 유형 다이얼로그 상태 ──
  const [typeDialogOpen, setTypeDialogOpen] = useState(false)
  const [editingType, setEditingType] = useState<ChannelTypeDef | null>(null)
  const [tName, setTName] = useState('')
  const [tIsSales, setTIsSales] = useState(true)
  const [savingType, setSavingType] = useState(false)

  // ── 데이터 로드 ──

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [cRes, tRes] = await Promise.all([fetch('/api/channels'), fetch('/api/channel-types')])
      if (!cRes.ok) throw new Error('채널 조회 실패')
      const cData = await cRes.json()
      setChannels(cData.channels ?? [])
      if (tRes.ok) {
        const tData = await tRes.json()
        setChannelTypes(tData.types ?? [])
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
      if (filterStatus === 'active' && !ch.isActive) return false
      if (filterStatus === 'inactive' && ch.isActive) return false
      if (filterSearch) {
        const q = filterSearch.toLowerCase()
        return ch.name.toLowerCase().includes(q)
      }
      return true
    })
  }, [channels, filterStatus, filterSearch])

  // ── 채널 편집 다이얼로그 ──

  function openNewChannel() {
    setEditingChannel(null)
    setFName('')
    setFTypeDefId(NO_TYPE)
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
    setFUseSimulation(true)
    setCreatingType(false)
    setNewTypeName('')
    setChannelDialogOpen(true)
  }

  function openEditChannel(ch: Channel) {
    setEditingChannel(ch)
    setFName(ch.name)
    setFTypeDefId(ch.channelTypeDefId ?? NO_TYPE)
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
    setFUseSimulation(ch.useSimulation)
    setCreatingType(false)
    setNewTypeName('')
    setChannelDialogOpen(true)
  }

  // 인라인 채널 유형 생성 (채널 폼 내부)
  async function handleCreateTypeInline() {
    const name = newTypeName.trim()
    if (!name) return
    setSavingNewType(true)
    try {
      const res = await fetch('/api/channel-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, isSalesChannel: newTypeIsSales }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? '유형 생성 실패')
      const created: ChannelTypeDef = {
        id: data.type.id,
        name: data.type.name,
        isSalesChannel: data.type.isSalesChannel,
        isSystem: false,
        sortOrder: data.type.sortOrder ?? 99,
        channelCount: 0,
      }
      setChannelTypes((prev) => [...prev, created])
      setFTypeDefId(created.id)
      setCreatingType(false)
      setNewTypeName('')
      toast.success(`채널 유형 "${created.name}" 이(가) 생성되었습니다`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '유형 생성 실패')
    } finally {
      setSavingNewType(false)
    }
  }

  async function handleSaveChannel() {
    if (!fName.trim()) {
      toast.error('채널명을 입력해 주세요')
      return
    }
    if (!fTypeDefId || fTypeDefId === NO_TYPE) {
      toast.error('채널 유형을 선택해 주세요')
      return
    }
    setSavingChannel(true)
    try {
      const url = editingChannel ? `/api/channels/${editingChannel.id}` : '/api/channels'
      const method = editingChannel ? 'PATCH' : 'POST'

      const body: Record<string, unknown> = {
        name: fName.trim(),
        channelTypeDefId: fTypeDefId,
        useSimulation: fUseSimulation,
        freeShipping: fFreeShipping,
        usesMarketingBudget: fUsesMarketing,
        applyAdCost: fApplyAdCost,
        vatIncludedInFee: fVatIncluded,
        paymentFeeIncluded: fPaymentFeeIncluded,
        isActive: fIsActive,
      }
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

  // ── 채널 유형 다이얼로그 ──

  function openNewType() {
    setEditingType(null)
    setTName('')
    setTIsSales(true)
    setTypeDialogOpen(true)
  }

  function openEditType(t: ChannelTypeDef) {
    setEditingType(t)
    setTName(t.name)
    setTIsSales(t.isSalesChannel)
    setTypeDialogOpen(true)
  }

  async function handleSaveType() {
    if (!tName.trim()) {
      toast.error('유형 이름을 입력해 주세요')
      return
    }
    setSavingType(true)
    try {
      const url = editingType ? `/api/channel-types/${editingType.id}` : '/api/channel-types'
      const method = editingType ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: tName.trim(), isSalesChannel: tIsSales }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? '저장 실패')
      toast.success(editingType ? '유형이 수정되었습니다' : '유형이 생성되었습니다')
      setTypeDialogOpen(false)
      await loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSavingType(false)
    }
  }

  async function handleDeleteType(t: ChannelTypeDef) {
    if (t.isSystem) return
    if (!confirm(`"${t.name}" 유형을 삭제하시겠습니까?`)) return
    try {
      const res = await fetch(`/api/channel-types/${t.id}`, { method: 'DELETE' })
      if (res.status === 409) {
        const data = await res.json().catch(() => ({}))
        toast.error(data?.message ?? '사용 중인 유형은 삭제할 수 없습니다')
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.message ?? '삭제 실패')
      }
      toast.success('유형이 삭제되었습니다')
      await loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    }
  }

  // ── 렌더 ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* ── 채널 유형 섹션 ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>채널 유형</CardTitle>
            <CardDescription>채널을 분류하는 유형을 관리합니다</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={openNewType}>
            <Plus className="mr-1 h-4 w-4" />새 유형
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">불러오는 중...</p>
          ) : channelTypes.length === 0 ? (
            <p className="text-sm text-muted-foreground">등록된 채널 유형이 없습니다</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {channelTypes.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center gap-2 rounded-md border bg-card px-3 py-1.5"
                >
                  <span className="text-sm font-medium">{t.name}</span>
                  <Badge variant={t.isSalesChannel ? 'default' : 'secondary'} className="text-xs">
                    {t.isSalesChannel ? '판매채널' : '내부 이관'}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    채널 {t.channelCount}개
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => openEditType(t)}
                    aria-label="유형 수정"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => handleDeleteType(t)}
                    aria-label="유형 삭제"
                    disabled={t.isSystem}
                    title={t.isSystem ? '시스템 유형은 삭제할 수 없습니다' : undefined}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
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
                    <TableHead>유형</TableHead>
                    <TableHead>배송비</TableHead>
                    <TableHead>시뮬레이션</TableHead>
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
                          <TableCell>
                            {ch.channelTypeDef ? (
                              <Badge variant="secondary">{ch.channelTypeDef.name}</Badge>
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
                            {ch.useSimulation ? (
                              <Badge variant="outline" className="text-xs">
                                사용
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">미사용</span>
                            )}
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
            {/* 1) 채널 유형 */}
            <div className="space-y-2">
              <Label>채널 유형 *</Label>
              {!creatingType ? (
                <Select
                  value={fTypeDefId}
                  onValueChange={(v) => {
                    if (v === NEW_TYPE) {
                      setCreatingType(true)
                      setNewTypeName('')
                    } else {
                      setFTypeDefId(v)
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="유형 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_TYPE}>유형 없음</SelectItem>
                    {channelTypes.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                    <SelectItem value={NEW_TYPE}>+ 새 유형 만들기</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <div className="space-y-2 rounded-md border p-3">
                  <div className="space-y-1.5">
                    <Input
                      value={newTypeName}
                      onChange={(e) => setNewTypeName(e.target.value)}
                      placeholder="새 유형 이름"
                      autoFocus
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Switch
                        id="new-type-is-sales"
                        checked={newTypeIsSales}
                        onCheckedChange={setNewTypeIsSales}
                      />
                      <Label htmlFor="new-type-is-sales" className="cursor-pointer text-sm">
                        {newTypeIsSales ? '판매채널' : '내부 이관'}
                      </Label>
                    </div>
                    <div className="flex gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleCreateTypeInline}
                        disabled={savingNewType || !newTypeName.trim()}
                      >
                        {savingNewType ? '생성 중...' : '생성'}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setCreatingType(false)
                          setNewTypeName('')
                        }}
                      >
                        취소
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 2) 채널명 */}
            <div className="space-y-2">
              <Label htmlFor="ch-name">채널명 *</Label>
              <Input
                id="ch-name"
                value={fName}
                onChange={(e) => setFName(e.target.value)}
                placeholder="예: 쿠팡"
              />
            </div>

            {/* 3) 어드민 URL */}
            <div className="space-y-2">
              <Label htmlFor="ch-admin-url">어드민 URL (선택)</Label>
              <Input
                id="ch-admin-url"
                value={fAdminUrl}
                onChange={(e) => setFAdminUrl(e.target.value)}
                placeholder="https://wing.coupang.com/..."
              />
            </div>

            {/* 4) 마케팅 */}
            <div className="space-y-3 rounded-md border p-3">
              <p className="text-xs font-medium text-muted-foreground">마케팅</p>
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
            </div>

            {/* 5) 가격 시뮬레이션 사용 */}
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="ch-use-sim" className="cursor-pointer">
                  가격 시뮬레이션 사용
                </Label>
                <p className="text-xs text-muted-foreground">
                  OFF 시 수수료·배송 설정이 시뮬레이션에서 제외됩니다
                </p>
              </div>
              <Switch
                id="ch-use-sim"
                checked={fUseSimulation}
                onCheckedChange={setFUseSimulation}
              />
            </div>

            {/* 6) 수수료 (시뮬레이션 기본값) */}
            <div
              className={
                fUseSimulation
                  ? 'space-y-4 rounded-md border p-3'
                  : 'space-y-4 rounded-md border p-3 opacity-50'
              }
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">
                  수수료 (시뮬레이션 기본값)
                </p>
              </div>

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
                  disabled={!fUseSimulation}
                />
              </div>

              {/* VAT 포함 토글 */}
              <div className="flex items-center justify-between rounded-md bg-muted/40 px-2.5 py-2">
                <div>
                  <Label htmlFor="ch-vat" className="cursor-pointer">
                    수수료에 VAT 포함
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    위 수수료율이 부가세 포함 기준이면 ON
                  </p>
                </div>
                <Switch
                  id="ch-vat"
                  checked={fVatIncluded}
                  onCheckedChange={setFVatIncluded}
                  disabled={!fUseSimulation}
                />
              </div>

              {/* 결제 수수료 포함 토글 */}
              <div className="flex items-center justify-between rounded-md bg-muted/40 px-2.5 py-2">
                <div>
                  <Label htmlFor="ch-payment-included" className="cursor-pointer">
                    결제 수수료 포함
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    위 수수료율에 결제 수수료가 합산되어 있으면 ON
                  </p>
                </div>
                <Switch
                  id="ch-payment-included"
                  checked={fPaymentFeeIncluded}
                  onCheckedChange={setFPaymentFeeIncluded}
                  disabled={!fUseSimulation}
                />
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor="ch-payment-fee"
                  className={
                    fPaymentFeeIncluded || !fUseSimulation ? 'text-muted-foreground' : undefined
                  }
                >
                  결제 수수료율 (%)
                </Label>
                <Input
                  id="ch-payment-fee"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={fPaymentFeeIncluded ? '' : fPaymentFeePct}
                  onChange={(e) => setFPaymentFeePct(e.target.value)}
                  placeholder={fPaymentFeeIncluded ? '결제 수수료 포함 시 사용 안 함' : '예: 3.5'}
                  disabled={fPaymentFeeIncluded || !fUseSimulation}
                />
              </div>
            </div>

            {/* ── 배송 ── */}
            <div
              className={
                fUseSimulation
                  ? 'space-y-4 rounded-md border p-3'
                  : 'space-y-4 rounded-md border p-3 opacity-50'
              }
            >
              <p className="text-xs font-medium text-muted-foreground">배송</p>

              <div className="space-y-2">
                <Label htmlFor="ch-shipping-fee">기본 배송비 (원)</Label>
                <Input
                  id="ch-shipping-fee"
                  type="number"
                  min="0"
                  value={fShippingFee}
                  onChange={(e) => setFShippingFee(e.target.value)}
                  placeholder="0"
                  disabled={!fUseSimulation}
                />
              </div>

              {/* 무료 배송 토글 */}
              <div className="flex items-center justify-between rounded-md bg-muted/40 px-2.5 py-2">
                <div>
                  <Label htmlFor="ch-free-shipping" className="cursor-pointer">
                    무료 배송
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    이 채널은 항상 무료배송 (기준금액 미적용)
                  </p>
                </div>
                <Switch
                  id="ch-free-shipping"
                  checked={fFreeShipping}
                  onCheckedChange={setFFreeShipping}
                  disabled={!fUseSimulation}
                />
              </div>

              <div className="space-y-2">
                <Label
                  htmlFor="ch-free-threshold"
                  className={fFreeShipping || !fUseSimulation ? 'text-muted-foreground' : undefined}
                >
                  무료 배송 기준금액 (원)
                </Label>
                <Input
                  id="ch-free-threshold"
                  type="number"
                  min="0"
                  step="1000"
                  value={fFreeShipping ? '' : fFreeShippingThreshold}
                  onChange={(e) => setFFreeShippingThreshold(e.target.value)}
                  placeholder={fFreeShipping ? '항상 무료배송 (사용 안 함)' : '예: 50000'}
                  disabled={fFreeShipping || !fUseSimulation}
                />
              </div>
            </div>

            {editingChannel && (
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <Label htmlFor="ch-active">활성 상태</Label>
                  <p className="text-xs text-muted-foreground">비활성 시 신규 주문에 사용 불가</p>
                </div>
                <Switch id="ch-active" checked={fIsActive} onCheckedChange={setFIsActive} />
              </div>
            )}
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

      {/* ── 채널 유형 편집 다이얼로그 ─────────────────────────────────────────── */}
      <Dialog open={typeDialogOpen} onOpenChange={setTypeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingType ? '채널 유형 수정' : '새 채널 유형'}</DialogTitle>
            <DialogDescription>채널 유형 정보를 입력해 주세요</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="ct-name">유형명 *</Label>
              <Input
                id="ct-name"
                value={tName}
                onChange={(e) => setTName(e.target.value)}
                placeholder="예: 오픈마켓"
                disabled={editingType?.isSystem}
              />
              {editingType?.isSystem && (
                <p className="text-xs text-muted-foreground">
                  시스템 유형은 이름을 변경할 수 없습니다
                </p>
              )}
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <Label htmlFor="ct-is-sales" className="cursor-pointer">
                  판매채널 유형
                </Label>
                <p className="text-xs text-muted-foreground">
                  OFF 시 이 유형 채널의 출고가 내부 이관으로 처리됩니다
                </p>
              </div>
              <Switch id="ct-is-sales" checked={tIsSales} onCheckedChange={setTIsSales} />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTypeDialogOpen(false)}
              disabled={savingType}
            >
              취소
            </Button>
            <Button onClick={handleSaveType} disabled={savingType}>
              {savingType ? '저장 중...' : '저장'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
