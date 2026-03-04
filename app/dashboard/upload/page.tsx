import { redirect } from 'next/navigation'
import { COUPANG_ADS_UPLOAD_PATH } from '@/lib/deck-routes'

export default function DashboardUploadLegacyPage() {
  redirect(COUPANG_ADS_UPLOAD_PATH)
}
