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

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { createPendingAction } from '@/lib/agent/actions/create'
import { requiredDecisionRole } from '@/lib/agent/actions/decision-policy'
import { summarizeArgs } from '@/lib/agent/audit'
import {
  META_ACTIONS,
  META_BUDGET_ACTIONS,
  META_MONEY_KEYS,
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

  describe('상세 타겟 위치(flexible_spec)', () => {
    const base = { action: 'adset.update', params: { adset_id: '1' } }
    it('최상위 상세 타겟을 거부한다', () => {
      expect(() =>
        validateMetaAction({
          ...base,
          params: { adset_id: '1', targeting: { family_statuses: [{ id: '6023005372383' }] } },
        })
      ).toThrow(/flexible_spec/)
    })
    it('여러 키를 한 번에 알려 준다', () => {
      expect(() =>
        validateMetaAction({
          ...base,
          params: {
            adset_id: '1',
            targeting: { interests: [{ id: '1' }], behaviors: [{ id: '2' }] },
          },
        })
      ).toThrow(/interests, behaviors/)
    })
    it('JSON 문자열 targeting도 같은 규칙으로 거부한다', () => {
      expect(() =>
        validateMetaAction({
          ...base,
          params: { adset_id: '1', targeting: JSON.stringify({ life_events: [{ id: '1' }] }) },
        })
      ).toThrow(/flexible_spec/)
    })
    it('flexible_spec 안의 상세 타겟은 통과한다', () => {
      expect(() =>
        validateMetaAction({
          ...base,
          params: {
            adset_id: '1',
            targeting: {
              geo_locations: { countries: ['KR'] },
              flexible_spec: [{ family_statuses: [{ id: '6023005372383' }] }],
            },
          },
        })
      ).not.toThrow()
    })
    it('adset.create에도 적용된다', () => {
      expect(() =>
        validateMetaAction({
          action: 'adset.create',
          params: { name: 'x', campaign_id: '1', targeting: { income: [{ id: '1' }] } },
        })
      ).toThrow(/flexible_spec/)
    })
  })

  it('파라미터 허용 목록: 상태 액션의 예산 키·모르는 키·예약 키·DELETED 거부', () => {
    const v = (action: string, params: Record<string, unknown>) => () =>
      validateMetaAction({ action, params })
    expect(
      v('campaign.update_status', { campaign_id: '1', status: 'ACTIVE', daily_budget: '999999999' })
    ).toThrow('campaign.update_status에 허용하지 않는 파라미터입니다: daily_budget')
    expect(v('ad.update', { ad_id: '1', daily_budget: '1' })).toThrow('허용하지 않는 파라미터')
    expect(v('campaign.update', { campaign_id: '1', daily_min_spend_target: '1' })).toThrow(
      '허용하지 않는 파라미터'
    )
    for (const key of [
      'method',
      'access_token',
      'appsecret_proof',
      'batch',
      'fields',
      'METHOD',
      '_x',
    ]) {
      expect(
        v('campaign.update_status', { campaign_id: '1', status: 'PAUSED', [key]: 'delete' })
      ).toThrow(`예약된 파라미터는 보낼 수 없습니다: ${key}`)
    }
    expect(v('campaign.update_status', { campaign_id: '1', status: 'DELETED' })).toThrow('status는')
    expect(v('campaign.update_status', { campaign_id: '1', status: ['ACTIVE'] })).toThrow(
      'status는'
    )
    expect(v('campaign.update_status', { campaign_id: ['123'], status: 'PAUSED' })).toThrow(
      '숫자 id'
    )
    expect(v('campaign.update_status', { campaign_id: 123, status: 'PAUSED' })).toThrow('숫자 id')
    expect(v('adstudy.update', { study_id: { id: '9' } })).toThrow('숫자 id')
    expect(v('campaign.update', { campaign_id: '1', name: 'n', spend_cap: '1' })).not.toThrow()
  })

  it('지출 키는 예산 액션의 허용 목록에만 있다', () => {
    for (const [name, spec] of Object.entries(META_ACTIONS)) {
      const hasMoney = spec.keys.some((k) => (META_MONEY_KEYS as readonly string[]).includes(k))
      expect([name, hasMoney]).toEqual([name, META_BUDGET_ACTIONS.has(name as never)])
    }
  })

  it('예산 액션의 spend_cap·bid_amount도 spendKrw에 들어간다', () => {
    const spend = (params: Record<string, unknown>) =>
      action('meta-ads.campaign.update').spendKrw!({ adAccountId: 'act_1', params } as never)
    expect(spend({ campaign_id: '1', spend_cap: '5000000' })).toBe(5000000)
    expect(spend({ campaign_id: '1', daily_budget: '1000', bid_amount: '20000' })).toBe(20000)
  })

  it('제안: 상태 액션에 예산 키 → 거부, method=delete → 거부(승인 큐에 넣지 않음)', async () => {
    const propose = (params: Record<string, unknown>) =>
      tool('meta_ads_propose_action').execute(ctx(), {
        brand: 'brand-a',
        action: 'campaign.update_status',
        params,
        summary: 's',
      })
    await expect(
      propose({ campaign_id: '1', status: 'ACTIVE', daily_budget: '999999999' })
    ).rejects.toThrow('허용하지 않는 파라미터입니다: daily_budget')
    await expect(propose({ campaign_id: '1', status: 'PAUSED', method: 'delete' })).rejects.toThrow(
      '예약된 파라미터는 보낼 수 없습니다: method'
    )
    expect(createPendingAction).not.toHaveBeenCalled()
  })

  it('세션 POST·저장 payload도 허용 목록을 통과해야 한다 — 실패하면 OWNER, validateCreate·execute 거부', async () => {
    ;(prisma.space.findUnique as jest.Mock).mockResolvedValue({ approvalLimitKrw: 100_000 })
    const payload = {
      brand: 'brand-a',
      adAccountId: 'act_111',
      params: { campaign_id: '1', status: 'ACTIVE', daily_budget: '999999999' },
    }
    await expect(
      requiredDecisionRole(
        { spaceId: 'sp1', actionType: 'meta-ads.campaign.update_status', payload },
        'approve'
      )
    ).resolves.toBe('OWNER')
    const def = action('meta-ads.campaign.update_status')
    await expect(def.validateCreate!(execCtx(), payload)).rejects.toThrow('허용하지 않는 파라미터')
    await expect(def.execute(execCtx(), payload)).rejects.toThrow('허용하지 않는 파라미터')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Graph 호출에 15초 타임아웃을 건다, 시간 초과는 URL 없이 사용자 오류', async () => {
    await tool('meta_ads_list_campaigns').execute(ctx(), {})
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
    fetchMock.mockRejectedValueOnce(
      Object.assign(new Error('https://graph?access_token=SECRET'), { name: 'TimeoutError' })
    )
    const p = tool('meta_ads_list_campaigns').execute(ctx(), {})
    await expect(p).rejects.toThrow('Meta API 응답이 없습니다(시간 초과)')
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

  it('MCP 도구는 조회 7 + 제안 1 — 승인·실행 도구는 노출하지 않는다', () => {
    expect(metaAdsTools.map((t) => t.name)).toEqual([
      'meta_ads_list_campaigns',
      'meta_ads_list_ads',
      'meta_ads_get_insights',
      'meta_ads_get_object',
      'meta_ads_list_videos',
      'meta_ads_list_activities',
      'meta_ads_propose_action',
      'meta_ads_list_actions',
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

  describe('get_insights 확장', () => {
    const schema = () => z.object(tool('meta_ads_get_insights').inputSchema)
    const lastUrl = () => new URL(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0])

    it('기본값은 그대로(last_30d·campaign)', async () => {
      await tool('meta_ads_get_insights').execute(ctx(), { brand: 'brand-a' })
      const u = lastUrl()
      expect(u.pathname).toBe('/v26.0/act_111/insights')
      expect(u.searchParams.get('date_preset')).toBe('last_30d')
      expect(u.searchParams.get('level')).toBe('campaign')
      expect(u.searchParams.has('time_range')).toBe(false)
    })

    it('time_range를 주면 date_preset 없이 since/until JSON으로 보낸다', async () => {
      await tool('meta_ads_get_insights').execute(ctx(), {
        brand: 'brand-a',
        time_range: { since: '2026-10-13', until: '2026-10-17' },
      })
      const u = lastUrl()
      expect(JSON.parse(u.searchParams.get('time_range')!)).toEqual({
        since: '2026-10-13',
        until: '2026-10-17',
      })
      expect(u.searchParams.has('date_preset')).toBe(false)
    })

    it('time_range와 date_preset을 같이 주면 거부한다', async () => {
      await expect(
        tool('meta_ads_get_insights').execute(ctx(), {
          brand: 'brand-a',
          date_preset: 'last_7d',
          time_range: { since: '2026-10-13', until: '2026-10-17' },
        })
      ).rejects.toBeInstanceOf(ToolUserError)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('since가 until보다 늦으면 거부한다', async () => {
      await expect(
        tool('meta_ads_get_insights').execute(ctx(), {
          brand: 'brand-a',
          time_range: { since: '2026-10-17', until: '2026-10-13' },
        })
      ).rejects.toThrow(/since/)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('다음 페이지 커서는 응답에 남고 토큰 포함 next URL은 가린다', async () => {
      fetchMock.mockResolvedValueOnce(
        ok({
          data: [],
          paging: {
            cursors: { after: 'QVFIUnext' },
            next: 'https://graph.facebook.com/v26.0/act_111/insights?access_token=t&after=QVFIUnext',
          },
        })
      )
      const r = (await tool('meta_ads_get_insights').execute(ctx(), { brand: 'brand-a' })) as {
        paging: { cursors: { after: string }; next: string }
      }
      expect(r.paging.cursors.after).toBe('QVFIUnext')
      expect(r.paging.next).toBe('[redacted]')
    })

    it('breakdowns·time_increment·after를 전달한다', async () => {
      await tool('meta_ads_get_insights').execute(ctx(), {
        brand: 'brand-a',
        level: 'ad',
        breakdowns: ['age', 'publisher_platform'],
        time_increment: 1,
        after: 'QVFIUcursor',
      })
      const u = lastUrl()
      expect(u.searchParams.get('breakdowns')).toBe('age,publisher_platform')
      expect(u.searchParams.get('time_increment')).toBe('1')
      expect(u.searchParams.get('after')).toBe('QVFIUcursor')
    })

    it('스키마: 허용 밖 breakdown·날짜 형식·4개 이상 breakdown은 거부', () => {
      expect(schema().safeParse({ breakdowns: ['region'] }).success).toBe(false)
      expect(
        schema().safeParse({
          breakdowns: ['age', 'gender', 'publisher_platform', 'platform_position'],
        }).success
      ).toBe(false)
      expect(
        schema().safeParse({ time_range: { since: '2026/10/13', until: '2026-10-17' } }).success
      ).toBe(false)
      expect(schema().safeParse({ time_increment: 'weekly' }).success).toBe(false)
      expect(
        schema().safeParse({
          time_increment: 'monthly',
          breakdowns: ['age', 'gender'],
        }).success
      ).toBe(true)
    })
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

  it('실행 전 소속 확인 GET 실패도 자격증명 lastError에 기록한다, 경계 거부는 기록하지 않는다', async () => {
    ;(prisma.spaceCredential.update as jest.Mock).mockResolvedValue({})
    const run = () =>
      action('meta-ads.campaign.update_status').execute(execCtx(), {
        brand: 'brand-a',
        adAccountId: 'act_111',
        params: { campaign_id: '123', status: 'PAUSED' },
      })
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Session expired' } }),
    })
    await expect(run()).rejects.toThrow('Session expired')
    expect(prisma.spaceCredential.update).toHaveBeenCalledWith({
      where: { id: 'cred1' },
      data: { lastError: 'Session expired' },
    })
    ;(prisma.spaceCredential.update as jest.Mock).mockClear()
    fetchMock.mockResolvedValueOnce(ok({ account_id: '999' }))
    await expect(run()).rejects.toThrow('속하지 않는 객체')
    expect(prisma.spaceCredential.update).not.toHaveBeenCalled()
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

    it('광고 계정 비즈니스를 확인할 수 없으면 명확한 문구로 거부', async () => {
      fetchMock.mockResolvedValueOnce(ok({ id: 'act_111' }))
      await expect(run({ business_id: '680' })).rejects.toThrow(
        '광고 계정의 비즈니스를 확인할 수 없어 실행하지 않았습니다'
      )
      expect(posts()).toHaveLength(0)
    })

    it('adstudy.update: 같은 비즈니스라도 기존 study의 cells가 다른 계정 소속이면 거부(cells 없는 update 포함)', async () => {
      fetchMock
        .mockResolvedValueOnce(ok({ business: { id: '680' } }))
        .mockResolvedValueOnce(
          ok({
            business: { id: '680' },
            cells: { data: [{ id: 'c1', adsets: { data: [{ id: '77' }] } }] },
          })
        )
        .mockResolvedValueOnce(ok({ account_id: '999' }))
      await expect(
        run({ study_id: '9', end_time: '2026-11-01' }, 'meta-ads.adstudy.update')
      ).rejects.toThrow('이 Space의 광고 계정에 속하지 않는 객체입니다')
      expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('fields')).toMatch(
        /^business,cells/
      )
      expect(posts()).toHaveLength(0)
    })

    it.each([
      [
        '다른 계정의 adaccounts 셀',
        { id: 'c1', adaccounts: { data: [{ id: 'act_222' }] } },
        '속하지 않는 객체',
      ],
      ['대상이 없는 셀', { id: 'c1' }, '대상(광고세트·캠페인·광고 계정)이 없는 셀'],
      [
        '빈 목록뿐인 셀',
        { id: 'c1', adsets: { data: [] } },
        '대상(광고세트·캠페인·광고 계정)이 없는 셀',
      ],
    ])('adstudy.update: 기존 study에 %s → 거부, POST 없음', async (_l, cell, msg) => {
      fetchMock
        .mockResolvedValueOnce(ok({ business: { id: '680' } }))
        .mockResolvedValueOnce(ok({ business: { id: '680' }, cells: { data: [cell] } }))
      await expect(run({ study_id: '9', name: 'x' }, 'meta-ads.adstudy.update')).rejects.toThrow(
        msg
      )
      expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('fields')).toContain(
        'adaccounts.limit(500){id}'
      )
      expect(posts()).toHaveLength(0)
    })

    it('adstudy.update: 같은 계정 adaccounts 셀은 통과', async () => {
      fetchMock
        .mockResolvedValueOnce(ok({ business: { id: '680' } }))
        .mockResolvedValueOnce(
          ok({
            business: { id: '680' },
            cells: { data: [{ id: 'c1', adaccounts: { data: [{ id: 'act_111' }] } }] },
          })
        )
        .mockResolvedValueOnce(ok({ success: true }))
      await expect(run({ study_id: '9', name: 'x' }, 'meta-ads.adstudy.update')).resolves.toEqual({
        success: true,
      })
    })

    it('adstudy.update: 기존 cells를 확인할 수 없으면(없음·다음 페이지) 거부', async () => {
      for (const study of [
        { business: { id: '680' } },
        { business: { id: '680' }, cells: { data: [], paging: { next: 'n' } } },
      ]) {
        fetchMock
          .mockResolvedValueOnce(ok({ business: { id: '680' } }))
          .mockResolvedValueOnce(ok(study))
        await expect(run({ study_id: '9', name: 'x' }, 'meta-ads.adstudy.update')).rejects.toThrow(
          '기존 A/B 테스트의 cells를 확인할 수 없어'
        )
      }
      expect(posts()).toHaveLength(0)
    })

    it('adstudy.update: 기존 cells가 모두 Space 계정 소속이면 study_id 없이 POST', async () => {
      fetchMock
        .mockResolvedValueOnce(ok({ business: { id: '680' } }))
        .mockResolvedValueOnce(
          ok({
            business: { id: '680' },
            cells: { data: [{ id: 'c1', campaigns: { data: [{ id: '5' }] } }] },
          })
        )
        .mockResolvedValueOnce(ok({ account_id: '111' }))
        .mockResolvedValueOnce(ok({ success: true }))
      await expect(run({ study_id: '9', name: 'x' }, 'meta-ads.adstudy.update')).resolves.toEqual({
        success: true,
      })
      const [[url, init]] = posts()
      expect(new URL(url).pathname).toBe('/v26.0/9')
      expect((init.body as URLSearchParams).has('study_id')).toBe(false)
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

describe('PR4 객체·영상·활동 조회', () => {
  const urls = () => fetchMock.mock.calls.map((c) => new URL(c[0]))

  it('get_object(adset): 계정 소속 확인 후 고정 필드로 조회', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ account_id: '111' }))
      .mockResolvedValueOnce(ok({ id: '5' }))
    await tool('meta_ads_get_object').execute(ctx(), {
      brand: 'brand-a',
      type: 'adset',
      object_id: '5',
    })
    const [check, get] = urls()
    expect(check.pathname).toBe('/v26.0/5')
    expect(check.searchParams.get('fields')).toBe('account_id')
    expect(get.pathname).toBe('/v26.0/5')
    expect(get.searchParams.get('fields')).toMatch(/targeting.*daily_budget.*issues_info/)
  })

  it('get_object: 다른 계정 객체는 상세를 조회하지 않고 거부', async () => {
    fetchMock.mockResolvedValueOnce(ok({ account_id: '999' }))
    await expect(
      tool('meta_ads_get_object').execute(ctx(), { brand: 'brand-a', type: 'ad', object_id: '7' })
    ).rejects.toThrow('이 Space의 광고 계정에 속하지 않는 객체입니다')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('get_object(adstudy): 비즈니스가 다르면 거부', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ business: { id: 'b1' } }))
      .mockResolvedValueOnce(ok({ business: { id: 'b2' }, cells: { data: [] } }))
    await expect(
      tool('meta_ads_get_object').execute(ctx(), {
        brand: 'brand-a',
        type: 'adstudy',
        object_id: '9',
      })
    ).rejects.toThrow('이 Space 광고 계정의 비즈니스가 아닙니다')
  })

  it('get_object: object_id 는 숫자만, type 은 정해진 값만', () => {
    const schema = z.object(tool('meta_ads_get_object').inputSchema)
    expect(schema.safeParse({ type: 'adset', object_id: '../me' }).success).toBe(false)
    expect(schema.safeParse({ type: 'campaign', object_id: '1' }).success).toBe(false)
  })

  it('list_videos: 브랜드 계정 advideos, 썸네일 포함, after 전달', async () => {
    await tool('meta_ads_list_videos').execute(ctx(), { brand: 'brand-b', after: 'CUR' })
    const u = urls()[0]
    expect(u.pathname).toBe('/v26.0/act_222/advideos')
    expect(u.searchParams.get('fields')).toMatch(/thumbnails\{/)
    expect(u.searchParams.get('after')).toBe('CUR')
    expect(u.searchParams.get('limit')).toBe('25')
  })

  it('list_activities: 계정 activities, since·until 전달, 날짜 형식 검사', async () => {
    await tool('meta_ads_list_activities').execute(ctx(), {
      brand: 'brand-a',
      since: '2026-10-13',
      until: '2026-10-17',
    })
    const u = urls()[0]
    expect(u.pathname).toBe('/v26.0/act_111/activities')
    expect(u.searchParams.get('since')).toBe('2026-10-13')
    expect(u.searchParams.get('until')).toBe('2026-10-17')
    const schema = z.object(tool('meta_ads_list_activities').inputSchema)
    expect(schema.safeParse({ since: '2026/10/13' }).success).toBe(false)
  })

  it('list_activities: since 가 until 보다 늦으면 거부', async () => {
    await expect(
      tool('meta_ads_list_activities').execute(ctx(), { since: '2026-10-18', until: '2026-10-17' })
    ).rejects.toThrow('since는 until보다 늦을 수 없습니다')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('get_object(creative): account_id 로 소속 확인', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ account_id: '111' }))
      .mockResolvedValueOnce(ok({ id: '8' }))
    await tool('meta_ads_get_object').execute(ctx(), {
      brand: 'brand-a',
      type: 'creative',
      object_id: '8',
    })
    expect(urls()[1].searchParams.get('fields')).toMatch(/object_story_spec/)
  })

  it('새 도구는 모두 read·meta:read', () => {
    for (const n of ['meta_ads_get_object', 'meta_ads_list_videos', 'meta_ads_list_activities']) {
      expect(tool(n).mode).toBe('read')
      expect(tool(n).scope).toBe('meta:read')
    }
  })
})
