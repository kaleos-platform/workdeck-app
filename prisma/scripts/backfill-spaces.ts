/**
 * backfill-spaces.ts
 *
 * 기존 Workspace를 Workdeck OS Space 구조로 백필합니다.
 * 각 Workspace에 대해:
 *   1. Space(PERSONAL, name=Workspace.name) 생성
 *   2. SpaceMember(userId=Workspace.ownerId, role=OWNER) 생성
 *   3. DeckInstance(deckAppId='coupang-ads', isActive=true) 생성
 *
 * 이미 존재하는 Space는 건너뜁니다 (idempotent).
 *
 * 실행:
 *   npx tsx prisma/scripts/backfill-spaces.ts
 */

import 'dotenv/config'
import { config } from 'dotenv'
import { PrismaClient } from '../../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

config({ path: '.env.local', override: true })

const connectionString = process.env['DIRECT_URL'] ?? process.env['DATABASE_URL']
if (!connectionString) throw new Error('DATABASE_URL 또는 DIRECT_URL 환경변수가 필요합니다')

const adapter = new PrismaPg({ connectionString })
const prisma = new PrismaClient({ adapter } as never)

async function main() {
  const workspaces = await prisma.workspace.findMany({
    select: { id: true, name: true, ownerId: true },
  })

  console.log(`📋 Workspace ${workspaces.length}개 발견`)

  let created = 0
  let skipped = 0

  for (const ws of workspaces) {
    // 이미 해당 ownerId로 SpaceMember(OWNER)가 있으면 건너뜀
    const existing = await prisma.spaceMember.findFirst({
      where: { userId: ws.ownerId, role: 'OWNER' },
    })

    if (existing) {
      console.log(`  ⏭ [${ws.name}] 이미 Space 존재 — 건너뜀`)
      skipped++
      continue
    }

    // Space → SpaceMember → DeckInstance 순서로 생성
    const space = await prisma.space.create({
      data: {
        name: ws.name,
        type: 'PERSONAL',
        members: {
          create: {
            userId: ws.ownerId,
            role: 'OWNER',
          },
        },
        deckInstances: {
          create: {
            deckAppId: 'coupang-ads',
            isActive: true,
          },
        },
      },
    })

    console.log(`  ✔ [${ws.name}] Space(${space.id}) 생성 완료`)
    created++
  }

  console.log(`\n✅ 백필 완료 — 생성: ${created}개, 건너뜀: ${skipped}개`)

  // 검증: Workspace 수 = Space 수 = DeckInstance 수
  const wsCount = await prisma.workspace.count()
  const spaceCount = await prisma.space.count()
  const instanceCount = await prisma.deckInstance.count()

  console.log(`\n🔍 검증`)
  console.log(`  Workspace: ${wsCount}`)
  console.log(`  Space:     ${spaceCount}`)
  console.log(`  DeckInstance: ${instanceCount}`)

  if (wsCount === spaceCount && spaceCount === instanceCount) {
    console.log('  ✅ 수량 일치')
  } else {
    console.warn('  ⚠️  수량 불일치 — 수동 확인 필요')
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
