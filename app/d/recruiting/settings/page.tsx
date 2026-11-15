import { redirect } from 'next/navigation'
import { RECRUITING_STORES_PATH } from '@/lib/deck-routes'

// 설정 기본 탭 = 매장 관리
export default function RecruitingSettingsIndexPage() {
  redirect(RECRUITING_STORES_PATH)
}
