/** @jest-environment node */
import {
  currentYearMonth,
  CreditExceededError,
  TextCreditExceededError,
  DEFAULT_TEXT_MONTHLY_QUOTA,
  reserveTextCredit,
  commitTextCredit,
  refundTextCredit,
} from '../credit'
import { prisma } from '@/lib/prisma'

// prisma 는 lazy Proxy(src/lib/prisma.ts)라 jest.mock 으로 DB 접근 없이 대체 가능.
jest.mock('@/lib/prisma', () => ({
  prisma: {
    workspaceAiCredit: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
    },
    textGenerationLog: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    $executeRaw: jest.fn(),
  },
}))

const mockedPrisma = prisma as unknown as {
  workspaceAiCredit: { upsert: jest.Mock; findUnique: jest.Mock }
  textGenerationLog: { create: jest.Mock; update: jest.Mock; findUnique: jest.Mock }
  $executeRaw: jest.Mock
}

describe('currentYearMonth', () => {
  it('UTC 기준 YYYY-MM 을 반환한다', () => {
    expect(currentYearMonth(new Date('2026-04-24T10:00:00Z'))).toBe('2026-04')
    expect(currentYearMonth(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01')
    expect(currentYearMonth(new Date('2026-12-31T23:59:59Z'))).toBe('2026-12')
  })

  it('한 자리 월을 0 으로 패딩한다', () => {
    expect(currentYearMonth(new Date('2026-03-15T00:00:00Z'))).toBe('2026-03')
    expect(currentYearMonth(new Date('2026-09-01T00:00:00Z'))).toBe('2026-09')
  })
})

describe('CreditExceededError', () => {
  it('code 상수와 yearMonth 를 가진다', () => {
    const err = new CreditExceededError('2026-04')
    expect(err.code).toBe('CREDIT_EXCEEDED')
    expect(err.yearMonth).toBe('2026-04')
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toContain('2026-04')
  })
})

describe('TextCreditExceededError', () => {
  it('code 상수와 yearMonth 를 가진다', () => {
    const err = new TextCreditExceededError('2026-04')
    expect(err.code).toBe('TEXT_CREDIT_EXCEEDED')
    expect(err.yearMonth).toBe('2026-04')
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toContain('2026-04')
  })
})

describe('reserveTextCredit / commitTextCredit / refundTextCredit', () => {
  const now = new Date('2026-04-24T10:00:00Z')
  const yearMonth = '2026-04'

  beforeEach(() => {
    jest.clearAllMocks()
    mockedPrisma.workspaceAiCredit.upsert.mockResolvedValue({})
  })

  it('reserve → commit: 예약 후 확정하면 로그가 SUCCEEDED 로 전환된다', async () => {
    mockedPrisma.$executeRaw.mockResolvedValue(1) // atomic UPDATE affected 1 row
    mockedPrisma.workspaceAiCredit.findUnique.mockResolvedValue({
      textUsed: 1,
      textQuota: DEFAULT_TEXT_MONTHLY_QUOTA,
    })
    mockedPrisma.textGenerationLog.create.mockResolvedValue({ id: 'log-1' })

    const reservation = await reserveTextCredit({
      spaceId: 'space-1',
      provider: 'claude-code-acp',
      now,
    })

    expect(reservation.reservationId).toBe('log-1')
    expect(reservation.yearMonth).toBe(yearMonth)
    expect(reservation.textUsedAfter).toBe(1)
    expect(mockedPrisma.textGenerationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ creditMonth: yearMonth, status: 'PENDING' }),
      })
    )

    mockedPrisma.textGenerationLog.update.mockResolvedValue({})
    await commitTextCredit('log-1', { inputTokens: 100, outputTokens: 200 })

    expect(mockedPrisma.textGenerationLog.update).toHaveBeenCalledWith({
      where: { id: 'log-1' },
      data: expect.objectContaining({ status: 'SUCCEEDED', inputTokens: 100, outputTokens: 200 }),
    })
  })

  it('reserve → refund: 실패 시 textUsed 를 감소시키고 로그를 REFUNDED 로 전환한다', async () => {
    mockedPrisma.$executeRaw.mockResolvedValue(1)
    mockedPrisma.workspaceAiCredit.findUnique.mockResolvedValue({
      textUsed: 1,
      textQuota: DEFAULT_TEXT_MONTHLY_QUOTA,
    })
    mockedPrisma.textGenerationLog.create.mockResolvedValue({ id: 'log-2' })

    const reservation = await reserveTextCredit({
      spaceId: 'space-1',
      provider: 'claude-code-acp',
      now,
    })

    mockedPrisma.textGenerationLog.findUnique.mockResolvedValue({
      spaceId: 'space-1',
      creditMonth: yearMonth,
      status: 'PENDING',
    })
    mockedPrisma.textGenerationLog.update.mockResolvedValue({})

    // 환불 시점의 currentYearMonth() 도 같은 달이 되도록 시스템 시각을 고정한다.
    jest.useFakeTimers().setSystemTime(now)
    await refundTextCredit(reservation.reservationId, 'PROVIDER_ERROR', '타임아웃')
    jest.useRealTimers()

    expect(mockedPrisma.$executeRaw).toHaveBeenCalledTimes(2) // reserve 1회 + refund 1회
    expect(mockedPrisma.textGenerationLog.update).toHaveBeenCalledWith({
      where: { id: 'log-2' },
      data: { status: 'REFUNDED', errorCode: 'PROVIDER_ERROR', errorMessage: '타임아웃' },
    })
  })

  it('quota exhausted: textUsed 가 textQuota 이상이면 TextCreditExceededError 를 던진다', async () => {
    mockedPrisma.$executeRaw.mockResolvedValue(0) // atomic UPDATE affected 0 rows = 쿼터 초과

    await expect(
      reserveTextCredit({ spaceId: 'space-1', provider: 'claude-code-acp', now })
    ).rejects.toBeInstanceOf(TextCreditExceededError)
    await expect(
      reserveTextCredit({ spaceId: 'space-1', provider: 'claude-code-acp', now })
    ).rejects.toThrow(yearMonth)
  })
})
