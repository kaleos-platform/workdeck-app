import { redirect } from 'next/navigation'
import { SELLER_HUB_PRODUCTS_LIST_PATH } from '@/lib/deck-routes'

export default function ProductsRootPage() {
  redirect(SELLER_HUB_PRODUCTS_LIST_PATH)
}
