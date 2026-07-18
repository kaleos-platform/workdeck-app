/**
 * @jest-environment node
 *
 * /api/decks/notification-setting 라우트 계약 검증(프론트 병렬 개발이 이 필드명에 의존).
 * resolveDeckContext + prisma는 mock — 여기선 인증 통과를 가정하고 응답 형태·검증 분기만 본다.
 */
import { NextRequest } from 'next/server'
import { GET, PATCH } from '../route'

const resolveDeckContext = jest.fn()
const findUniqueDeckInstance = jest.fn()
const updateDeckInstance = jest.fn()
const findUniqueChannel = jest.fn()

jest.mock('@/lib/api-helpers', () => {
  const actual = jest.requireActual('@/lib/api-helpers')
  return {
    ...actual,
    resolveDeckContext: (...a: unknown[]) => resolveDeckContext(...a),
  }
})
jest.mock('@/lib/prisma', () => ({
  prisma: {
    deckInstance: {
      findUnique: (...a: unknown[]) => findUniqueDeckInstance(...a),
      update: (...a: unknown[]) => updateDeckInstance(...a),
    },
    spaceSlackChannel: { findUnique: (...a: unknown[]) => findUniqueChannel(...a) },
  },
}))

// 라우트 핸들러 반환 타입이 추론상 `Response | undefined`라 응답을 좁혀 반환한다.
async function callGet(deckKey?: string) {
  const url = deckKey
    ? `http://localhost/api/decks/notification-setting?deckKey=${deckKey}`
    : 'http://localhost/api/decks/notification-setting'
  const res = await GET(new NextRequest(url))
  if (!res) throw new Error('라우트가 응답을 반환하지 않았습니다')
  return res
}

async function callPatch(body: unknown) {
  const res = await PATCH(
    new NextRequest('http://localhost/api/decks/notification-setting', {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
  )
  if (!res) throw new Error('라우트가 응답을 반환하지 않았습니다')
  return res
}

describe('GET /api/decks/notification-setting', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resolveDeckContext.mockResolvedValue({
      user: { id: 'u1' },
      space: { id: 'space1' },
      role: 'OWNER',
    })
  })

  it('화이트리스트 밖 deckKey면 400', async () => {
    const res = await callGet('finance')
    expect(res.status).toBe(400)
    expect(resolveDeckContext).not.toHaveBeenCalled()
  })

  it('deckKey 누락이면 400', async () => {
    const res = await callGet()
    expect(res.status).toBe(400)
  })

  it('{ enabled, channelRegistered } 형태 반환', async () => {
    findUniqueDeckInstance.mockResolvedValue({ slackNotifyEnabled: false })
    findUniqueChannel.mockResolvedValue({ id: 'ch1' })

    const res = await callGet('coupang-ads')
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ enabled: false, channelRegistered: true })
  })

  it('DeckInstance 없으면 enabled 기본 true, 채널 없으면 channelRegistered false', async () => {
    findUniqueDeckInstance.mockResolvedValue(null)
    findUniqueChannel.mockResolvedValue(null)

    const res = await callGet('seller-hub')
    const body = await res.json()

    expect(body).toEqual({ enabled: true, channelRegistered: false })
  })

  it('ADMIN 미만이면 403', async () => {
    resolveDeckContext.mockResolvedValue({
      user: { id: 'u1' },
      space: { id: 'space1' },
      role: 'MEMBER',
    })

    const res = await callGet('coupang-ads')
    expect(res.status).toBe(403)
  })
})

describe('PATCH /api/decks/notification-setting', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resolveDeckContext.mockResolvedValue({
      user: { id: 'u1' },
      space: { id: 'space1' },
      role: 'ADMIN',
    })
  })

  it('enabled를 업데이트하고 { enabled } 반환', async () => {
    updateDeckInstance.mockResolvedValue({ slackNotifyEnabled: false })

    const res = await callPatch({ deckKey: 'coupang-ads', enabled: false })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ enabled: false })
    expect(updateDeckInstance).toHaveBeenCalledWith({
      where: { spaceId_deckAppId: { spaceId: 'space1', deckAppId: 'coupang-ads' } },
      data: { slackNotifyEnabled: false },
      select: { slackNotifyEnabled: true },
    })
  })

  it('enabled가 boolean이 아니면 400', async () => {
    const res = await callPatch({ deckKey: 'coupang-ads', enabled: 'yes' })
    expect(res.status).toBe(400)
    expect(updateDeckInstance).not.toHaveBeenCalled()
  })

  it('화이트리스트 밖 deckKey면 400', async () => {
    const res = await callPatch({ deckKey: 'nope', enabled: true })
    expect(res.status).toBe(400)
  })
})
