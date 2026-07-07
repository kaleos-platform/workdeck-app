import { redirect } from 'next/navigation'
import { BLOG_OPS_HOME_PATH } from '@/lib/deck-routes'

export default function BlogOpsRootPage() {
  redirect(BLOG_OPS_HOME_PATH)
}
