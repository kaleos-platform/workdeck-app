import { redirect } from 'next/navigation'
import { RECRUITING_APPLICATIONS_PATH } from '@/lib/deck-routes'

// 메시지 템플릿 기능 제거 — 북마크 대비 지원자 목록으로 이동
export default function MessageTemplatesRemovedPage() {
  redirect(RECRUITING_APPLICATIONS_PATH)
}
