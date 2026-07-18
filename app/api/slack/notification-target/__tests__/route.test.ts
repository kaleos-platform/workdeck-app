/**
 * @jest-environment node
 *
 * /api/slack/notification-target 라우트 계약 검증(워커가 { target, notifyEnabled }에 의존).
 * 워커 인증·리졸버는 mock — deckKey 유무에 따른 notifyEnabled 분기만 본다.
 */
import { NextRequest } from 'next/server'
import { GET } from '../route'

const resolveWorkerAuth = jest.fn()
const resolveSlackNotificationTarget = jest.fn()
const resolveDeckNotifyEnabled = jest.fn()

jest.mock('@/lib/api-helpers', () => {
  const actual = jest.requireActual('@/lib/api-helpers')
  return {
    ...actual,
    resolveWorkerAuth: (...a: unknown[]) => resolveWorkerAuth(...a),
  }
})
jest.mock('@/lib/slack/notification-target', () => ({
  resolveSlackNotificationTarget: (...a: unknown[]) => resolveSlackNotificationTarget(...a),
  resolveDeckNotifyEnabled: (...a: unknown[]) => resolveDeckNotifyEnabled(...a),
}))

// 라우트 핸들러 반환 타입이 추론상 `Response | undefined`라 응답을 좁혀 반환한다.
async function callGet(qs: string) {
  const res = await GET(new NextRequest(`http://localhost/api/slack/notification-target${qs}`))
  if (!res) throw new Error('라우트가 응답을 반환하지 않았습니다')
  return res
}

describe('GET /api/slack/notification-target', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resolveWorkerAuth.mockReturnValue({ authenticated: true })
    resolveSlackNotificationTarget.mockResolvedValue({ channelId: 'C1' })
  })

  it('워커 인증 실패면 그대로 반환', async () => {
    const err = { error: new Response('nope', { status: 401 }) }
    resolveWorkerAuth.mockReturnValue(err)
    const res = await callGet('?workspaceId=ws1')
    expect(res.status).toBe(401)
  })

  it('workspaceId 누락이면 400', async () => {
    const res = await callGet('')
    expect(res.status).toBe(400)
  })

  it('deckKey 미지정이면 notifyEnabled=true, 토글 조회 안 함', async () => {
    const res = await callGet('?workspaceId=ws1')
    const body = await res.json()

    expect(body).toEqual({ target: { channelId: 'C1' }, notifyEnabled: true })
    expect(resolveDeckNotifyEnabled).not.toHaveBeenCalled()
  })

  it('deckKey 주어지면 토글 조회 결과를 notifyEnabled로 반환(eventKey 미지정)', async () => {
    resolveDeckNotifyEnabled.mockResolvedValue(false)

    const res = await callGet('?workspaceId=ws1&deckKey=seller-hub')
    const body = await res.json()

    expect(body).toEqual({ target: { channelId: 'C1' }, notifyEnabled: false })
    expect(resolveDeckNotifyEnabled).toHaveBeenCalledWith('ws1', 'seller-hub', undefined)
  })

  it('eventKey까지 주어지면 게이트에 전달한다', async () => {
    resolveDeckNotifyEnabled.mockResolvedValue(true)

    const res = await callGet('?workspaceId=ws1&deckKey=coupang-ads&eventKey=collection_done')
    const body = await res.json()

    expect(body).toEqual({ target: { channelId: 'C1' }, notifyEnabled: true })
    expect(resolveDeckNotifyEnabled).toHaveBeenCalledWith('ws1', 'coupang-ads', 'collection_done')
  })
})
