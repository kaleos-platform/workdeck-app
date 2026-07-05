// Jest mock factory가 import 전에 평가되므로 var로 hoist 가능한 mock 저장소를 둔다.
// eslint-disable-next-line no-var
var mockFinLiability: {
  findMany: jest.Mock
  findFirst: jest.Mock
  create: jest.Mock
  update: jest.Mock
}
// eslint-disable-next-line no-var
var mockFinAccount: {
  findFirst: jest.Mock
}

function ensureMockFinLiability() {
  if (!mockFinLiability) {
    mockFinLiability = {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    }
  }
  return mockFinLiability
}

function ensureMockFinAccount() {
  if (!mockFinAccount) {
    mockFinAccount = { findFirst: jest.fn() }
  }
  return mockFinAccount
}

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}))

jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: jest.fn().mockResolvedValue({ space: { id: 'space-1' } }),
  errorResponse: (message: string, status: number) => ({
    status,
    json: async () => ({ message }),
  }),
}))

jest.mock('@/lib/prisma', () => ({
  get prisma() {
    return {
      finLiability: ensureMockFinLiability(),
      finAccount: ensureMockFinAccount(),
    }
  },
}))

import { POST } from '../route'
import { PATCH } from '../[id]/route'

function jsonRequest(body: unknown): Parameters<typeof POST>[0] {
  return {
    json: async () => body,
  } as Parameters<typeof POST>[0]
}

const baseLiability = {
  id: 'liab-1',
  spaceId: 'space-1',
  name: '기업은행 사업자대출',
  lender: '기업은행',
  principal: 100_000_000,
  balance: 80_000_000,
  rate: null,
  dueDate: null,
  monthlyPayment: null,
  memo: null,
  accountId: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

describe('/api/finance/liabilities accountId 연결', () => {
  beforeEach(() => {
    const finLiability = ensureMockFinLiability()
    finLiability.findMany.mockReset()
    finLiability.findFirst.mockReset()
    finLiability.create.mockReset()
    finLiability.update.mockReset()
    ensureMockFinAccount().findFirst.mockReset()
  })

  test('POST: 같은 space 계좌를 대출 계좌로 연결', async () => {
    mockFinAccount.findFirst.mockResolvedValue({ id: 'acct-1' })
    mockFinLiability.create.mockResolvedValue({ ...baseLiability, accountId: 'acct-1' })

    const res = await POST(
      jsonRequest({
        name: '기업은행 사업자대출',
        principal: 100_000_000,
        balance: 80_000_000,
        accountId: 'acct-1',
      })
    )
    const body = await res!.json()

    expect(mockFinAccount.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'acct-1', spaceId: 'space-1' } })
    )
    expect(mockFinLiability.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ accountId: 'acct-1' }) })
    )
    expect(body.liability.accountId).toBe('acct-1')
  })

  test('POST: 타 space 계좌 연결 시도는 400 거부', async () => {
    mockFinAccount.findFirst.mockResolvedValue(null)

    const res = await POST(
      jsonRequest({
        name: '외부 대출',
        principal: 1_000_000,
        balance: 1_000_000,
        accountId: 'foreign-acct',
      })
    )

    expect(res!.status).toBe(400)
    expect(mockFinLiability.create).not.toHaveBeenCalled()
  })

  test('POST: accountId 미지정이면 미연결(null)', async () => {
    mockFinLiability.create.mockResolvedValue({ ...baseLiability, accountId: null })

    await POST(jsonRequest({ name: '무연결 부채', principal: 500, balance: 500 }))

    expect(mockFinAccount.findFirst).not.toHaveBeenCalled()
    expect(mockFinLiability.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ accountId: null }) })
    )
  })

  test('PATCH: accountId 빈 문자열이면 연결 해제(null)', async () => {
    mockFinLiability.findFirst.mockResolvedValue({ id: 'liab-1' })
    mockFinLiability.update.mockResolvedValue({ ...baseLiability, accountId: null })

    await PATCH(jsonRequest({ accountId: '' }), {
      params: Promise.resolve({ id: 'liab-1' }),
    })

    expect(mockFinAccount.findFirst).not.toHaveBeenCalled()
    expect(mockFinLiability.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ accountId: null }) })
    )
  })

  test('PATCH: accountId 미포함이면 연결 필드 미변경', async () => {
    mockFinLiability.findFirst.mockResolvedValue({ id: 'liab-1' })
    mockFinLiability.update.mockResolvedValue({ ...baseLiability, accountId: 'acct-1' })

    await PATCH(jsonRequest({ balance: 70_000_000 }), {
      params: Promise.resolve({ id: 'liab-1' }),
    })

    expect(mockFinLiability.update.mock.calls[0][0].data).not.toHaveProperty('accountId')
  })
})
