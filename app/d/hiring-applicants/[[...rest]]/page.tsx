import { redirect } from 'next/navigation'
import { RECRUITING_HOME_PATH, RECRUITING_MESSAGES_PATH } from '@/lib/deck-routes'

// 구 /d/hiring-applicants/** → /d/recruiting/** 리다이렉트 (recruiting 통합으로 대체)
export default async function HiringApplicantsCatchAllPage({
  params,
}: {
  params: Promise<{ rest?: string[] }>
}) {
  const { rest = [] } = await params

  // applications/[id] → /d/recruiting/applications/[id]
  // blacklist → /d/recruiting/blacklist
  // message-templates → 설정 > 메시지 관리
  // home → /d/recruiting/home
  // (fallback) → /d/recruiting/home
  const SEGMENT_MAP: Record<string, string> = {
    applications: 'applications',
    blacklist: 'blacklist',
    home: 'home',
  }

  if (rest[0] === 'message-templates') redirect(RECRUITING_MESSAGES_PATH)

  if (rest.length > 0 && SEGMENT_MAP[rest[0]]) {
    redirect(`/d/recruiting/${rest.join('/')}`)
  }

  redirect(RECRUITING_HOME_PATH)
}
