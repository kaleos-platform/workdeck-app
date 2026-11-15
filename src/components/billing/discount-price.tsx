import { cn } from '@/lib/utils'
import { discountRate, formatWon } from './billing-shared'

/**
 * 공급가 → VAT 포함 금액으로 표시. 할인 고객이면 쇼핑몰처럼
 * 「정가 취소선 · 할인율 · 결제 금액(강조)」 순서로 보여준다.
 */
export function DiscountPrice({
  listSupply,
  supply,
  className,
}: {
  listSupply: number
  supply: number
  className?: string
}) {
  const list = Math.round(listSupply * 1.1)
  const pay = Math.round(supply * 1.1)
  const rate = discountRate(list, pay)
  return (
    <span className={cn('tabular-nums', className)}>
      {rate !== null && (
        <>
          <span className="mr-1.5 font-normal text-muted-foreground line-through">
            {formatWon(list)}
          </span>
          <span className="mr-1 font-bold text-primary">{rate}%</span>
        </>
      )}
      <span className={cn(rate !== null && 'font-bold text-foreground')}>{formatWon(pay)}</span>
    </span>
  )
}
