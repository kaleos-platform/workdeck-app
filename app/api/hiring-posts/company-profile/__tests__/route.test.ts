/** @jest-environment node */
import { NextRequest } from 'next/server'
import { GET, PUT } from '../route'
import { prisma } from '@/lib/prisma'
import { resolveDeckContext } from '@/lib/api-helpers'

jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: jest.fn(),
  errorResponse: (message: string, status: number) => Response.json({ message }, { status }),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: { hiringCompanyProfile: { findUnique: jest.fn(), upsert: jest.fn() } },
}))

const put = async (body: unknown) =>
  (await PUT(
    new NextRequest('http://x/api', { method: 'PUT', body: JSON.stringify(body) })
  )) as Response
const body = { companyName: '미닝카페', intro: '', homepageUrl: 'https://a.com', showIntro: true }

beforeEach(() => {
  jest.resetAllMocks()
  ;(resolveDeckContext as jest.Mock).mockResolvedValue({ space: { id: 's1', name: '내 공간' } })
  ;(prisma.hiringCompanyProfile.upsert as jest.Mock).mockResolvedValue({ companyName: '미닝카페' })
})

it('인증·deck 가드 실패 응답을 그대로 돌려준다(GET)', async () => {
  ;(resolveDeckContext as jest.Mock).mockResolvedValue({
    error: Response.json({ message: 'x' }, { status: 403 }),
  })
  expect(((await GET()) as Response).status).toBe(403)
  expect(prisma.hiringCompanyProfile.findUnique).not.toHaveBeenCalled()
})

it('저장 전에는 profile=null + 공간 이름 기본값', async () => {
  ;(prisma.hiringCompanyProfile.findUnique as jest.Mock).mockResolvedValue(null)
  const res = (await GET()) as Response
  expect(await res.json()).toEqual({ profile: null, defaultCompanyName: '내 공간' })
  expect(prisma.hiringCompanyProfile.findUnique).toHaveBeenCalledWith(
    expect.objectContaining({ where: { spaceId: 's1' } })
  )
})

it('만료 공간 쓰기는 402, 비활성 deck 은 403 — 저장하지 않는다', async () => {
  for (const status of [402, 403]) {
    ;(resolveDeckContext as jest.Mock).mockResolvedValue({
      error: Response.json({ message: 'x' }, { status }),
    })
    expect((await put(body)).status).toBe(status)
  }
  expect(resolveDeckContext).toHaveBeenCalledWith('recruiting', { write: true })
  expect(prisma.hiringCompanyProfile.upsert).not.toHaveBeenCalled()
})

it('본문 spaceId 는 무시하고 resolved 공간으로만 upsert 한다', async () => {
  const res = await put({ ...body, spaceId: 'attacker' })
  expect(res.status).toBe(200)
  const arg = (prisma.hiringCompanyProfile.upsert as jest.Mock).mock.calls[0][0]
  expect(arg.where).toEqual({ spaceId: 's1' })
  expect(arg.create.spaceId).toBe('s1')
  expect(arg.update).not.toHaveProperty('spaceId')
  expect(arg.create.intro).toBeNull()
})

it('http URL 은 400', async () => {
  expect((await put({ ...body, homepageUrl: 'http://a.com' })).status).toBe(400)
  expect(prisma.hiringCompanyProfile.upsert).not.toHaveBeenCalled()
})
