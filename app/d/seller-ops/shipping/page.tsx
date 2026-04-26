import { redirect } from 'next/navigation'
import { SELLER_HUB_SHIPPING_REGISTRATION_PATH } from '@/lib/deck-routes'

export default function ShippingRootPage() {
  redirect(SELLER_HUB_SHIPPING_REGISTRATION_PATH)
}
