// Jest mock factory가 import 전에 평가되므로 var로 hoist 가능한 mock 저장소를 둔다.
// eslint-disable-next-line no-var
var mockFinAccount: {
  findMany: jest.Mock
  findFirst: jest.Mock
  create: jest.Mock
  update: jest.Mock
}

function ensureMockFinAccount() {
  if (!mockFinAccount) {
    mockFinAccount = {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    }
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
      finAccount: ensureMockFinAccount(),
    }
  },
}))

import { GET, POST } from '../route'
import { PATCH } from '../[id]/route'

function jsonRequest(body: unknown): Parameters<typeof POST>[0] {
  return {
    json: async () => body,
  } as Parameters<typeof POST>[0]
}

describe('/api/finance/accounts', () => {
  beforeEach(() => {
    const finAccount = ensureMockFinAccount()
    finAccount.findMany.mockReset()
    finAccount.findFirst.mockReset()
    finAccount.create.mockReset()
    finAccount.update.mockReset()
  })

  test('POST stores holder separately from account name', async () => {
    mockFinAccount.findFirst.mockResolvedValue(null)
    mockFinAccount.create.mockResolvedValue({
      id: 'account-1',
      spaceId: 'space-1',
      name: '기업은행 운영 구분명',
      holder: '주식회사 워크덱',
      kind: 'BANK',
      institution: '기업은행',
      accountNumber: '123',
      accountType: null,
      openingBalance: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    const res = (await POST(
      jsonRequest({
        name: '기업은행 운영 구분명',
        holder: '주식회사 워크덱',
        kind: 'BANK',
        institution: '기업은행',
        accountNumber: '123',
      })
    ))!
    const body = await res.json()

    expect(mockFinAccount.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: '기업은행 운영 구분명',
          holder: '주식회사 워크덱',
        }),
      })
    )
    expect(body.account.name).toBe('기업은행 운영 구분명')
    expect(body.account.holder).toBe('주식회사 워크덱')
  })

  test('PATCH updates holder without changing account name', async () => {
    mockFinAccount.findFirst.mockResolvedValue({ id: 'account-1', accountNumber: '123' })
    mockFinAccount.update.mockResolvedValue({
      id: 'account-1',
      spaceId: 'space-1',
      name: '기업은행 운영 구분명',
      holder: '워크덱컴퍼니',
      kind: 'BANK',
      institution: '기업은행',
      accountNumber: '123',
      accountType: null,
      openingBalance: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    const res = (await PATCH(jsonRequest({ holder: '워크덱컴퍼니' }), {
      params: Promise.resolve({ id: 'account-1' }),
    }))!
    const body = await res.json()

    expect(mockFinAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          holder: '워크덱컴퍼니',
        }),
      })
    )
    expect(mockFinAccount.update.mock.calls[0][0].data).not.toHaveProperty('name')
    expect(body.account.name).toBe('기업은행 운영 구분명')
    expect(body.account.holder).toBe('워크덱컴퍼니')
  })

  test('GET returns holder for account management clients', async () => {
    mockFinAccount.findMany.mockResolvedValue([
      {
        id: 'account-1',
        spaceId: 'space-1',
        name: '기업은행 운영 구분명',
        holder: '주식회사 워크덱',
        kind: 'BANK',
        institution: '기업은행',
        accountNumber: '123',
        accountType: null,
        openingBalance: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ])

    const res = (await GET())!
    const body = await res.json()

    expect(body.accounts[0].name).toBe('기업은행 운영 구분명')
    expect(body.accounts[0].holder).toBe('주식회사 워크덱')
  })
})
