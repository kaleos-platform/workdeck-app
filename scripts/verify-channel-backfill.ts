import 'dotenv/config'
import { config } from 'dotenv'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

config({ path: '.env.local', override: true })

const connectionString = process.env['DIRECT_URL'] ?? process.env['DATABASE_URL']
if (!connectionString) throw new Error('DATABASE_URL 또는 DIRECT_URL 필요')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) } as never)

async function main() {
  console.log('채널 백필 사후 검증')

  const unmatchedMovements = await prisma.invMovement.count({
    where: { channelId: { not: null }, newChannelId: null },
  })
  const unmatchedOrders = await prisma.delOrder.count({
    where: { channelId: { not: null }, newChannelId: null },
  })

  console.log(`InvMovement 미매칭: ${unmatchedMovements}`)
  console.log(`DelOrder 미매칭: ${unmatchedOrders}`)

  if (unmatchedMovements > 0 || unmatchedOrders > 0) {
    console.error('[실패] 백필이 불완전합니다. 데이터 조사 필요')
    process.exit(1)
  } else {
    console.log('[성공] 백필 완료')
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
