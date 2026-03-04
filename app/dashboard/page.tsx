import { redirect } from 'next/navigation'
import { COUPANG_ADS_BASE_PATH } from '@/lib/deck-routes'

export default function DashboardLegacyPage() {
  redirect(COUPANG_ADS_BASE_PATH)
}
