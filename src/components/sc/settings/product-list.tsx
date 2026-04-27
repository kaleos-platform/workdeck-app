import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SALES_CONTENT_PRODUCTS_PATH } from '@/lib/deck-routes'

type ProductRow = {
  id: string
  name: string
  slug: string
  oneLinerPitch: string | null
  isActive: boolean
  updatedAt: Date
}

type Props = {
  products: ProductRow[]
}

export function ProductList({ products }: Props) {
  if (products.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <p className="text-sm text-muted-foreground">
            아직 등록된 판매 상품이 없습니다. 첫 상품을 등록해 아이데이션을 시작하세요.
          </p>
          <Button asChild className="mt-4">
            <Link href={`${SALES_CONTENT_PRODUCTS_PATH}/new`}>상품 추가</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-2">
      {products.map((p) => (
        <Link
          key={p.id}
          href={`${SALES_CONTENT_PRODUCTS_PATH}/${p.id}`}
          className="block rounded-lg border bg-card p-4 transition hover:border-primary/40 hover:bg-accent"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-sm font-semibold">{p.name}</h3>
                {!p.isActive && (
                  <Badge variant="outline" className="text-xs">
                    비활성
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 font-mono text-xs text-muted-foreground">/{p.slug}</p>
              {p.oneLinerPitch && (
                <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{p.oneLinerPitch}</p>
              )}
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">
              {new Intl.DateTimeFormat('ko-KR', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
              }).format(p.updatedAt)}
            </span>
          </div>
        </Link>
      ))}
    </div>
  )
}
