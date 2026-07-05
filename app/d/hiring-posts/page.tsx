import { redirect } from 'next/navigation'
import { HIRING_POSTS_HOME_PATH } from '@/lib/deck-routes'

export default function HiringPostsIndexPage() {
  redirect(HIRING_POSTS_HOME_PATH)
}
