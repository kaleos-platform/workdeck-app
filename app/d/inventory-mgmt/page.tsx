import { redirect } from 'next/navigation'
import { INVENTORY_MGMT_STOCK_STATUS_PATH } from '@/lib/deck-routes'

export default function InventoryMgmtPage() {
  redirect(INVENTORY_MGMT_STOCK_STATUS_PATH)
}
