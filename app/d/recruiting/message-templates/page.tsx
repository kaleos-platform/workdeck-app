import { redirect } from 'next/navigation'
import { RECRUITING_MESSAGES_PATH } from '@/lib/deck-routes'

// 구 메시지 템플릿 경로 → 설정 > 메시지 관리
export default function MessageTemplatesRedirectPage() {
  redirect(RECRUITING_MESSAGES_PATH)
}
