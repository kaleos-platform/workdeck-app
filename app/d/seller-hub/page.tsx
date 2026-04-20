import { redirect } from 'next/navigation'
import { SELLER_HUB_HOME_PATH } from '@/lib/deck-routes'

export default function SellerHubRootPage() {
  redirect(SELLER_HUB_HOME_PATH)
}
