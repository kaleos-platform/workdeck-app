'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Waypoints } from 'lucide-react'
import { SETTINGS_INTEGRATIONS_PATH } from '@/lib/deck-routes'
import { cn } from '@/lib/utils'

type DeckKey = 'coupang-ads' | 'seller-hub'

type CoupangDataSource = 'CRAWL' | 'API'

type SourceSetting = {
  inventorySource: CoupangDataSource
  salesSource: CoupangDataSource
  settlementSource: CoupangDataSource
  productSource: CoupangDataSource
}

type SourceField = keyof SourceSetting

const SCOPE_ROWS: {
  field: SourceField
  label: string
  description: string
  /** 지정 시 해당 행은 크롤링 고정으로 잠긴다(배지 문구). */
  lockedBadge?: string
}[] = [
  {
    field: 'inventorySource',
    label: '재고',
    // 재고 API(로켓창고 요약)는 주문가능수량과 30일 판매량만 준다. 재고건전성 엑셀이 주는
    // 반품 등급·입고예정·보관일수·소진예상·보관료·아이템위너 등 12개 컬럼이 전부 빠져
    // 재고현황 화면·재고 분석·발주 판단이 동시에 눈이 먼다(prod 실측: 반품 등급 옵션 106개,
    // 재고 117개가 정상품과 구분 불가). 총량만 맞고 성격이 사라지므로 크롤링으로 고정한다.
    description:
      '로켓창고 재고 현황 데이터. API는 반품 등급·입고예정·보관일수를 제공하지 않아 재고 파악이 부정확해집니다.',
    lockedBadge: '크롤링 (API 정보 부족)',
  },
  {
    field: 'salesSource',
    label: '판매·주문',
    // 로켓그로스 주문 API 는 주문/수량/단가만 준다. 판매분석(VENDOR) 크롤링이 주는
    // totalCancelled(취소)·orderCount 가 없어 취소를 반영할 수 없다(prod 실측: VENDOR 는
    // 726/726 행 전건 채워짐). 게다가 현재 판매 lineage 는 OUTBOUND 장부인데 주문 API 는
    // 주문수요 축이라 발주 실적 모니터링(OUTBOUND 기준)과 어긋난다.
    description:
      '판매·출고 데이터. API는 취소 정보를 제공하지 않고 집계 축(주문수요)이 달라 출고 장부와 어긋납니다.',
    lockedBadge: '크롤링 (API 정보 부족)',
  },
  {
    field: 'settlementSource',
    label: '정산',
    description: '매출·지급 내역 데이터',
  },
  {
    field: 'productSource',
    label: '상품',
    description: '상품 마스터 데이터',
  },
]

export function CoupangSourceCard({ deckKey }: { deckKey: DeckKey }) {
  const [data, setData] = useState<SourceSetting | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [credentialActive, setCredentialActive] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch('/api/collection/source-setting').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/collection/api-credentials').then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([sourceData, credData]) => {
        // 두 라우트 모두 래퍼로 응답한다: { setting } / { credential, isConnected }.
        // 본문을 그대로 쓰면 소스 값이 전부 undefined 가 되고(토글이 아무것도 선택 안 된 상태),
        // 자격 활성 여부도 항상 false 라 API 쪽이 영구 disabled 로 남는다.
        setData(sourceData?.setting ?? sourceData ?? null)
        setCredentialActive(Boolean(credData?.credential?.isActive ?? credData?.isConnected))
      })
      .catch(() => {
        setData(null)
        setCredentialActive(false)
      })
      .finally(() => setLoading(false))
  }, [])

  const handleChange = useCallback(
    async (field: SourceField, value: CoupangDataSource) => {
      if (!data || data[field] === value) return
      const prevValue = data[field]
      setData((prev) => (prev ? { ...prev, [field]: value } : prev))
      setSaving(true)
      try {
        const res = await fetch('/api/collection/source-setting', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [field]: value }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          toast.error((body as { message?: string }).message ?? '소스 설정 변경에 실패했습니다')
          setData((prev) => (prev ? { ...prev, [field]: prevValue } : prev))
          return
        }
        toast.success('소스 설정이 변경되었습니다')
      } catch {
        toast.error('소스 설정 변경 중 오류가 발생했습니다')
        setData((prev) => (prev ? { ...prev, [field]: prevValue } : prev))
      } finally {
        setSaving(false)
      }
    },
    [data]
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Waypoints className="h-5 w-5" />
          데이터 수집 소스
        </CardTitle>
        <CardDescription>
          데이터 종류별로 크롤링과 쿠팡 Open API 중 수집 방식을 선택합니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!credentialActive && (
          <p className="text-xs text-muted-foreground">
            쿠팡 Open API 자격증명이 등록되지 않았습니다.{' '}
            <Link href={SETTINGS_INTEGRATIONS_PATH} className="underline underline-offset-2">
              연동 설정
            </Link>
            에서 API 자격증명을 등록하면 API 수집을 사용할 수 있습니다.
          </p>
        )}

        {/* 광고 행 — 쿠팡 Open API에 광고 계열이 없어 항상 크롤링 고정 */}
        <SourceRow
          id={`${deckKey}-source-ads`}
          label="광고"
          description="쿠팡 Open API에 광고 데이터 조회 기능이 없어 크롤링으로 고정됩니다."
          value="CRAWL"
          disabled
          fixedBadgeLabel="크롤링 (API 미제공)"
          onChange={() => {}}
        />

        {SCOPE_ROWS.map((row) => (
          <SourceRow
            key={row.field}
            id={`${deckKey}-source-${row.field}`}
            label={row.label}
            description={row.description}
            value={row.lockedBadge ? 'CRAWL' : (data?.[row.field] ?? 'CRAWL')}
            disabled={Boolean(row.lockedBadge) || loading || saving}
            apiDisabled={!credentialActive}
            fixedBadgeLabel={row.lockedBadge}
            onChange={(v) => {
              if (row.lockedBadge) return
              handleChange(row.field, v)
            }}
          />
        ))}
      </CardContent>
    </Card>
  )
}

function SourceRow({
  id,
  label,
  description,
  value,
  disabled,
  apiDisabled,
  fixedBadgeLabel,
  onChange,
}: {
  id: string
  label: string
  description: string
  value: CoupangDataSource
  disabled?: boolean
  apiDisabled?: boolean
  fixedBadgeLabel?: string
  onChange: (value: CoupangDataSource) => void
}) {
  return (
    <div id={id} className="flex items-center justify-between gap-4 rounded-md border p-3">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {fixedBadgeLabel ? (
        <Badge variant="secondary" className="whitespace-nowrap">
          {fixedBadgeLabel}
        </Badge>
      ) : (
        <div className="flex overflow-hidden rounded-md border">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange('CRAWL')}
            className={cn(
              'px-3 py-1.5 text-xs font-medium transition-colors',
              value === 'CRAWL'
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-muted-foreground hover:bg-muted',
              disabled && 'cursor-not-allowed opacity-60'
            )}
          >
            크롤링
          </button>
          <button
            type="button"
            disabled={disabled || apiDisabled}
            title={apiDisabled ? 'API 자격증명을 먼저 등록하세요' : undefined}
            onClick={() => onChange('API')}
            className={cn(
              'border-l px-3 py-1.5 text-xs font-medium transition-colors',
              value === 'API'
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-muted-foreground hover:bg-muted',
              (disabled || apiDisabled) && 'cursor-not-allowed opacity-60'
            )}
          >
            API
          </button>
        </div>
      )}
    </div>
  )
}
