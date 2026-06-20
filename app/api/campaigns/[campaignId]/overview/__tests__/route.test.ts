/** @jest-environment node */

import { NextRequest } from 'next/server'

const resolveWorkspaceMock = jest.fn()
const getCachedCampaignOverviewMock = jest.fn()

jest.mock('@/lib/api-helpers', () => ({
  resolveWorkspace: () => resolveWorkspaceMock(),
  errorResponse: (message: string, status: number) => Response.json({ message }, { status }),
}))

jest.mock('@/lib/coupang-ads/campaign-overview', () => ({
  getCachedCampaignOverview: (...args: unknown[]) => getCachedCampaignOverviewMock(...args),
}))

import { GET } from '@/app/api/campaigns/[campaignId]/overview/route'

describe('GET /api/campaigns/[campaignId]/overview', () => {
  beforeEach(() => {
    resolveWorkspaceMock.mockReset()
    getCachedCampaignOverviewMock.mockReset()
    resolveWorkspaceMock.mockResolvedValue({ workspace: { id: 'workspace-1' } })
  })

  test('workspace와 기간을 포함해 cache loader를 호출한다', async () => {
    getCachedCampaignOverviewMock.mockResolvedValue({ campaign: { id: 'campaign-1' } })
    const request = new NextRequest(
      'http://localhost/api/campaigns/campaign-1/overview?from=2026-05-01&to=2026-05-07&adType=all'
    )

    const response = (await GET(request, {
      params: Promise.resolve({ campaignId: 'campaign-1' }),
    }))!

    expect(response.status).toBe(200)
    expect(getCachedCampaignOverviewMock).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      campaignId: 'campaign-1',
      from: '2026-05-01',
      to: '2026-05-07',
      adType: 'all',
    })
  })

  test('기간 형식이 잘못되면 400을 반환한다', async () => {
    const request = new NextRequest(
      'http://localhost/api/campaigns/campaign-1/overview?from=invalid&to=2026-05-07'
    )

    const response = (await GET(request, {
      params: Promise.resolve({ campaignId: 'campaign-1' }),
    }))!

    expect(response.status).toBe(400)
    expect(getCachedCampaignOverviewMock).not.toHaveBeenCalled()
  })
})
