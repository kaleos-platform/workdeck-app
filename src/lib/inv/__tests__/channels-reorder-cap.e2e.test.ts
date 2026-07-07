/**
 * PUT /api/channels/reorder — orderedIds 1000개 초과 시 400 차단 e2e.
 *
 * 대량 트랜잭션 DoS 방지 가드 검증(감사 Low).
 * 크기 가드는 소유권 검증(DB 조회) 전에 발생하므로 실제 채널 시드 불필요.
 * resolveDeckContext를 mock해 space만 주입. DB URL 없으면 skip.
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/api-helpers', () => {
  const actual = jest.requireActual('@/lib/api-helpers')
  return { __esModule: true, ...actual, resolveDeckContext: jest.fn() }
})

import { resolveDeckContext } from '@/lib/api-helpers'
import { PUT } from '../../../../app/api/channels/reorder/route'

// throwaway space/user — 다른 e2e와 충돌 방지를 위해 고유 hex UUID 사용
const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000f1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000f2'

// DB URL 없으면 테스트 자체를 skip
const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

async function cleanup() {
  await prisma.user.deleteMany({ where: { id: USER_ID } })
  await prisma.space.deleteMany({ where: { id: SPACE_ID } })
}

function putReq(body: unknown) {
  return new NextRequest('http://localhost/api/channels/reorder', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

d('PUT /channels/reorder — orderedIds 상한 가드 (dev DB)', () => {
  beforeAll(async () => {
    await cleanup()
    await prisma.space.create({
      data: { id: SPACE_ID, name: 'E2E ReorderCap', type: 'PERSONAL' },
    })
    await prisma.user.create({
      data: { id: USER_ID, email: 'e2e-reorder-cap@throwaway.test' },
    })
    ;(resolveDeckContext as jest.Mock).mockResolvedValue({
      space: { id: SPACE_ID, name: 'E2E ReorderCap' },
      user: { id: USER_ID },
    })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  test('orderedIds 1001개 → 400, 메시지에 1000 포함', async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => `ch-${i}`)
    const res = (await PUT(putReq({ orderedIds: ids })))!
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(JSON.stringify(json)).toContain('1000')
  })
})
