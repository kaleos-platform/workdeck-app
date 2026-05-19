import { redirect } from 'next/navigation'
import { SELLER_HUB_SETTINGS_INTEGRATION_PATH } from '@/lib/deck-routes'

export default function ShippingIntegrationRedirectPage() {
  redirect(SELLER_HUB_SETTINGS_INTEGRATION_PATH)
}
