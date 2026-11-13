import { notFound } from 'next/navigation'
import { isDevPlanEnabled, listPlan } from '@/lib/dev/plan-files'
import { PlanReview } from './plan-review'

// UI 계획 시각 검토 — 개발 서버 전용. 프로덕션 빌드에서는 항상 404.
export default async function DevPlanPage({ params }: { params: Promise<{ task: string }> }) {
  if (!isDevPlanEnabled()) notFound()
  const { task } = await params
  const plan = await listPlan(task)
  if (!plan || plan.screens.length === 0) notFound()
  return <PlanReview task={task} screens={plan.screens} notes={plan.notes} />
}
