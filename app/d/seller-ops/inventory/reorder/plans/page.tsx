import { redirect } from 'next/navigation'

// 발주 계획 목록은 발주 예측 인덱스(/inventory/reorder)로 통합됨.
// 레거시 링크 보호용 redirect.
export default function ReorderPlansPage() {
  redirect('/d/seller-ops/inventory/reorder')
}
