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

const SCOPE_ROWS: { field: SourceField; label: string; description: string }[] = [
  {
    field: 'inventorySource',
    label: '재고',
    description: '로켓창고 재고 현황 데이터',
  },
  {
    field: 'salesSource',
    label: '판매·주문',
    description: '판매·출고 데이터',
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
        setData(sourceData)
        setCredentialActive(Boolean(credData?.isActive))
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
            value={data?.[row.field] ?? 'CRAWL'}
            disabled={loading || saving}
            apiDisabled={!credentialActive}
            onChange={(v) => handleChange(row.field, v)}
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
