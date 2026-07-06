import { redirect } from 'next/navigation'
import { HIRING_APPLICANTS_HOME_PATH } from '@/lib/deck-routes'

export default function HiringApplicantsIndexPage() {
  redirect(HIRING_APPLICANTS_HOME_PATH)
}
