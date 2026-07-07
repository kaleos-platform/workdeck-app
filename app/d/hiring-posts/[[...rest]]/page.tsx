import { redirect } from 'next/navigation'
import { RECRUITING_HOME_PATH } from '@/lib/deck-routes'

// 구 /d/hiring-posts/** → /d/recruiting/** 리다이렉트 (recruiting 통합으로 대체)
export default async function HiringPostsCatchAllPage({
  params,
}: {
  params: Promise<{ rest?: string[] }>
}) {
  const { rest = [] } = await params

  // postings/[id]/build/* → /d/recruiting/postings/[id]/build/*
  // settings/stores → /d/recruiting/settings/stores
  // settings/positions → /d/recruiting/settings/positions
  // templates → /d/recruiting/templates
  // (fallback) → /d/recruiting/home
  const SEGMENT_MAP: Record<string, string> = {
    postings: 'postings',
    settings: 'settings',
    templates: 'templates',
    home: 'home',
  }

  if (rest.length > 0 && SEGMENT_MAP[rest[0]]) {
    redirect(`/d/recruiting/${rest.join('/')}`)
  }

  redirect(RECRUITING_HOME_PATH)
}
