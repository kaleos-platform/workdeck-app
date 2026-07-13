'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ExpiryCountdown } from './expiry-countdown'
import { ApprovalDetailSheet } from './approval-detail-sheet'
import {
  DECK_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
  type AgentPendingActionDTO,
  type AgentActionStatusValue,
} from './types'

type TabKey = 'pending' | 'processed'

const PROCESSED_STATUSES: AgentActionStatusValue[] = [
  'APPROVED',
  'REJECTED',
  'EXECUTED',
  'FAILED',
  'EXPIRED',
]

const DECK_FILTER_OPTIONS = [
  { value: 'all', label: '전체 Deck' },
  { value: 'finance', label: '재무 관리' },
  { value: 'seller-hub', label: '브랜드 운영' },
  { value: 'coupang-ads', label: '쿠팡 광고 관리자' },
]

const SOURCE_FILTER_OPTIONS = [
  { value: 'all', label: '전체 채널' },
  { value: 'MCP', label: 'MCP' },
  { value: 'WORKDECK_AGENT', label: '워크덱 에이전트' },
  { value: 'WEB', label: '웹' },
  { value: 'SYSTEM', label: '시스템' },
]

function statusBadgeVariant(status: AgentActionStatusValue) {
  if (status === 'PENDING') return 'secondary' as const
  if (status === 'EXECUTED' || status === 'APPROVED') return 'default' as const
  if (status === 'FAILED') return 'destructive' as const
  return 'outline' as const
}

export function ApprovalList() {
  const [tab, setTab] = useState<TabKey>('pending')
  const [deckFilter, setDeckFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [actions, setActions] = useState<AgentPendingActionDTO[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [canDecide, setCanDecide] = useState(false)

  // 사전 역할 조회 — /api/spaces가 반환하는 role은 액션 목록과 동일한
  // resolveSpaceContext() 스코프이므로 ADMIN/OWNER 여부를 신뢰할 수 있다.
  // 단, ActionDefinition.requiredRole이 개별 액션마다 ADMIN보다 엄격(OWNER)할
  // 수 있어 이 값은 "기본 requiredRole=ADMIN" 가정이며, PATCH 403 응답이
  // 최종 안전망 역할을 한다.
  useEffect(() => {
    fetch('/api/spaces')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { role?: string } | null) => {
        if (data?.role === 'ADMIN' || data?.role === 'OWNER') setCanDecide(true)
      })
      .catch(() => {})
  }, [])

  const fetchActions = useCallback(async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams()
      if (deckFilter !== 'all') params.set('deck', deckFilter)
      // 처리됨 탭은 여러 상태를 포함하므로 status 필터는 서버에 단일값만 보내고
      // (PENDING만 서버 필터, 나머지는 클라이언트에서 걸러낸다)
      if (tab === 'pending') params.set('status', 'PENDING')

      const res = await fetch(`/api/agent/actions?${params.toString()}`)
      if (!res.ok) {
        setActions([])
        return
      }
      const data: { actions: AgentPendingActionDTO[] } = await res.json()
      setActions(data.actions ?? [])
    } catch {
      setActions([])
    } finally {
      setIsLoading(false)
    }
  }, [deckFilter, tab])

  useEffect(() => {
    fetchActions()
  }, [fetchActions])

  const filtered = useMemo(() => {
    let rows = actions
    if (tab === 'processed') {
      rows = rows.filter((a) => PROCESSED_STATUSES.includes(a.status))
    }
    if (sourceFilter !== 'all') {
      rows = rows.filter((a) => a.source === sourceFilter)
    }
    return rows
  }, [actions, tab, sourceFilter])

  const selectedAction = useMemo(
    () => actions.find((a) => a.id === selectedId) ?? null,
    [actions, selectedId]
  )

  function openDetail(id: string) {
    setSelectedId(id)
    setSheetOpen(true)
  }

  function handleDecided() {
    fetchActions()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsList>
            <TabsTrigger value="pending">대기중</TabsTrigger>
            <TabsTrigger value="processed">처리됨</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex flex-wrap gap-2">
          <Select value={deckFilter} onValueChange={setDeckFilter}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DECK_FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
          불러오는 중...
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
          {tab === 'pending' ? '승인 대기 중인 액션이 없습니다' : '처리된 액션이 없습니다'}
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((action) => (
            <Card
              key={action.id}
              className="cursor-pointer transition hover:border-primary/50 hover:shadow-sm"
              onClick={() => openDetail(action.id)}
            >
              <CardContent className="flex flex-col gap-2 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{DECK_LABELS[action.deckKey] ?? action.deckKey}</Badge>
                  <Badge variant="secondary">{action.actionType}</Badge>
                  <Badge variant={statusBadgeVariant(action.status)}>
                    {STATUS_LABELS[action.status]}
                  </Badge>
                  {action.status === 'PENDING' && (
                    <ExpiryCountdown expiresAt={action.expiresAt} className="ml-auto" />
                  )}
                </div>
                <p className="text-sm font-medium text-foreground">{action.summary}</p>
                <p className="text-xs text-muted-foreground">
                  요청자 {action.requestedBy} · {SOURCE_LABELS[action.source]}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ApprovalDetailSheet
        action={selectedAction}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        canDecide={canDecide}
        onDecided={handleDecided}
      />
    </div>
  )
}
