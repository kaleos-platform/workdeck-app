/** @jest-environment node */
import { GoogleOAuthError } from '@/lib/agent/integrations/google-marketing'
import {
  activeEnhancedKeys,
  fetchEnhancedMeasurement,
  fetchFunnelSummary,
  fetchMeasurementId,
  loadGa4Bundle,
} from '../platform-ga4'

jest.mock('server-only', () => ({}))
jest.mock('@/lib/admin/platform-google', () => ({ readPlatformGoogle: jest.fn() }))

const fetchMock = jest.fn()
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = fetchMock as unknown as typeof fetch
})

test('향상된 측정: v1alpha 경로·필드 파싱, 없는 필드는 null(알 수 없음)', async () => {
  fetchMock.mockResolvedValueOnce(
    ok({
      name: 'x',
      streamEnabled: true,
      scrollsEnabled: false,
      pageChangesEnabled: 'yes', // true 가 아니면 꺼짐
      searchQueryParameter: 'q',
    })
  )
  const r = await fetchEnhancedMeasurement('tok', '412345678', '9876543210')
  expect(fetchMock.mock.calls[0][0]).toBe(
    'https://analyticsadmin.googleapis.com/v1alpha/properties/412345678/dataStreams/9876543210/enhancedMeasurementSettings'
  )
  expect(r.streamEnabled).toBe(true)
  expect(r.scrollsEnabled).toBe(false)
  expect(r.pageChangesEnabled).toBe(false)
  expect(r.fileDownloadsEnabled).toBe(false) // proto3 JSON 은 false 를 생략 → 없음 = 꺼짐
})

test('activeEnhancedKeys: 전체 스위치가 꺼지면 하위 값이 켜져 있어도 빈 목록', () => {
  const sub = {
    pageChangesEnabled: true,
    scrollsEnabled: true,
    outboundClicksEnabled: true,
    siteSearchEnabled: false,
    formInteractionsEnabled: false,
    videoEngagementEnabled: true,
    fileDownloadsEnabled: true,
  }
  expect(activeEnhancedKeys({ streamEnabled: false, ...sub })).toEqual([])
  expect(activeEnhancedKeys({ streamEnabled: true, ...sub })).toEqual(
    expect.arrayContaining(['streamEnabled', 'pageChangesEnabled', 'scrollsEnabled'])
  )
})

test('측정 ID: v1beta webStreamData.measurementId', async () => {
  fetchMock.mockResolvedValueOnce(ok({ webStreamData: { measurementId: 'G-5F8G9Y4VHW' } }))
  expect(await fetchMeasurementId('tok', '1', '2')).toBe('G-5F8G9Y4VHW')
  expect(fetchMock.mock.calls[0][0]).toBe(
    'https://analyticsadmin.googleapis.com/v1beta/properties/1/dataStreams/2'
  )
  fetchMock.mockResolvedValueOnce(ok({}))
  expect(await fetchMeasurementId('tok', '1', '2')).toBeNull()
})

test('퍼널: runReport 응답을 이벤트 합계·유입 상위로 파싱한다', async () => {
  fetchMock
    .mockResolvedValueOnce(
      ok({
        rows: [
          { dimensionValues: [{ value: 'page_view' }], metricValues: [{ value: '120' }] },
          { dimensionValues: [{ value: 'sign_up' }], metricValues: [{ value: '5' }] },
          { dimensionValues: [{ value: 'other' }], metricValues: [{ value: '9' }] },
        ],
      })
    )
    .mockResolvedValueOnce(
      ok({
        rows: [
          {
            dimensionValues: [{ value: 'google' }, { value: 'cpc' }, { value: 'sign_up' }],
            metricValues: [{ value: '3' }],
          },
          {
            dimensionValues: [{ value: 'google' }, { value: 'cpc' }, { value: 'subscribe' }],
            metricValues: [{ value: '1' }],
          },
          {
            dimensionValues: [{ value: '(direct)' }, { value: '(none)' }, { value: 'sign_up' }],
            metricValues: [{ value: '1' }],
          },
        ],
      })
    )
  const f = await fetchFunnelSummary('tok', '412345678')
  expect(fetchMock.mock.calls[0][0]).toBe(
    'https://analyticsdata.googleapis.com/v1beta/properties/412345678:runReport'
  )
  expect(f.events.page_view).toBe(120)
  expect(f.events.sign_up).toBe(5)
  expect(f.events.subscribe).toBe(0)
  expect(f.sources[0]).toEqual({ source: 'google', medium: 'cpc', signUp: 3, subscribe: 1 })
  expect(f.sources).toHaveLength(2)
})

test('rows 가 없는 빈 응답도 0 으로 처리한다', async () => {
  fetchMock.mockImplementation(async () => ok({}))
  const f = await fetchFunnelSummary('tok', '1')
  expect(f.events.page_view).toBe(0)
  expect(f.sources).toEqual([])
})

test('오류는 단계·상태·허용 코드만 — 응답 본문·토큰은 메시지에 없다', async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ error: { message: 'SECRET-BODY ya29.token' } }), { status: 403 })
  )
  const err = await fetchEnhancedMeasurement('ya29.token', '1', '2').catch((e) => e)
  expect(err).toBeInstanceOf(GoogleOAuthError)
  expect(err.message).toContain('HTTP 403')
  expect(err.message).toContain('forbidden')
  expect(err.message).not.toContain('SECRET-BODY')
  expect(err.message).not.toContain('ya29')
})

test('loadGa4Bundle: 토큰 갱신 실패 시 한 줄 오류만 모으고 비밀값은 없다', async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'LEAK' }), {
      status: 400,
    })
  )
  const b = await loadGa4Bundle({
    id: 'r',
    lastError: null,
    secret: { clientId: 'c', clientSecret: 'TOPSECRET', refreshToken: 'REFRESH' },
    config: { propertyId: '1', streamId: '2', status: 'connected', credVersion: 1 },
  })
  expect(b.errors).toHaveLength(1)
  expect(JSON.stringify(b)).not.toMatch(/LEAK|TOPSECRET|REFRESH/)
  expect(b.errors[0]).toContain('invalid_grant')
})
