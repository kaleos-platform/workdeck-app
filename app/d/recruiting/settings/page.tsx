import { redirect } from 'next/navigation'
import { RECRUITING_COMPANY_PATH } from '@/lib/deck-routes'

// 설정 기본 탭 = 기업 정보
export default function RecruitingSettingsIndexPage() {
  redirect(RECRUITING_COMPANY_PATH)
}
