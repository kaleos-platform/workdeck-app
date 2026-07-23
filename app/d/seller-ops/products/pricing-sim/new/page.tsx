import { PricingQuickFlow } from '@/components/sh/products/pricing-sim/pricing-quick-flow'

type Props = { searchParams: Promise<{ productId?: string; mode?: string }> }

// 신규 시나리오 시뮬레이터
// - ?productId=... : 기존 상품 자동 선택
// - ?mode=new      : 신규(미등록) 상품 직접 입력 (productId 없을 때만)
export default async function PricingSimNewPage({ searchParams }: Props) {
  const { productId, mode } = await searchParams
  const initialMode = mode === 'new' && !productId ? 'new' : 'existing'
  return <PricingQuickFlow initialProductId={productId} initialMode={initialMode} />
}
