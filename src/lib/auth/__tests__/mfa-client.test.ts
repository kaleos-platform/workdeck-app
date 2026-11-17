/** @jest-environment node */
import { toast } from 'sonner'
import { fetchWithMfa, redirectIfMfaRequired } from '../mfa-client'

jest.mock('sonner', () => ({ toast: { error: jest.fn() } }))
const getSession = jest.fn(async () => ({}))
jest.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { getSession } }) }))

const go = jest.fn()
const nav = { currentPath: () => '/settings/integrations?tab=coupang', go }

beforeEach(() => go.mockClear())

test('403 MFA_REQUIRED → 단계 인증 페이지로 이동하고 true', async () => {
  const res = new Response(JSON.stringify({ code: 'MFA_REQUIRED' }), { status: 403 })
  await expect(redirectIfMfaRequired(res, nav)).resolves.toBe(true)
  expect(go).toHaveBeenCalledWith('/auth/mfa?next=%2Fsettings%2Fintegrations%3Ftab%3Dcoupang')
})

test('다른 403·200 은 false, 이동 없음', async () => {
  await expect(redirectIfMfaRequired(new Response('{}', { status: 403 }), nav)).resolves.toBe(false)
  await expect(redirectIfMfaRequired(new Response('{}', { status: 200 }), nav)).resolves.toBe(false)
  expect(go).not.toHaveBeenCalled()
})

test('호출부가 본문을 다시 읽을 수 있다(clone 사용)', async () => {
  const res = new Response(JSON.stringify({ code: 'OTHER' }), { status: 403 })
  await redirectIfMfaRequired(res, nav)
  await expect(res.json()).resolves.toEqual({ code: 'OTHER' })
})

describe('fetchWithMfa', () => {
  const mfaRes = () => Response.json({ code: 'MFA_REQUIRED' }, { status: 403 })
  const okRes = (n = 1) => Response.json({ ok: n })
  const init = { method: 'PATCH', body: '{"a":1}' }
  let fetchMock: jest.Mock

  beforeEach(() => {
    fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
    getSession.mockClear()
    ;(toast.error as jest.Mock).mockClear()
  })

  test('MFA 가 아니면 그대로 통과(fetch 1회)', async () => {
    const stepUp = jest.fn()
    fetchMock.mockResolvedValueOnce(okRes())
    const res = await fetchWithMfa('/api/x', init, { stepUp })
    expect(await res.json()).toEqual({ ok: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(stepUp).not.toHaveBeenCalled()
  })

  test('verified → 같은 인자로 정확히 2회 요청하고 두 번째 응답 반환', async () => {
    fetchMock.mockResolvedValueOnce(mfaRes()).mockResolvedValueOnce(okRes(2))
    const res = await fetchWithMfa('/api/x', init, { stepUp: async () => 'verified' })
    expect(await res.json()).toEqual({ ok: 2 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]).toEqual(fetchMock.mock.calls[0])
    expect(getSession).toHaveBeenCalledTimes(1)
  })

  test('cancelled → MFA_CANCELLED 403 + 토스트, 요청 1회', async () => {
    fetchMock.mockResolvedValueOnce(mfaRes())
    const res = await fetchWithMfa('/api/x', init, { stepUp: async () => 'cancelled' })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'MFA_CANCELLED' })
    expect(toast.error).toHaveBeenCalledWith('2단계 인증을 취소해 저장하지 않았습니다')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('enroll → 원래 MFA_REQUIRED 응답 반환', async () => {
    const original = mfaRes()
    fetchMock.mockResolvedValueOnce(original)
    const res = await fetchWithMfa('/api/x', init, { stepUp: async () => 'enroll' })
    expect(res).toBe(original)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('재전송도 MFA_REQUIRED → MFA_RETRY_FAILED, 루프 없이 2회', async () => {
    fetchMock.mockResolvedValue(mfaRes())
    const res = await fetchWithMfa('/api/x', init, { stepUp: async () => 'verified' })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'MFA_RETRY_FAILED' })
    expect(toast.error).toHaveBeenCalledWith(
      '인증은 완료됐지만 저장하지 못했습니다. 다시 시도해 주세요'
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('동시 2건 → 단계 인증 1회, 재전송은 MFA 받은 순서(첫 재전송이 느려도)', async () => {
    const order: string[] = []
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((r) => (releaseFirst = r))
    const seen = new Set<string>()
    fetchMock.mockImplementation(async (url: string) => {
      if (!seen.has(url)) {
        seen.add(url)
        return mfaRes()
      }
      order.push(`start:${url}`)
      if (url === '/a') await firstGate
      order.push(`end:${url}`)
      return okRes()
    })
    let finishStepUp!: () => void
    const stepUp = jest.fn(
      () => new Promise<'verified'>((r) => (finishStepUp = () => r('verified')))
    )
    const a = fetchWithMfa('/a', init, { stepUp })
    const b = fetchWithMfa('/b', init, { stepUp })
    await new Promise((r) => setTimeout(r, 10))
    finishStepUp()
    await new Promise((r) => setTimeout(r, 10))
    releaseFirst()
    await Promise.all([a, b])
    expect(stepUp).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['start:/a', 'end:/a', 'start:/b', 'end:/b'])
  })

  test('unavailable(인증 정보 조회 실패) → 이동 없이 MFA_UNAVAILABLE, fetch 1회', async () => {
    fetchMock.mockResolvedValueOnce(mfaRes())
    const res = await fetchWithMfa('/api/x', init, { stepUp: async () => 'unavailable' })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('MFA_UNAVAILABLE')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalled()
  })

  test('앞선 재전송이 실패(reject)해도 다음 순번은 진행된다', async () => {
    fetchMock
      .mockResolvedValueOnce(mfaRes())
      .mockResolvedValueOnce(mfaRes())
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(okRes(2))
    const stepUp = async () => 'verified' as const
    const a = fetchWithMfa('/api/a', init, { stepUp })
    const b = fetchWithMfa('/api/b', init, { stepUp })
    await expect(a).rejects.toThrow('network')
    expect(await (await b).json()).toEqual({ ok: 2 })
  })
})
