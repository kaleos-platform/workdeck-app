import { PricingQuickFlow } from '@/components/sh/products/pricing-sim/pricing-quick-flow'

type Props = { params: Promise<{ scenarioId: string }> }

// 시나리오 상세 = 저장 시나리오를 불러온 시뮬레이터 편집 화면
export default async function PricingScenarioDetailPage({ params }: Props) {
  const { scenarioId } = await params
  return <PricingQuickFlow initialScenarioId={scenarioId} />
}
