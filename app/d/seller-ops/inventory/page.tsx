import { redirect } from 'next/navigation'
import { SELLER_HUB_STOCK_STATUS_PATH } from '@/lib/deck-routes'

export default function InventoryRootPage() {
  redirect(SELLER_HUB_STOCK_STATUS_PATH)
}
