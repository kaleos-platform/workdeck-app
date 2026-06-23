import { redirect } from 'next/navigation'
import { FINANCE_DASHBOARD_PATH } from '@/lib/deck-routes'

export default function FinanceIndexPage() {
  redirect(FINANCE_DASHBOARD_PATH)
}
