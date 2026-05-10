'use client'

import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { OptionStockChip } from './option-stock-chip'

type StockByLocation = {
  locationId: string
  locationName: string
  quantity: number
}

type Option = {
  optionId: string
  optionName: string
  sku: string | null
  stockByLocation: StockByLocation[]
  totalStock: number
  outbound7d: number
}

type Product = {
  productId: string
  productName: string
  productCode: string | null
  options: Option[]
}

type Props = {
  product: Product
  activeLocationId: string // '__all__' 또는 특정 locationId
}

export function ProductStockCard({ product, activeLocationId }: Props) {
  return (
    <Card className="shadow-none">
      <CardHeader className="px-4 pt-4 pb-2">
        <div>
          <p className="leading-snug font-semibold">{product.productName}</p>
          {product.productCode && (
            <p className="mt-0.5 text-xs text-muted-foreground">{product.productCode}</p>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {product.options.length === 0 ? (
          <p className="text-sm text-muted-foreground">옵션 없음</p>
        ) : (
          <div className="flex flex-col gap-2">
            {product.options.map((opt) => {
              const quantity =
                activeLocationId === '__all__'
                  ? opt.totalStock
                  : (opt.stockByLocation.find((s) => s.locationId === activeLocationId)?.quantity ??
                    0)
              return (
                <OptionStockChip
                  key={opt.optionId}
                  optionName={opt.optionName}
                  quantity={quantity}
                  outbound7d={opt.outbound7d}
                  // TODO: location별 outbound 분리 — 현재는 전체 7일 출고를 모든 위치 탭에서 동일하게 사용
                />
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
