/** @jest-environment node */
jest.mock('@/lib/agent/integrations/space-credential', () => ({
  loadSpaceCredentialConfig: jest.fn(),
}))
jest.mock('@/lib/agent/integrations/meta-ads', () => {
  const actual = jest.requireActual('@/lib/agent/integrations/meta-ads')
  return {
    ...actual,
    assertMetaTarget: jest.fn(() => 'act_123'),
    loadMetaCred: jest.fn(),
    assertActionInAccount: jest.fn(),
    graphRequest: jest.fn(),
  }
})

import {
  MetaApiError,
  assertActionInAccount,
  graphRequest,
  loadMetaCred,
} from '@/lib/agent/integrations/meta-ads'
import { metaAdsActions } from '../meta-ads'
import type { ActionExecContext } from '../types'

const ctx: ActionExecContext = {
  spaceId: 'sp-1',
  actor: { type: 'agent', id: 'ag-1' },
  requesterUserId: null,
  workId: 'wk_1',
  decryptedCredentialIds: [],
}
const def = (name: string) => metaAdsActions.find((a) => a.actionType === `meta-ads.${name}`)!
const validate = (name: string, params: Record<string, unknown>) =>
  def(name).validateCreate!(ctx, { brand: 'brand-a', adAccountId: 'act_123', params })

const graph = graphRequest as jest.Mock
const cred = { id: 'cred-1', secret: { accessToken: 't', appSecret: 's' }, config: {} }

beforeEach(() => {
  jest.clearAllMocks()
  ;(assertActionInAccount as jest.Mock).mockReset().mockResolvedValue(undefined)
  ;(loadMetaCred as jest.Mock).mockResolvedValue(cred)
  graph.mockResolvedValue({ success: true })
})

it('adset.create 는 같은 요청에 validate_only 를 붙여 계정 경로로 미리 보낸다', async () => {
  await validate('adset.create', { campaign_id: '1', name: 'x', daily_budget: 10000 })
  expect(graph).toHaveBeenCalledWith(cred, 'POST', '/act_123/adsets', {
    campaign_id: '1',
    name: 'x',
    daily_budget: 10000,
    execution_options: ['validate_only'],
  })
})

it('adset.update 는 계정 소속을 먼저 확인하고 객체 경로로 검증한다', async () => {
  const order: string[] = []
  ;(assertActionInAccount as jest.Mock).mockImplementation(async () => order.push('assert'))
  graph.mockImplementation(async () => order.push('graph'))
  await validate('adset.update', { adset_id: '555', daily_budget: 28000 })
  expect(order).toEqual(['assert', 'graph'])
  expect(graph.mock.calls[0][2]).toBe('/555')
  expect(graph.mock.calls[0][3]).toMatchObject({ execution_options: ['validate_only'] })
})

it('Meta 가 거부하면 사전 검증 실패로 제안을 거부한다(토큰 형태 문자열은 가린다)', async () => {
  graph.mockRejectedValue(
    new MetaApiError('Invalid parameter: https://graph.facebook.com/x?access_token=EAAsecret123')
  )
  const p = validate('ad.create', { adset_id: '1', name: 'a', creative: { creative_id: '2' } })
  await expect(p).rejects.toThrow(/^Meta 사전 검증 실패: /)
  await expect(p).rejects.not.toThrow(/EAAsecret123/)
})

it('Meta 연결 실패(시간 초과)도 제안을 거부한다', async () => {
  graph.mockRejectedValue(new MetaApiError('Meta API 응답이 없습니다(시간 초과)'))
  await expect(
    validate('campaign.create', { name: 'c', objective: 'OUTCOME_SALES' })
  ).rejects.toThrow('Meta 사전 검증 실패: Meta API 응답이 없습니다(시간 초과)')
})

it('계정 경계 거부는 그대로 전파한다(Meta 검증 오류로 바꾸지 않음)', async () => {
  ;(assertActionInAccount as jest.Mock).mockRejectedValue(
    new Error('이 Space 광고 계정의 객체가 아닙니다')
  )
  await expect(validate('ad.update', { ad_id: '9', name: 'n' })).rejects.toThrow(
    '이 Space 광고 계정의 객체가 아닙니다'
  )
  expect(graph).not.toHaveBeenCalled()
})

it.each([
  ['adstudy.create', { business_id: '1', name: 's', cells: [] }],
  ['adset.update_status', { adset_id: '1', status: 'PAUSED' }],
])(
  '%s 는 Meta 를 부르지 않는다(adstudy 는 validate_only 를 무시하고 실제 생성됨)',
  async (name, params) => {
    await validate(name, params)
    expect(loadMetaCred).not.toHaveBeenCalled()
    expect(graph).not.toHaveBeenCalled()
  }
)

it('응답에 id 가 오면(검증 무시하고 실제 생성) 제안을 거부한다', async () => {
  graph.mockResolvedValue({ id: '120000000099' })
  await expect(validate('creative.create', { name: 'c', object_story_id: '1_2' })).rejects.toThrow(
    /실제로 생성했습니다\(id 120000000099\)/
  )
})

describe('검증 대상 표 — 새 액션은 기본 제외', () => {
  const { META_ACTIONS, META_VALIDATE_ONLY_ACTIONS } = jest.requireActual(
    '@/lib/agent/integrations/meta-ads'
  )
  it('검증 대상은 create·update 7개이고 adstudy·status 는 없다', () => {
    expect([...META_VALIDATE_ONLY_ACTIONS].sort()).toEqual([
      'ad.create',
      'ad.update',
      'adset.create',
      'adset.update',
      'campaign.create',
      'campaign.update',
      'creative.create',
    ])
    for (const name of Object.keys(META_ACTIONS)) {
      if (name.startsWith('adstudy.') || name.endsWith('update_status'))
        expect(META_VALIDATE_ONLY_ACTIONS.has(name)).toBe(false)
    }
  })
})
