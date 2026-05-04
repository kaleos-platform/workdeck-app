import { redirect } from 'next/navigation'
import { SELLER_HUB_BRANDS_PATH } from '@/lib/deck-routes'

export default function LegacyBrandsPage() {
  redirect(SELLER_HUB_BRANDS_PATH)
}
