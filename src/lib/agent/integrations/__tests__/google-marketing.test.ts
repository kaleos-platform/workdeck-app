/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({
  prisma: { spaceCredential: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) } },
}))
jest.mock('@/lib/crypto/field-crypto', () => ({
  decryptField: jest.fn((_p: string, v: string) => v),
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
import { maskSecrets } from '@/lib/agent/audit'
import {
  GOOGLE_ACTIONS,
  GTM_BASE,
  assertPathInTarget,
  resolveBrand,
  sanitizeGoogleResponse,
  targetUrl,
  validateGa4RunReportRequest,
  validateGoogleAction,
} from '../google-marketing'
import { googleMarketingTools } from '@/lib/agent/tools/google-marketing-tools'
import { googleMarketingActions } from '@/lib/agent/actions/google-marketing'
import { toolDefinitions } from '@/lib/agent/tools'
import { getActionDefinition } from '@/lib/agent/actions/registry'
import type { McpToolContext } from '@/lib/agent/tools/types'
import type { ActionExecContext } from '@/lib/agent/actions/types'

const CONFIG = {
  defaultBrand: 'brand-a',
  brands: { 'brand-a': { ga4_property_id: '111', gtm_account_id: '222', gtm_container_id: '333' } },
}
const TARGET = { brand: 'brand-a', ...CONFIG.brands['brand-a'] }
const ctx = (): McpToolContext => ({
  spaceId: 'sp1',
  actor: { type: 'agent', id: 'agent-1' },
  scopes: ['google:read', 'google:write'],
  workId: 'wk',
  requesterUserId: null,
  requesterSlackUserId: null,
  decryptedCredentialIds: [],
})
const tool = (n: string) => googleMarketingTools.find((t) => t.name === n)!
const action = (t: string) =>
  googleMarketingActions.find((a) => a.actionType === `google-marketing.${t}`)!
const execCtx = (): ActionExecContext => ({
  spaceId: 'sp1',
  actor: { type: 'agent', id: 'agent-1' },
  requesterUserId: null,
  workId: 'wk',
  deciderId: 'u1',
  actionId: 'a1',
  decryptedCredentialIds: [],
})
const credRow = (config: object) => ({
  id: 'gcred',
  encryptedPayload: JSON.stringify({ clientId: 'cid', clientSecret: 'cs', refreshToken: 'rt' }),
  iv: 'iv-opaque',
  config,
})
// 같은 OAuth 토큰으로 접근할 수 있는 다른 컨테이너(999)로 빠지는 우회 경로들
const ESCAPES = [
  'accounts/222/containers/333/%2e%2e/999/workspaces',
  'accounts/222/containers/333/%2E%2E%2F999',
  'accounts/222/containers/333/..%2f..%2f999',
  'accounts/222/containers/333/../../999',
  'accounts/222/containers/333/./workspaces',
  'accounts/222/containers/333/workspaces?x=1',
  'accounts/222/containers/333/workspaces#frag',
  'accounts/222/containers/333\\..\\999',
  'accounts/222/containers/333//workspaces',
]
let fetchMock: jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  ;(prisma.spaceCredential.findUnique as jest.Mock).mockResolvedValue(credRow(CONFIG))
  fetchMock = jest.fn(async (url: string | URL) =>
    String(url).includes('oauth2.googleapis.com')
      ? { ok: true, json: async () => ({ access_token: 'at' }) }
      : { ok: true, json: async () => ({ rows: [] }) }
  )
  global.fetch = fetchMock as unknown as typeof fetch
})

describe('google-marketing (포팅)', () => {
  it('원본 ACTIONS 16개를 모두 옮겼다', () => expect(Object.keys(GOOGLE_ACTIONS)).toHaveLength(16))
  it('resolveBrand requires known brand and required IDs', () => {
    expect(resolveBrand(CONFIG, 'brand-a')).toEqual(TARGET)
    expect(resolveBrand(CONFIG)).toEqual(TARGET)
    expect(() => resolveBrand(CONFIG, 'x')).toThrow('알 수 없는 구글 마케팅 브랜드: x')
    expect(() => resolveBrand(CONFIG, 'constructor')).toThrow('알 수 없는 구글 마케팅 브랜드')
    expect(() =>
      resolveBrand(
        { brands: { b: { ga4_property_id: '1', gtm_account_id: '', gtm_container_id: '3' } } },
        'b'
      )
    ).toThrow('gtm_account_id')
    expect(() =>
      resolveBrand(
        { brands: { b: { ga4_property_id: '1|.*', gtm_account_id: '2', gtm_container_id: '3' } } },
        'b'
      )
    ).toThrow('ga4_property_id')
  })
  it('validateGoogleAction rejects unsupported write actions', () => {
    expect(() => validateGoogleAction({ action: 'ga4.property.delete', params: {} })).toThrow(
      '지원하지 않는 구글 마케팅 액션'
    )
  })
  it('validateGoogleAction: 허용 목록 밖·예약 키·문자열 아닌 경로·범위 밖 updateMask 거부', () => {
    const v = (a: string, params: object) => () => validateGoogleAction({ action: a, params })
    expect(v('gtm.tag.update', { path: 'x', name: 't', foo: 1 })).toThrow(
      '허용하지 않는 파라미터입니다: foo'
    )
    expect(v('gtm.tag.update', { path: 'x', Access_Token: 'a' })).toThrow('예약된 파라미터')
    expect(v('gtm.tag.update', { path: 'x', $xgafv: '1' })).toThrow('예약된 파라미터')
    expect(v('gtm.tag.update', { path: ['accounts/222'] })).toThrow('경로 문자열이어야')
    expect(v('ga4.key_event.patch', { name: 'x', updateMask: 'countingMethod' })).not.toThrow()
    expect(v('ga4.key_event.patch', { name: 'x', updateMask: 'displayName' })).toThrow('updateMask')
    expect(
      v('ga4.data_stream.patch', { name: 'x', updateMask: 'webStreamData.defaultUri' })
    ).not.toThrow()
  })
  it('validateGa4RunReportRequest rejects common invalid report fields', () => {
    expect(() => validateGa4RunReportRequest({ dimensions: [{ name: 'dateRange' }] })).toThrow(
      'dateRange'
    )
    expect(() => validateGa4RunReportRequest({ metrics: [{ name: 'purchases' }] })).toThrow(
      'ecommercePurchases'
    )
    expect(() => validateGa4RunReportRequest({ property: 'properties/999' })).toThrow('property')
  })
  it('sanitizeGoogleResponse redacts credential-bearing values', () => {
    expect(
      sanitizeGoogleResponse({ next: 'https://x?access_token=a', refresh_token: 'r' })
    ).toEqual({
      next: '[redacted]',
      refresh_token: '[redacted]',
    })
    expect(sanitizeGoogleResponse({ secretValue: 's', nextPageToken: 'p' })).toEqual({
      secretValue: '[redacted]',
      nextPageToken: 'p',
    })
  })
  it('maskSecrets가 Google 토큰·시크릿 모양을 가린다', () => {
    const s = maskSecrets(
      'a ya29.A0Abc-def_1 b 1//0eXyz-abcdefghij c GOCSPX-abcDEF_12 d -----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY----- e'
    )
    expect(s).not.toMatch(/ya29|1\/\/0e|GOCSPX|MIIabc/)
    expect(s).toContain(' e')
  })
  it('MCP 도구는 조회 3 + 제안 1, 전체 목록·레지스트리에 등록', () => {
    expect(googleMarketingTools.map((t) => t.name)).toEqual([
      'google_marketing_ga4_run_report',
      'google_marketing_ga4_admin_get',
      'google_marketing_gtm_get',
      'google_marketing_propose_action',
    ])
    expect(toolDefinitions.filter((t) => t.name.startsWith('google_marketing_'))).toHaveLength(4)
    expect(getActionDefinition('google-marketing.gtm.version.publish')?.requiredRole).toBe('OWNER')
    expect(getActionDefinition('google-marketing.gtm.tag.update')?.requiredRole).toBe('ADMIN')
    expect(googleMarketingActions.every((a) => a.spendKrw === undefined)).toBe(true)
  })
  it('admin/gtm 경로는 브랜드 속성·컨테이너 밖이면 거부(Space 경계)', () => {
    expect(() =>
      assertPathInTarget('/v1beta/properties/111/dataStreams', TARGET, 'ga4-admin')
    ).not.toThrow()
    expect(() =>
      assertPathInTarget('/v1beta/properties/999/dataStreams', TARGET, 'ga4-admin')
    ).toThrow('이 브랜드의 GA4 속성 경로가 아닙니다')
    expect(() => assertPathInTarget('/v1beta/properties/1110', TARGET, 'ga4-admin')).toThrow()
    expect(() => assertPathInTarget('/v1beta/accounts', TARGET, 'ga4-admin')).toThrow()
    expect(() =>
      assertPathInTarget('/accounts/222/containers/333/workspaces', TARGET, 'gtm')
    ).not.toThrow()
    expect(() =>
      assertPathInTarget('/accounts/222/containers/444/workspaces', TARGET, 'gtm')
    ).toThrow('이 브랜드의 GTM 컨테이너 경로가 아닙니다')
    expect(() =>
      assertPathInTarget('/accounts/222/containers/333/../../999', TARGET, 'gtm')
    ).toThrow()
  })
  it.each(ESCAPES)('encoded separator·dot segment·query·fragment 우회 거부: %s', (path) => {
    expect(() => targetUrl(GTM_BASE, path, TARGET, 'gtm')).toThrow()
  })
  it('targetUrl은 정규화된 최종 pathname이 브랜드 컨테이너 아래인 URL만 돌려준다', () => {
    expect(
      targetUrl(GTM_BASE, '/accounts/222/containers/333/workspaces', TARGET, 'gtm').pathname
    ).toBe('/tagmanager/v2/accounts/222/containers/333/workspaces')
  })
  it.each(ESCAPES)('조회 도구 gtm_get 회귀 — %s → 거부, Google API·OAuth 미호출', async (path) => {
    await expect(
      tool('google_marketing_gtm_get').execute(ctx(), { brand: 'brand-a', path })
    ).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('조회 도구 query의 예약 키(access_token·key·fields) 거부, OAuth 미호출', async () => {
    await expect(
      tool('google_marketing_gtm_get').execute(ctx(), {
        path: 'accounts/222/containers/333/workspaces',
        query: { KEY: 'x' },
      })
    ).rejects.toThrow('예약된 파라미터')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it.each(ESCAPES)(
    '승인 실행 회귀 — gtm.tag.update path=%s → 거부, Google API·OAuth 미호출',
    async (path) => {
      await expect(
        action('gtm.tag.update').execute(execCtx(), { target: TARGET, params: { path } })
      ).rejects.toThrow()
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )
  it('run_report는 브랜드 속성의 runReport를 호출하고 자격증명 id를 감사에 남긴다', async () => {
    const c = ctx()
    await tool('google_marketing_ga4_run_report').execute(c, {
      brand: 'brand-a',
      request: { metrics: [{ name: 'sessions' }] },
    })
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      'https://analyticsdata.googleapis.com/v1beta/properties/111:runReport'
    )
    expect(fetchMock.mock.calls[1][1].signal).toBeDefined()
    expect(c.decryptedCredentialIds).toEqual(['gcred'])
  })
  it('propose → 승인 큐, Google API 미호출', async () => {
    await tool('google_marketing_propose_action').execute(ctx(), {
      brand: 'brand-a',
      action: 'gtm.variable.update',
      params: { path: 'accounts/222/containers/333/workspaces/1/variables/9', name: 'v' },
      summary: '변수 수정',
    })
    expect(createPendingAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'google-marketing.gtm.variable.update',
        workId: 'wk',
        params: { target: TARGET, params: expect.any(Object) },
      })
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('제안 params의 path/parent/name도 브랜드 경로·리소스 모양으로 제한', async () => {
    const propose = (a: string, params: object) =>
      tool('google_marketing_propose_action').execute(ctx(), {
        brand: 'brand-a',
        action: a,
        params,
        summary: 'x',
      })
    await expect(
      propose('gtm.tag.update', { path: 'accounts/222/containers/444/workspaces/1/tags/1' })
    ).rejects.toThrow('GTM 컨테이너 경로가 아닙니다')
    // 같은 컨테이너라도 다른 종류의 리소스(태그 업데이트로 변수 덮어쓰기)는 거부
    await expect(
      propose('gtm.tag.update', { path: 'accounts/222/containers/333/workspaces/1/variables/1' })
    ).rejects.toThrow()
    // 키 이벤트 patch로 속성 자체를 바꾸는 경로 거부
    await expect(propose('ga4.key_event.patch', { name: 'properties/111' })).rejects.toThrow(
      'GA4 속성 경로가 아닙니다'
    )
    await expect(
      propose('ga4.key_event.patch', { name: 'properties/999/keyEvents/1' })
    ).rejects.toThrow()
    expect(createPendingAction).not.toHaveBeenCalled()
  })
  it('approved GTM variable update keeps resource name in request body', async () => {
    fetchMock.mockImplementation(async (url: string | URL) =>
      String(url).includes('oauth2')
        ? { ok: true, json: async () => ({ access_token: 'at' }) }
        : { ok: true, json: async () => ({ name: 'v' }) }
    )
    const c = execCtx()
    await action('gtm.variable.update').execute(c, {
      target: TARGET,
      params: {
        path: 'accounts/222/containers/333/workspaces/1/variables/9',
        name: 'v',
        type: 'c',
      },
    })
    const [url, init] = fetchMock.mock.calls[1]
    expect(String(url)).toBe(
      'https://www.googleapis.com/tagmanager/v2/accounts/222/containers/333/workspaces/1/variables/9'
    )
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ name: 'v', type: 'c' })
    expect(c.decryptedCredentialIds).toEqual(['gcred'])
  })
  it('GA4 patch는 updateMask를 쿼리로, name은 본문에서 뺀다', async () => {
    await action('ga4.key_event.patch').execute(execCtx(), {
      target: TARGET,
      params: {
        name: 'properties/111/keyEvents/5',
        countingMethod: 'ONCE_PER_SESSION',
        updateMask: 'countingMethod',
      },
    })
    const [url, init] = fetchMock.mock.calls[1]
    expect(String(url)).toBe(
      'https://analyticsadmin.googleapis.com/v1beta/properties/111/keyEvents/5?updateMask=countingMethod'
    )
    expect(JSON.parse(init.body)).toEqual({ countingMethod: 'ONCE_PER_SESSION' })
  })
  it('failed Google API action → 자격증명 lastError 기록 후 throw', async () => {
    fetchMock.mockImplementation(async (url: string | URL) =>
      String(url).includes('oauth2')
        ? { ok: true, json: async () => ({ access_token: 'at' }) }
        : {
            ok: false,
            status: 403,
            json: async () => ({ error: { message: 'denied ya29.secretTOKEN' } }),
          }
    )
    const err = await action('ga4.custom_dimension.create')
      .execute(execCtx(), { target: TARGET, params: { parameterName: 'p' } })
      .catch((e: Error) => e)
    expect((err as Error).message).toContain('denied')
    expect((err as Error).message).not.toContain('ya29')
    expect(prisma.spaceCredential.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'gcred' } })
    )
  })
  it('fetch 실패 원문(URL·본문)을 노출하지 않는다', async () => {
    fetchMock.mockRejectedValue(new Error('connect failed refresh_token=rt client_secret=cs'))
    await expect(
      tool('google_marketing_ga4_run_report').execute(ctx(), { request: {} })
    ).rejects.toThrow('Google API에 연결하지 못했습니다')
  })
  it('validateCreate: 세션 POST로 들어온 등록 안 된 대상(payload target)을 거부', async () => {
    const forged = { ...TARGET, gtm_container_id: '999' }
    await expect(
      action('gtm.workspace.create').validateCreate!(execCtx(), { target: forged, params: {} })
    ).rejects.toThrow('구글 마케팅 대상 매핑이 바뀌었거나 이 Space에 등록되지 않은 대상입니다')
    await expect(
      action('gtm.workspace.create').validateCreate!(execCtx(), {
        target: { ...TARGET, brand: 'nope' },
        params: {},
      })
    ).rejects.toThrow('구글 마케팅 대상 매핑이 바뀌었거나')
    await expect(
      action('gtm.workspace.create').validateCreate!(execCtx(), {
        target: TARGET,
        params: { foo: 1 },
      })
    ).rejects.toThrow('허용하지 않는 파라미터')
    await expect(
      action('gtm.workspace.create').validateCreate!(execCtx(), { target: TARGET, params: {} })
    ).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('paramsSchema도 허용 목록을 강제한다', () => {
    expect(
      action('gtm.workspace.create').paramsSchema.safeParse({
        target: TARGET,
        params: { name: 'w' },
      }).success
    ).toBe(true)
    expect(
      action('gtm.workspace.create').paramsSchema.safeParse({
        target: TARGET,
        params: { fields: 'x' },
      }).success
    ).toBe(false)
  })
  it('mapping changed → 승인 후 execute 실패, Google API 미호출', async () => {
    ;(prisma.spaceCredential.findUnique as jest.Mock).mockResolvedValue(
      credRow({
        ...CONFIG,
        brands: { 'brand-a': { ...CONFIG.brands['brand-a'], gtm_container_id: '777' } },
      })
    )
    await expect(
      action('gtm.workspace.create').execute(execCtx(), { target: TARGET, params: {} })
    ).rejects.toThrow('구글 마케팅 대상 매핑이 바뀌었거나')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
