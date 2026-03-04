import { redirect } from 'next/navigation'
import { getCoupangAdsCampaignPath } from '@/lib/deck-routes'

export default async function DashboardCampaignLegacyPage({
  params,
  searchParams,
}: {
  params: Promise<{ campaignId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { campaignId } = await params
  const query = await searchParams
  const nextPath = new URLSearchParams()

  Object.entries(query).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (entry !== undefined) {
          nextPath.append(key, entry)
        }
      })
      return
    }
    if (value !== undefined) {
      nextPath.set(key, value)
    }
  })

  const basePath = getCoupangAdsCampaignPath(campaignId)
  const target = nextPath.size > 0 ? `${basePath}?${nextPath.toString()}` : basePath
  redirect(target)
}
