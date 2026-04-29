// /settings/personas → 통합 설정 세일즈 정보 탭으로 리다이렉트 (PR-A)
import { redirect } from 'next/navigation'

export default function PersonasPage() {
  redirect('/d/sales-content/settings?tab=sales-info&section=personas')
}
