/** @jest-environment node */
import crypto from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { getBillingProvider } from '../providers/toss'
import { removeBillingMethod, startSubscription } from '../subscription-service'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    billingMethod: { findFirst: jest.fn(), updateMany: jest.fn(), delete: jest.fn() },
    billingDeckProduct: { findMany: jest.fn() },
    spaceSubscription: { findUnique: jest.fn() },
  },
}))
jest.mock('../providers/toss', () => ({ getBillingProvider: jest.fn() }))

const mock = prisma as unknown as {
  billingMethod: { findFirst: jest.Mock; updateMany: jest.Mock; delete: jest.Mock }
  billingDeckProduct: { findMany: jest.Mock }
  spaceSubscription: { findUnique: jest.Mock }
}

const LEGACY = 'c'.repeat(64)
const BILLING_KEY = 'bk_SYNTHETIC_BILLING_KEY_123'
const ENV_KEYS = ['ENCRYPTION_WRITE_VERSION', 'VERCEL_ENV', 'ENCRYPTION_KEY', 'ENCRYPTION_KEY_V1']
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

function v0Method() {
  const iv = crypto.randomBytes(16)
  const c = crypto.createCipheriv('aes-256-cbc', Buffer.from(LEGACY, 'hex'), iv)
  return {
    id: 'm1',
    spaceId: 's1',
    billingKey: c.update(BILLING_KEY, 'utf8', 'hex') + c.final('hex'),
    billingKeyIv: iv.toString('hex'),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.restoreAllMocks()
  delete process.env.ENCRYPTION_WRITE_VERSION
  delete process.env.VERCEL_ENV
  process.env.ENCRYPTION_KEY_V1 = 'a'.repeat(64)
  process.env.ENCRYPTION_KEY = LEGACY
  mock.billingDeckProduct.findMany.mockResolvedValue([
    { id: 'd1', isActive: true, pricingMode: 'SUBSCRIPTION', monthlyPrice: 1000 },
  ])
  // 결제수단 로드 뒤 바로 멈추게 — 구독 레코드가 없으면 BillingError
  mock.spaceSubscription.findUnique.mockResolvedValue(null)
})

// loadDefaultMethod 가 성공하면 다음 단계의 BillingError 까지 진행한다.
const startUntilMethodLoaded = () =>
  expect(startSubscription('s1', ['d1'])).rejects.toThrow('결제수단 등록이 선행되어야 합니다')

describe('빌링키 지연 재암호화', () => {
  test('v0 빌링키는 같은 암호문일 때만 billing-key v1 으로 갱신한다', async () => {
    const method = v0Method()
    mock.billingMethod.findFirst.mockResolvedValue(method)
    mock.billingMethod.updateMany.mockResolvedValue({ count: 1 })
    await startUntilMethodLoaded()
    const arg = mock.billingMethod.updateMany.mock.calls[0][0]
    expect(arg.where).toEqual({ id: 'm1', billingKey: method.billingKey })
    expect(arg.data.billingKeyIv).toBe('v1')
  })

  test('v0 쓰기 기간(4a)에는 갱신하지 않는다', async () => {
    process.env.ENCRYPTION_WRITE_VERSION = 'v0'
    mock.billingMethod.findFirst.mockResolvedValue(v0Method())
    await startUntilMethodLoaded()
    expect(mock.billingMethod.updateMany).not.toHaveBeenCalled()
  })

  test('그 사이 재등록돼 갱신 0건이어도 결제수단 로드는 성공한다', async () => {
    mock.billingMethod.findFirst.mockResolvedValue(v0Method())
    mock.billingMethod.updateMany.mockResolvedValue({ count: 0 })
    await startUntilMethodLoaded()
  })

  test('저장이 실패해도 결제수단 로드는 성공한다', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    mock.billingMethod.findFirst.mockResolvedValue(v0Method())
    mock.billingMethod.updateMany.mockRejectedValue(new Error('db down'))
    await startUntilMethodLoaded()
  })
})

test('빌링키 폐기 실패 로그에 오류 원문(빌링키 포함 가능)을 남기지 않는다', async () => {
  const error = jest.spyOn(console, 'error').mockImplementation(() => {})
  mock.billingMethod.findFirst.mockResolvedValue(v0Method())
  ;(getBillingProvider as jest.Mock).mockReturnValue({
    deleteBillingKey: jest.fn().mockRejectedValue(new Error(`PG 400 billingKey=${BILLING_KEY}`)),
  })
  await removeBillingMethod('s1', 'm1')
  expect(error).toHaveBeenCalled()
  const logged = error.mock.calls
    .flat()
    .map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a)))
    .join(' ')
  expect(logged).not.toContain(BILLING_KEY)
  expect(mock.billingMethod.delete).toHaveBeenCalled()
})
