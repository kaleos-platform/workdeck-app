import 'dotenv/config'
import { config } from 'dotenv'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

config({ path: '.env.local', override: true })

const connectionString = process.env['DIRECT_URL'] ?? process.env['DATABASE_URL']
if (!connectionString) throw new Error('DATABASE_URL 또는 DIRECT_URL 필요')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) } as never)

async function main() {
  console.log('채널 백필 사전 점검 시작')

  // 1) Inv/Del 동명 TRANSFER 충돌
  const conflicts = await prisma.$queryRaw<Array<{ spaceId: string; name: string; type: string }>>`
    SELECT isc."spaceId", isc.name, dsc.type
    FROM "InvSalesChannel" isc
    JOIN "DelSalesChannel" dsc
      ON dsc."spaceId"=isc."spaceId" AND dsc.name=isc.name
    WHERE dsc.type='TRANSFER';
  `
  if (conflicts.length > 0) {
    console.warn('[경고] TRANSFER 의미 충돌 (Inv 판매채널 + Del TRANSFER 동명):')
    console.table(conflicts)
    console.warn('→ 관리자와 리네이밍 협의 후 마이그레이션을 진행하세요.')
  } else {
    console.log('[OK] TRANSFER 충돌 없음')
  }

  // 2) 백필 규모 미리보기
  const invCount = await prisma.invSalesChannel.count()
  const delCount = await prisma.delSalesChannel.count()
  const movementCount = await prisma.invMovement.count({ where: { channelId: { not: null } } })
  const orderCount = await prisma.delOrder.count({ where: { channelId: { not: null } } })
  console.log(`[정보] InvSalesChannel: ${invCount}, DelSalesChannel: ${delCount}`)
  console.log(`[정보] 백필 대상: InvMovement ${movementCount}건, DelOrder ${orderCount}건`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
