'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
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
import { ChannelEditDialog } from './channel-edit-dialog'
import { ChannelTypeManageDialog } from './channel-type-manage-dialog'
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
  feeRates: { categoryName: string; ratePercent: number }[]
  usesMarketingBudget: boolean
  applyAdCost: boolean
  shippingFee: number | null
  vatIncludedInFee: boolean
  paymentFeeIncluded: boolean
  paymentFeePct: number | null
  isActive: boolean
  requireOrderNumber: boolean
  requirePayment: boolean
  requireProducts: boolean
}

// 사이드바 "전체" 탭 ID
const ALL_TYPES = '__all__'

// ─── 컴포넌트 ─────────────────────────────────────────────────────────────────

export function ShChannelManager() {
  // ── 데이터 상태 ──
  const [channels, setChannels] = useState<Channel[]>([])
  const [channelTypes, setChannelTypes] = useState<ChannelTypeDef[]>([])
  const [loading, setLoading] = useState(true)

  // ── 사이드바 선택 유형 ──
  const [selectedTypeId, setSelectedTypeId] = useState<string>(ALL_TYPES)

  // ── 채널 테이블 확장 ──
  const [expandedChannelId, setExpandedChannelId] = useState<string | null>(null)

  // ── 채널 필터 ──
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all')
  const [filterSearch, setFilterSearch] = useState('')

  // ── 다이얼로그 상태 ──
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null)
  const [typeManageOpen, setTypeManageOpen] = useState(false)

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

  // ── 필터링 ──

  const filteredChannels = useMemo(() => {
    return channels.filter((ch) => {
      // 사이드바 유형 필터
      if (selectedTypeId !== ALL_TYPES && ch.channelTypeDefId !== selectedTypeId) return false
      // 상태 필터
      if (filterStatus === 'active' && !ch.isActive) return false
      if (filterStatus === 'inactive' && ch.isActive) return false
      // 검색 필터
      if (filterSearch) {
        const q = filterSearch.toLowerCase()
        return ch.name.toLowerCase().includes(q)
      }
      return true
    })
  }, [channels, selectedTypeId, filterStatus, filterSearch])

  // 사이드바용 유형별 채널 수 (현재 채널 배열 기준 — null channelTypeDefId도 포함)
  const countByType = useMemo(() => {
    const map: Record<string, number> = {}
    for (const ch of channels) {
      if (ch.channelTypeDefId) {
        map[ch.channelTypeDefId] = (map[ch.channelTypeDefId] ?? 0) + 1
      }
    }
    return map
  }, [channels])

  // ── 상태 Switch 즉시 PATCH ──

  async function toggleChannelActive(ch: Channel) {
    // 낙관적 업데이트
    setChannels((prev) => prev.map((c) => (c.id === ch.id ? { ...c, isActive: !c.isActive } : c)))
    try {
      const res = await fetch(`/api/channels/${ch.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !ch.isActive }),
      })
      const data = await res.json()
      if (!res.ok) {
        // 롤백
        setChannels((prev) =>
          prev.map((c) => (c.id === ch.id ? { ...c, isActive: ch.isActive } : c))
        )
        throw new Error(data?.message ?? '상태 변경 실패')
      }
      toast.success(!ch.isActive ? '활성화되었습니다' : '비활성화되었습니다')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '상태 변경 실패')
    }
  }

  // ── 다이얼로그 열기 ──

  function openNewChannel() {
    setEditingChannel(null)
    setEditDialogOpen(true)
  }

  function openEditChannel(ch: Channel) {
    setEditingChannel(ch)
    setEditDialogOpen(true)
  }

  // ── 렌더 ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full gap-0">
      {/* ── 좌측 사이드바 — 채널 유형 ── */}
      <aside className="w-[280px] shrink-0 border-r">
        <div className="sticky top-0 max-h-screen overflow-y-auto p-4">
          <p className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            채널 유형
          </p>
          <nav className="space-y-1">
            {/* 전체 */}
            <button
              type="button"
              onClick={() => setSelectedTypeId(ALL_TYPES)}
              className={[
                'flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors',
                selectedTypeId === ALL_TYPES
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-foreground hover:bg-accent/50',
              ].join(' ')}
            >
              <span className="flex items-center gap-2">
                <span
                  className={[
                    'h-2 w-2 rounded-full',
                    selectedTypeId === ALL_TYPES ? 'bg-primary' : 'bg-muted-foreground/40',
                  ].join(' ')}
                />
                전체
              </span>
              <Badge variant="secondary" className="text-xs">
                {channels.length}
              </Badge>
            </button>

            {/* 유형별 */}
            {channelTypes.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedTypeId(t.id)}
                className={[
                  'flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors',
                  selectedTypeId === t.id
                    ? 'bg-accent font-medium text-accent-foreground'
                    : 'text-foreground hover:bg-accent/50',
                ].join(' ')}
              >
                <span className="truncate">{t.name}</span>
                <Badge variant="secondary" className="ml-2 shrink-0 text-xs">
                  {countByType[t.id] ?? 0}
                </Badge>
              </button>
            ))}
          </nav>
        </div>
      </aside>

      {/* ── 우측 메인 영역 ── */}
      <div className="min-w-0 flex-1 p-6">
        {/* 헤더 */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">채널 관리</h2>
          <div className="flex flex-wrap items-center gap-2">
            {/* 필터 */}
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
              className="w-44"
              placeholder="채널명 검색"
              value={filterSearch}
              onChange={(e) => setFilterSearch(e.target.value)}
            />
            {/* 액션 버튼 */}
            <Button size="sm" onClick={openNewChannel}>
              + 새 채널
            </Button>
            <Button size="sm" variant="outline" onClick={() => setTypeManageOpen(true)}>
              <Settings2 className="mr-1 h-4 w-4" />
              유형 관리
            </Button>
          </div>
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
                  <TableHead>시뮬</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead className="text-right">수정</TableHead>
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
                        {/* 확장 토글 */}
                        <TableCell>
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
                        </TableCell>

                        {/* 채널명 */}
                        <TableCell className="font-medium">{ch.name}</TableCell>

                        {/* 유형 */}
                        <TableCell>
                          {ch.channelTypeDef ? (
                            <Badge variant="secondary">{ch.channelTypeDef.name}</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>

                        {/* 시뮬레이션 */}
                        <TableCell>
                          {ch.useSimulation ? (
                            <Badge variant="outline" className="text-xs">
                              ON
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">OFF</span>
                          )}
                        </TableCell>

                        {/* 상태 Switch */}
                        <TableCell>
                          <div onClick={(e) => e.stopPropagation()}>
                            <Switch
                              checked={ch.isActive}
                              onCheckedChange={() => toggleChannelActive(ch)}
                              aria-label={ch.isActive ? '비활성화' : '활성화'}
                            />
                          </div>
                        </TableCell>

                        {/* 수정 버튼 — 텍스트 버튼, 가장 오른쪽 */}
                        <TableCell className="text-right">
                          <div onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="sm" onClick={() => openEditChannel(ch)}>
                              수정
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>

                      {/* 확장 행 — 카테고리별 수수료 read-only */}
                      {isExpanded && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={6} className="bg-muted/30 px-6 py-3">
                            <p className="mb-2 text-xs font-medium text-muted-foreground">
                              카테고리별 수수료
                            </p>
                            <ChannelFeeRatesInline feeRates={ch.feeRates} />
                            <p className="mt-2 text-xs text-muted-foreground">
                              수수료 편집은 우측 [수정] 버튼 → [수수료] 탭에서 처리합니다
                            </p>
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
      </div>

      {/* ── 채널 편집 다이얼로그 ── */}
      <ChannelEditDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        channel={editingChannel}
        channelTypes={channelTypes}
        onSaved={loadData}
        onTypesChanged={loadData}
      />

      {/* ── 채널 유형 관리 다이얼로그 ── */}
      <ChannelTypeManageDialog
        open={typeManageOpen}
        onOpenChange={setTypeManageOpen}
        channelTypes={channelTypes}
        onChanged={loadData}
      />
    </div>
  )
}
