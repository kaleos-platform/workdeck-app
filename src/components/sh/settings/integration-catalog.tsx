'use client'

import Link from 'next/link'
import { ArrowRight, Boxes, Truck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SELLER_HUB_RECONCILIATION_PATH, SELLER_HUB_SHIPPING_ORDERS_PATH } from '@/lib/deck-routes'

type CatalogItem = {
  icon: typeof Truck
  source: string
  target: string
  description: string
  status: '활성'
  href: string
}

// 현재 구현된 연동 카탈로그. 새 연동 추가 시 이 배열에 항목을 더한다.
const CATALOG: CatalogItem[] = [
  {
    icon: Truck,
    source: '배송 데이터 (배송 관리)',
    target: '통합 재고 관리',
    description: '완료된 배송 주문을 재고 출고·이관 이동으로 변환해 통합 재고에 반영합니다.',
    status: '활성',
    href: SELLER_HUB_SHIPPING_ORDERS_PATH,
  },
  {
    icon: Boxes,
    source: '쿠팡 로켓그로스 재고 (쿠팡 광고)',
    target: '재고 대조',
    description: '쿠팡 광고 관리자에서 수집된 재고 스냅샷을 불러와 보관 장소 재고와 대조합니다.',
    status: '활성',
    href: SELLER_HUB_RECONCILIATION_PATH,
  },
]

export function IntegrationCatalog() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">연동 가능 소스</CardTitle>
        <p className="text-sm text-muted-foreground">
          다른 Deck·외부 데이터를 워크덱 기능과 연결합니다.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {CATALOG.map((item) => (
          <Link
            key={`${item.source}-${item.target}`}
            href={item.href}
            className="flex items-start gap-3 rounded-md border p-3 transition-colors hover:bg-muted/50"
          >
            <item.icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="truncate">{item.source}</span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{item.target}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
            </div>
            <Badge variant="secondary" className="shrink-0">
              {item.status}
            </Badge>
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}
