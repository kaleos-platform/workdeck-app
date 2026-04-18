import { redirect } from 'next/navigation'
import { DELIVERY_MGMT_REGISTRATION_PATH } from '@/lib/deck-routes'

export default function DeliveryMgmtPage() {
  redirect(DELIVERY_MGMT_REGISTRATION_PATH)
}
