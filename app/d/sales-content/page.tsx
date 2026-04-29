import { redirect } from 'next/navigation'
import { SALES_CONTENT_HOME_PATH } from '@/lib/deck-routes'

export default function SalesContentRootPage() {
  redirect(SALES_CONTENT_HOME_PATH)
}
