import { redirect } from 'next/navigation'
import { RECRUITING_HOME_PATH } from '@/lib/deck-routes'

export default function RecruitingIndexPage() {
  redirect(RECRUITING_HOME_PATH)
}
