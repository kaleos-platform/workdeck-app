// /rules → 통합 설정 페이지 개선 규칙 탭으로 리다이렉트 (PR-A)
import { redirect } from 'next/navigation'

export default function RulesPage() {
  redirect('/d/sales-content/settings?tab=rules')
}
