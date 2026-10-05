import { CoupangMatchingView } from '@/components/sh/products/listings/coupang-matching-view'

export default function CoupangMatchingPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">쿠팡 상품 매칭</h1>
        <p className="text-sm text-muted-foreground">
          쿠팡 옵션과 판매채널 상품을 연결합니다. 연결된 상품만 가격시뮬에서 쿠팡 판매가로 반영할 수 있습니다
        </p>
      </div>
      <CoupangMatchingView />
    </div>
  )
}
