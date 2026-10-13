/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({
  prisma: {
    spaceCredential: { findUnique: jest.fn(), update: jest.fn() },
    space: { findUnique: jest.fn() },
  },
}))
jest.mock('@/lib/crypto/field-crypto', () => ({
  decryptField: jest.fn((_p: string, v: string) => v),
}))
jest.mock('@/lib/agent/actions/registry', () => ({
  getActionDefinition: (t: string) =>
    jest
      .requireActual('@/lib/agent/actions/meta-ads')
      .metaAdsActions.find((a: { actionType: string }) => a.actionType === t),
}))
jest.mock('@/lib/agent/actions/create', () => ({
  createPendingAction: jest.fn(async () => ({
    status: 'pending_approval',
    actionId: 'a1',
    approvalUrl: 'u',
    expiresAt: 'e',
  })),
}))

import { prisma } from '@/lib/prisma'
import { createPendingAction } from '@/lib/agent/actions/create'
import { requiredDecisionRole } from '@/lib/agent/actions/decision-policy'
import { summarizeArgs } from '@/lib/agent/audit'
import {
  fetchAdAccountCurrencies,
  metaActionRequest,
  metaSpendKrw,
  resolveAdAccount,
  sanitizeMetaResponse,
  validateMetaAction,
} from '../meta-ads'
import { metaAdsTools } from '@/lib/agent/tools/meta-ads-tools'
import { metaAdsActions } from '@/lib/agent/actions/meta-ads'
import { toolDefinitions } from '@/lib/agent/tools'
import { ToolUserError } from '@/lib/agent/tools/errors'
import type { McpToolContext } from '@/lib/agent/tools/types'
import type { ActionExecContext } from '@/lib/agent/actions/types'

// accountCurrencies는 서버가 저장 시점에 Graph로 확인해 넣은 값(입력 아님).
const CONFIG = {
  defaultBrand: 'brand-a',
  adAccounts: { 'brand-a': '111', 'brand-b': 'act_222' },
  accountCurrencies: { act_111: 'KRW', act_222: 'USD' },
}
const execCtx = (): ActionExecContext => ({
  spaceId: 'sp1',
  actor: { type: 'agent', id: 'agent-1' },
  requesterUserId: null,
  workId: 'wk',
  deciderId: 'u-admin',
  actionId: 'a1',
  decryptedCredentialIds: [],
})
const credRow = (config: object) => ({
  id: 'cred1',
  encryptedPayload: JSON.stringify({ accessToken: 'token', appSecret: 'secret' }),
  iv: 'iv-opaque',
  config,
})
const ctx = (): McpToolContext => ({
  spaceId: 'sp1',
  actor: { type: 'agent', id: 'agent-1' },
  scopes: ['meta:read', 'meta:write'],
  workId: 'wk',
  requesterUserId: null,
  requesterSlackUserId: null,
  decryptedCredentialIds: [],
})
const tool = (n: string) => metaAdsTools.find((t) => t.name === n)!
const action = (t: string) => metaAdsActions.find((a) => a.actionType === t)!
const ok = (body: unknown) => ({ ok: true, json: async () => body })
let fetchMock: jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  ;(prisma.spaceCredential.findUnique as jest.Mock).mockResolvedValue(credRow(CONFIG))
  fetchMock = jest.fn(async () => ok({ data: [] }))
  global.fetch = fetchMock as unknown as typeof fetch
})

describe('meta-ads (포팅)', () => {
  it('resolveAdAccount maps brand names and normalizes act prefix', () => {
    expect(resolveAdAccount(CONFIG, 'brand-a')).toBe('act_111')
    expect(resolveAdAccount(CONFIG, 'brand-b')).toBe('act_222')
    expect(resolveAdAccount(CONFIG)).toBe('act_111')
    expect(() => resolveAdAccount(CONFIG, 'unknown')).toThrow(
      '알 수 없는 메타 광고 브랜드: unknown'
    )
    expect(() => resolveAdAccount(CONFIG, 'constructor')).toThrow('알 수 없는 메타 광고 브랜드')
  })

  it('validateMetaAction rejects unsupported write actions', () => {
    expect(() => validateMetaAction({ action: 'delete_campaign', params: {} })).toThrow(
      '지원하지 않는 메타 광고 액션'
    )
  })

  it('validateMetaAction: 경로 id는 숫자만(act_·경로 문자 차단)', () => {
    for (const id of ['act_111', '1/adsets', undefined]) {
      expect(() =>
        validateMetaAction({ action: 'campaign.update', params: { campaign_id: id } })
      ).toThrow('params.campaign_id는 숫자 id여야 합니다')
    }
    expect(() =>
      validateMetaAction({ action: 'adstudy.create', params: { business_id: '680' } })
    ).not.toThrow()
  })

  it('adstudy.create posts to the business and keeps business_id out of the body', () => {
    expect(
      metaActionRequest('adstudy.create', 'act_1', {
        business_id: '680',
        name: 'ab',
        type: 'SPLIT_TEST',
      })
    ).toEqual({ endpoint: '/680/ad_studies', body: { name: 'ab', type: 'SPLIT_TEST' } })
    expect(metaActionRequest('adstudy.update', 'act_1', { study_id: '9', name: 'x' })).toEqual({
      endpoint: '/9',
      body: { name: 'x' },
    })
    expect(metaActionRequest('campaign.create', 'act_1', { name: 'c' })).toEqual({
      endpoint: '/act_1/campaigns',
      body: { name: 'c' },
    })
  })

  it('sanitizeMetaResponse removes credential-bearing paging URLs', () => {
    const cleaned = sanitizeMetaResponse({
      data: [],
      paging: {
        next: 'https://graph.facebook.com/v26.0/act_1/campaigns?access_token=secret&after=c',
      },
    }) as { paging: { next: string } }
    expect(cleaned.paging.next).toBe('[redacted]')
  })

  it('감사 인자 요약은 토큰류 키를 가린다', () => {
    const s = summarizeArgs({
      params: { access_token: 'tok-x', appsecret_proof: 'proof-y', accessToken: 'z' },
    })
    expect(s).not.toMatch(/tok-x|proof-y|"z"/)
  })

  it('MCP 도구는 조회 3 + 제안 1 — 승인·실행 도구는 노출하지 않는다', () => {
    expect(metaAdsTools.map((t) => t.name)).toEqual([
      'meta_ads_list_campaigns',
      'meta_ads_list_ads',
      'meta_ads_get_insights',
      'meta_ads_propose_action',
    ])
    expect(toolDefinitions.some((t) => /^meta_ads_(approve|execute)/.test(t.name))).toBe(false)
  })

  it('활성 광고 조회는 선택한 브랜드 계정과 effective_status를 사용한다', async () => {
    await tool('meta_ads_list_ads').execute(ctx(), { brand: 'brand-a' })
    const url = new URL(fetchMock.mock.calls[0][0])
    expect(url.pathname).toBe('/v26.0/act_111/ads')
    expect(url.searchParams.get('effective_status')).toBe('["ACTIVE"]')
    expect(url.searchParams.get('fields')).toMatch(/effective_status/)
    expect(url.searchParams.get('appsecret_proof')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('조회 시 복호화한 자격증명 id를 감사용으로 남긴다', async () => {
    const c = ctx()
    await tool('meta_ads_list_campaigns').execute(c, {})
    expect(c.decryptedCredentialIds).toEqual(['cred1'])
  })

  it('자격증명이 없으면 값 노출 없이 사용자 오류', async () => {
    ;(prisma.spaceCredential.findUnique as jest.Mock).mockResolvedValue(null)
    const p = tool('meta_ads_list_campaigns').execute(ctx(), {})
    await expect(p).rejects.toThrow('meta-ads 자격증명이 등록되지 않았습니다')
    await expect(p).rejects.toBeInstanceOf(ToolUserError)
  })

  it('Graph 오류는 마스킹한 사용자 오류로 전달한다', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'bad url ?access_token=EAAB123&x=1' } }),
    })
    const p = tool('meta_ads_list_campaigns').execute(ctx(), {})
    await expect(p).rejects.toBeInstanceOf(ToolUserError)
    await expect(p).rejects.toThrow(/access_token=\[redacted\]/)
  })

  it('get_insights: 다른 광고 계정의 object_id는 거부(Space 경계)', async () => {
    fetchMock.mockResolvedValueOnce(ok({ account_id: '999' }))
    await expect(
      tool('meta_ads_get_insights').execute(ctx(), { brand: 'brand-a', object_id: '123' })
    ).rejects.toThrow('이 Space의 광고 계정에 속하지 않는 객체입니다')
  })

  it('propose → 승인 큐(PENDING), Meta API는 호출하지 않는다', async () => {
    const r = await tool('meta_ads_propose_action').execute(ctx(), {
      brand: 'brand-a',
      action: 'campaign.update_status',
      params: { campaign_id: '123', status: 'PAUSED' },
      summary: '캠페인 123 일시중지',
    })
    expect(r).toMatchObject({ status: 'pending_approval' })
    expect(createPendingAction).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: 'sp1',
        actionType: 'meta-ads.campaign.update_status',
        actor: { type: 'agent', id: 'agent-1' },
        workId: 'wk',
        params: {
          brand: 'brand-a',
          adAccountId: 'act_111',
          params: { campaign_id: '123', status: 'PAUSED' },
        },
      })
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // 승인 역할 판정은 requiredDecisionRole(웹 PATCH와 Slack 버튼 공용)이 한다.
  it('metaSpendKrw: 예산 파라미터의 최댓값, 없으면 null', () => {
    expect(metaSpendKrw({ daily_budget: '200000' })).toBe(200000)
    expect(metaSpendKrw({ daily_budget: 50000, lifetime_budget: '300000' })).toBe(300000)
    expect(metaSpendKrw({ status: 'PAUSED' })).toBeNull()
    expect(metaSpendKrw({ daily_budget: 'abc' })).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('예산 액션만 spendKrw를 돌려주고 나머지는 null', () => {
    const spend = (t: string, params: Record<string, unknown>) =>
      action(t).spendKrw!({ adAccountId: 'act_1', params } as never)
    expect(spend('meta-ads.adset.update', { adset_id: '1', daily_budget: '200000' })).toBe(200000)
    expect(spend('meta-ads.campaign.create', { name: 'n', lifetime_budget: '500000' })).toBe(500000)
    expect(spend('meta-ads.adset.update', { adset_id: '1', name: 'x' })).toBeNull()
    expect(spend('meta-ads.ad.update', { ad_id: '1', daily_budget: '999999' })).toBeNull()
    expect(spend('meta-ads.ad.update_status', { ad_id: '1', status: 'PAUSED' })).toBeNull()
    expect(
      spend('meta-ads.adstudy.create', { business_id: '1', daily_budget: '999999' })
    ).toBeNull()
  })

  it('adset.update daily_budget 200000 > approvalLimitKrw 100000 → OWNER, 예산 없으면 ADMIN', async () => {
    ;(prisma.space.findUnique as jest.Mock).mockResolvedValue({ approvalLimitKrw: 100_000 })
    const act = (params: Record<string, unknown>) => ({
      spaceId: 'sp1',
      actionType: 'meta-ads.adset.update',
      payload: { brand: 'brand-a', adAccountId: 'act_1', params },
    })
    await expect(
      requiredDecisionRole(act({ adset_id: '1', daily_budget: '200000' }), 'approve')
    ).resolves.toBe('OWNER')
    await expect(
      requiredDecisionRole(act({ adset_id: '1', daily_budget: '80000' }), 'approve')
    ).resolves.toBe('ADMIN')
    await expect(requiredDecisionRole(act({ adset_id: '1', name: 'x' }), 'approve')).resolves.toBe(
      'ADMIN'
    )
  })

  it.each([
    ['USD로 확인된 계정', 'brand-b', CONFIG],
    ['통화 미확인 계정', 'brand-a', { ...CONFIG, accountCurrencies: {} }],
  ])('예산 제안 거부 — %s', async (_l, brand, config) => {
    ;(prisma.spaceCredential.findUnique as jest.Mock).mockResolvedValue(credRow(config))
    await expect(
      tool('meta_ads_propose_action').execute(ctx(), {
        brand,
        action: 'adset.update',
        params: { adset_id: '1', daily_budget: '100' },
        summary: 's',
      })
    ).rejects.toThrow('KRW로 확인된 광고 계정만 예산 변경을 제안할 수 있습니다')
    expect(createPendingAction).not.toHaveBeenCalled()
  })

  it('예산이 아닌 변경(상태)은 통화와 무관하게 제안할 수 있다', async () => {
    await tool('meta_ads_propose_action').execute(ctx(), {
      brand: 'brand-b',
      action: 'campaign.update_status',
      params: { campaign_id: '1', status: 'PAUSED' },
      summary: 's',
    })
    expect(createPendingAction).toHaveBeenCalled()
  })

  it('validateCreate: 세션 POST로 들어온 미등록 광고 계정 payload를 거부(MCP 우회 차단)', async () => {
    const def = action('meta-ads.campaign.update_status')
    await expect(
      def.validateCreate!(execCtx(), {
        brand: 'brand-a',
        adAccountId: 'act_999',
        params: { campaign_id: '1', status: 'PAUSED' },
      })
    ).rejects.toThrow('광고 계정 매핑이 바뀌었거나 이 Space에 등록되지 않은 계정입니다')
    await expect(
      def.validateCreate!(execCtx(), {
        brand: 'brand-a',
        adAccountId: 'act_111',
        params: { campaign_id: 'act_111', status: 'PAUSED' },
      })
    ).rejects.toThrow('숫자 id')
    await expect(
      def.validateCreate!(execCtx(), {
        brand: 'brand-a',
        adAccountId: 'act_111',
        params: { campaign_id: '1', status: 'PAUSED' },
      })
    ).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled() // validateCreate는 Graph를 부르지 않는다
  })

  it('mapping changed → 승인 후 execute가 실패하고 Meta 쓰기를 하지 않는다', async () => {
    // 제안 뒤 운영자가 brand-a 매핑을 다른 계정으로 바꿨다.
    ;(prisma.spaceCredential.findUnique as jest.Mock).mockResolvedValue(
      credRow({
        ...CONFIG,
        adAccounts: { ...CONFIG.adAccounts, 'brand-a': 'act_5555' },
        accountCurrencies: { act_5555: 'KRW' },
      })
    )
    await expect(
      action('meta-ads.campaign.update_status').execute(execCtx(), {
        brand: 'brand-a',
        adAccountId: 'act_111',
        params: { campaign_id: '123', status: 'PAUSED' },
      })
    ).rejects.toThrow('광고 계정 매핑이 바뀌었거나')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('승인 후 execute는 Graph POST로 실행하고 복호화한 자격증명 id를 실행 컨텍스트에 남긴다', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ account_id: '111' })) // 소속 확인
      .mockResolvedValueOnce(ok({ success: true }))
    const c = execCtx()
    const out = await action('meta-ads.campaign.update_status').execute(c, {
      brand: 'brand-a',
      adAccountId: 'act_111',
      params: { campaign_id: '123', status: 'PAUSED' },
    })
    expect(out).toEqual({ success: true })
    const [url, init] = fetchMock.mock.calls[1]
    expect(new URL(url).pathname).toBe('/v26.0/123')
    expect(init.method).toBe('POST')
    expect(c.decryptedCredentialIds).toEqual(['cred1'])
  })

  it('execute Graph 실패 → 자격증명 lastError에 마스킹해 기록하고 다시 throw', async () => {
    ;(prisma.spaceCredential.update as jest.Mock).mockResolvedValue({})
    fetchMock.mockResolvedValueOnce(ok({ account_id: '111' })).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'x token=abc' } }),
    })
    await expect(
      action('meta-ads.campaign.update_status').execute(execCtx(), {
        brand: 'brand-a',
        adAccountId: 'act_111',
        params: { campaign_id: '123', status: 'PAUSED' },
      })
    ).rejects.toThrow('x token=[redacted]')
    expect(prisma.spaceCredential.update).toHaveBeenCalledWith({
      where: { id: 'cred1' },
      data: { lastError: 'x token=[redacted]' },
    })
  })

  describe('adstudy 실행 — 비즈니스·cells 소속 확인', () => {
    const run = (params: Record<string, unknown>, t = 'meta-ads.adstudy.create') =>
      action(t).execute(execCtx(), { brand: 'brand-a', adAccountId: 'act_111', params })
    const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')

    it('다른 비즈니스로의 adstudy.create는 거부, POST 없음', async () => {
      fetchMock.mockResolvedValueOnce(ok({ business: { id: '680' } }))
      await expect(run({ business_id: '999', name: 'ab' })).rejects.toThrow('비즈니스가 아닙니다')
      expect(posts()).toHaveLength(0)
    })

    it('다른 계정의 광고세트가 cells에 있으면 거부, POST 없음', async () => {
      fetchMock
        .mockResolvedValueOnce(ok({ business: { id: '680' } }))
        .mockResolvedValueOnce(ok({ account_id: '999' }))
      await expect(
        run({ business_id: '680', cells: [{ name: 'A', adsets: ['55'] }] })
      ).rejects.toThrow('이 Space의 광고 계정에 속하지 않는 객체입니다')
      expect(posts()).toHaveLength(0)
    })

    it('cells에 허용하지 않는 키(adaccounts 등)가 있으면 거부, POST 없음', async () => {
      fetchMock.mockResolvedValueOnce(ok({ business: { id: '680' } }))
      await expect(
        run({ business_id: '680', cells: [{ name: 'A', adaccounts: ['222'] }] })
      ).rejects.toThrow('cells에 허용하지 않는 키입니다: adaccounts')
      expect(posts()).toHaveLength(0)
    })

    it('adstudy.update: 스터디의 비즈니스가 다르면 거부', async () => {
      fetchMock
        .mockResolvedValueOnce(ok({ business: { id: '680' } }))
        .mockResolvedValueOnce(ok({ business: { id: '777' } }))
      await expect(run({ study_id: '9', name: 'x' }, 'meta-ads.adstudy.update')).rejects.toThrow(
        '비즈니스가 아닙니다'
      )
      expect(posts()).toHaveLength(0)
    })

    it('같은 비즈니스·같은 계정 cells → business_id 없이 /{business}/ad_studies로 POST', async () => {
      fetchMock
        .mockResolvedValueOnce(ok({ business: { id: '680' } }))
        .mockResolvedValueOnce(ok({ account_id: '111' }))
        .mockResolvedValueOnce(ok({ id: 'study1' }))
      const cells = [{ name: 'A', adsets: ['55'] }]
      await expect(run({ business_id: '680', name: 'ab', cells })).resolves.toEqual({
        id: 'study1',
      })
      const [[url, init]] = posts()
      expect(new URL(url).pathname).toBe('/v26.0/680/ad_studies')
      const body = init.body as URLSearchParams
      expect(body.has('business_id')).toBe(false)
      expect(body.get('cells')).toBe(JSON.stringify(cells))
    })
  })

  it('fetchAdAccountCurrencies: 매핑된 계정마다 Graph로 통화를 확인한다', async () => {
    fetchMock.mockImplementation(async (u: string | URL) =>
      ok({
        id: new URL(String(u)).pathname.split('/')[2],
        currency: String(u).includes('act_222') ? 'USD' : 'KRW',
      })
    )
    await expect(
      fetchAdAccountCurrencies({ accessToken: 'token', appSecret: 'secret' }, CONFIG)
    ).resolves.toEqual({
      act_111: 'KRW',
      act_222: 'USD',
    })
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('fields')).toBe('currency')
  })

  it('fetchAdAccountCurrencies: 계정 하나라도 확인 실패면 throw', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Unsupported get request' } }),
    })
    await expect(
      fetchAdAccountCurrencies({ accessToken: 'token', appSecret: 'secret' }, CONFIG)
    ).rejects.toThrow('Unsupported get request')
  })
})
