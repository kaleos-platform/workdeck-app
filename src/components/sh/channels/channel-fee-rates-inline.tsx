'use client'

import { Badge } from '@/components/ui/badge'

type FeeRate = {
  categoryName: string
  ratePercent: number
}

type Props = {
  feeRates: FeeRate[]
}

/**
 * 채널 행 확장 시 카테고리별 수수료율을 Badge로 표시하는 read-only 컴포넌트.
 * 편집은 채널 수정 다이얼로그([수정] 버튼)에서 처리한다.
 */
export function ChannelFeeRatesInline({ feeRates }: Props) {
  if (feeRates.length === 0) {
    return <span className="text-xs text-muted-foreground">수수료 정보 없음</span>
  }

  return (
    <div className="flex flex-wrap gap-2">
      {feeRates.map((fr) => (
        <Badge key={fr.categoryName} variant="secondary">
          {fr.categoryName} {Number(fr.ratePercent).toFixed(2)}%
        </Badge>
      ))}
    </div>
  )
}
