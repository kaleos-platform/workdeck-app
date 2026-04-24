import { ListingsTwoPane } from '@/components/sh/products/listings/listings-two-pane'

export default function ListingsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">판매채널 상품</h1>
        <p className="text-sm text-muted-foreground">채널별로 판매할 상품 묶음을 구성합니다</p>
      </div>
      <ListingsTwoPane />
    </div>
  )
}
