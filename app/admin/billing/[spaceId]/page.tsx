import { BillingSpaceDetail } from '@/components/admin/billing-space-detail'

export default async function AdminBillingSpacePage({
  params,
}: {
  params: Promise<{ spaceId: string }>
}) {
  const { spaceId } = await params
  return <BillingSpaceDetail spaceId={spaceId} />
}
