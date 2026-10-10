/** @jest-environment node */
/**
 * 스윕 Space 격리 — 실제 라우트 + 로컬 Supabase, mock 없음.
 * Space A·B 를 같은 모양으로 시드하고, A 토큰 호출은 A 만, B 토큰 호출은 B 만 처리·응답하는지 본다.
 * runCoupangSalesSyncForDates·runInventorySync 의 spaceId 필터를 지우면 두 Space 가 모두 나와 실패한다.
 * Deck 을 만들지 않으므로 각 Space 는 'skip:deck-inactive' 로 요약에 나온다(재고는 바꾸지 않는다).
 */
import path from 'path'
import { config } from 'dotenv'

// next/jest 는 테스트 모드에서 .env.local 을 읽지 않는다 — 기존 e2e 와 같이 직접 읽는다.
config({ path: path.resolve(process.cwd(), '.env.local') })

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateWorkerToken, workerTokenExpiry } from '@/lib/worker-auth'
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '@/lib/inv/external-sources'
import { GET as salesSync } from '../../../../app/api/cron/coupang-sales-sync/route'
import { GET as inventorySync } from '../../../../app/api/cron/coupang-inventory-sync/route'

const url = process.env.DATABASE_URL ?? ''
const RUN = /@(127\.0\.0\.1|localhost):/.test(url)
if (process.env.CI && !RUN) throw new Error('CI 에서는 로컬 Supabase DATABASE_URL 이 필요합니다')
const d = RUN ? describe : describe.skip

const A = 'e2e-sweep-space-a'
const B = 'e2e-sweep-space-b'
const tokens: Record<string, string> = {}

async function cleanup() {
  await prisma.space.deleteMany({ where: { id: { in: [A, B] } } }) // 위치·매핑·토큰은 Cascade
}

async function seed(spaceId: string) {
  await prisma.space.create({ data: { id: spaceId, name: spaceId } })
  const loc = await prisma.invStorageLocation.create({
    data: { spaceId, name: '로켓그로스', externalSource: EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH },
  })
  await prisma.invLocationProductMap.create({
    data: { spaceId, locationId: loc.id, externalCode: 'X1' },
  })
  const { token, tokenHash } = generateWorkerToken()
  await prisma.workerToken.create({
    data: { spaceId, name: 'e2e', tokenHash, expiresAt: workerTokenExpiry(1) },
  })
  tokens[spaceId] = token
}

const ROUTES = [
  ['판매 변환', salesSync, '/api/cron/coupang-sales-sync'],
  ['재고 대조', inventorySync, '/api/cron/coupang-inventory-sync'],
] as const

d('스윕 Space 격리 (로컬 Supabase)', () => {
  beforeAll(async () => {
    await cleanup()
    await seed(A)
    await seed(B)
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  test.each(ROUTES)(
    '%s: Space 토큰은 자기 Space 만 처리·응답한다',
    async (_name, handler, path) => {
      // B 는 대조군 — A 만 보면 "아무것도 안 돌았다"도 통과할 수 있다.
      for (const own of [A, B]) {
        const res = await handler(
          new NextRequest(`http://t${path}`, { headers: { 'x-worker-api-key': tokens[own] } })
        )
        expect(res.status).toBe(200)
        const body = (await res.json()) as { spaces: Array<{ spaceId: string }> }
        expect(body.spaces.map((s) => s.spaceId)).toEqual([own])
      }
    }
  )

  test.each(ROUTES)(
    '%s: 틀린 CRON_SECRET 이고 워커 토큰이 없으면 401',
    async (_name, handler, path) => {
      process.env.CRON_SECRET = 'cron-secret'
      const res = await handler(
        new NextRequest(`http://t${path}`, { headers: { authorization: 'Bearer wrong' } })
      )
      expect(res.status).toBe(401)
    }
  )
})
