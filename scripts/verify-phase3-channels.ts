import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { config } from 'dotenv'

config({ path: '.env.local', override: true })

async function main() {
  const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL
  if (!connectionString) throw new Error('DIRECT_URL 또는 DATABASE_URL 필요')

  const adapter = new PrismaPg({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 1,
  })
  const prisma = new PrismaClient({ adapter })

  const r1 = await prisma.invMovement.count({ where: { channelId: { not: null } } })
  const r2 = await prisma.delOrder.count({ where: { channelId: { not: null } } })
  console.log('InvMovement with channelId:', r1)
  console.log('DelOrder with channelId:', r2)
  await prisma.$disconnect()
}

main().catch(console.error)
