import { PricingQuickFlow } from '@/components/sh/products/pricing-sim/pricing-quick-flow'

type Props = { searchParams: Promise<{ productId?: string }> }

// 신규 시나리오 시뮬레이터 (선택적으로 ?productId로 상품 자동 선택)
export default async function PricingSimNewPage({ searchParams }: Props) {
  const { productId } = await searchParams
  return <PricingQuickFlow initialProductId={productId} />
}
