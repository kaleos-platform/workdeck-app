// /channels → 통합 설정 페이지 채널 탭으로 리다이렉트 (PR-A)
import { redirect } from 'next/navigation'

export default function ChannelsPage() {
  redirect('/d/sales-content/settings?tab=channels')
}
