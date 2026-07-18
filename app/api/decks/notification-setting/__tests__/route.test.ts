/**
 * @jest-environment node
 *
 * /api/decks/notification-setting 라우트 계약 검증(프론트 병렬 개발이 이 필드명에 의존).
 * resolveDeckContext + prisma는 mock — 여기선 인증 통과를 가정하고 응답 형태·검증 분기만 본다.
 */
import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
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

// coupang-ads togglable 이벤트 키(레지스트리 순서).
const COUPANG_TOGGLABLE = [
  'collection_done',
  'inventory_collection_done',
  'inventory_analysis_done',
]

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

  it('{ enabled, channelRegistered, events } 형태 반환 — events는 togglable만', async () => {
    findUniqueDeckInstance.mockResolvedValue({
      slackNotifyEnabled: false,
      slackNotifyEvents: { collection_done: false },
    })
    findUniqueChannel.mockResolvedValue({ id: 'ch1' })

    const res = await callGet('coupang-ads')
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.enabled).toBe(false)
    expect(body.channelRegistered).toBe(true)
    expect(body.events.map((e: { key: string }) => e.key)).toEqual(COUPANG_TOGGLABLE)
    // 비활성 기록된 이벤트만 enabled=false, 나머지는 default-on
    const collectionDone = body.events.find((e: { key: string }) => e.key === 'collection_done')
    expect(collectionDone).toMatchObject({ key: 'collection_done', enabled: false })
    expect(collectionDone.label).toBeTruthy()
    expect(collectionDone.description).toBeTruthy()
    expect(
      body.events.find((e: { key: string }) => e.key === 'inventory_collection_done').enabled
    ).toBe(true)
  })

  it('DeckInstance 없으면 enabled 기본 true, 채널 없으면 channelRegistered false, 모든 이벤트 on', async () => {
    findUniqueDeckInstance.mockResolvedValue(null)
    findUniqueChannel.mockResolvedValue(null)

    const res = await callGet('seller-hub')
    const body = await res.json()

    expect(body.enabled).toBe(true)
    expect(body.channelRegistered).toBe(false)
    expect(body.events).toEqual([
      expect.objectContaining({ key: 'vendor_sales_done', enabled: true }),
    ])
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

  it('enabled를 업데이트하고 { enabled, events } 반환', async () => {
    updateDeckInstance.mockResolvedValue({ slackNotifyEnabled: false, slackNotifyEvents: null })

    const res = await callPatch({ deckKey: 'coupang-ads', enabled: false })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.enabled).toBe(false)
    expect(body.events.map((e: { key: string }) => e.key)).toEqual(COUPANG_TOGGLABLE)
    expect(updateDeckInstance).toHaveBeenCalledWith({
      where: { spaceId_deckAppId: { spaceId: 'space1', deckAppId: 'coupang-ads' } },
      data: { slackNotifyEnabled: false },
      select: { slackNotifyEnabled: true, slackNotifyEvents: true },
    })
  })

  it('events를 기존 Json에 머지 — false는 저장, true는 키 삭제로 정규화', async () => {
    // 기존: inventory_collection_done=false 저장돼 있음
    findUniqueDeckInstance.mockResolvedValue({
      slackNotifyEvents: { inventory_collection_done: false },
    })
    updateDeckInstance.mockResolvedValue({
      slackNotifyEnabled: true,
      slackNotifyEvents: { collection_done: false },
    })

    // collection_done을 끄고(false), inventory_collection_done을 켠다(true→삭제)
    const res = await callPatch({
      deckKey: 'coupang-ads',
      events: { collection_done: false, inventory_collection_done: true },
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.enabled).toBe(true)
    // update에 넘어간 Json: collection_done만 false로 남음
    expect(updateDeckInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { slackNotifyEvents: { collection_done: false } },
      })
    )
  })

  it('모든 이벤트가 true로 정규화되면 slackNotifyEvents를 DbNull로 비운다', async () => {
    findUniqueDeckInstance.mockResolvedValue({
      slackNotifyEvents: { collection_done: false },
    })
    updateDeckInstance.mockResolvedValue({ slackNotifyEnabled: true, slackNotifyEvents: null })

    await callPatch({ deckKey: 'coupang-ads', events: { collection_done: true } })

    const call = updateDeckInstance.mock.calls[0][0]
    // 빈 객체가 아니라 DbNull 심볼로 컬럼을 비운다.
    expect(call.data.slackNotifyEvents).toBe(Prisma.DbNull)
  })

  it('enabled·events 둘 다 없으면 400', async () => {
    const res = await callPatch({ deckKey: 'coupang-ads' })
    expect(res.status).toBe(400)
    expect(updateDeckInstance).not.toHaveBeenCalled()
  })

  it('enabled가 boolean이 아니면 400', async () => {
    const res = await callPatch({ deckKey: 'coupang-ads', enabled: 'yes' })
    expect(res.status).toBe(400)
    expect(updateDeckInstance).not.toHaveBeenCalled()
  })

  it('미등록 eventKey면 400', async () => {
    const res = await callPatch({ deckKey: 'coupang-ads', events: { nope: false } })
    expect(res.status).toBe(400)
    expect(updateDeckInstance).not.toHaveBeenCalled()
  })

  it('비togglable eventKey면 400', async () => {
    const res = await callPatch({ deckKey: 'coupang-ads', events: { collection_failed: false } })
    expect(res.status).toBe(400)
    expect(updateDeckInstance).not.toHaveBeenCalled()
  })

  it('events 값이 boolean이 아니면 400', async () => {
    const res = await callPatch({ deckKey: 'coupang-ads', events: { collection_done: 'off' } })
    expect(res.status).toBe(400)
  })

  it('화이트리스트 밖 deckKey면 400', async () => {
    const res = await callPatch({ deckKey: 'nope', enabled: true })
    expect(res.status).toBe(400)
  })
})
