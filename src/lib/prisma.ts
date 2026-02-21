// Prisma 7: PrismaPg 어댑터를 통해 PostgreSQL 연결
// DATABASE_URL 환경변수에서 연결 정보를 읽음
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

type PrismaInstance = InstanceType<typeof PrismaClient>

const globalForPrisma = globalThis as unknown as { _prisma: PrismaInstance }

function createPrismaClient(): PrismaInstance {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error(
      '[prisma] DATABASE_URL 환경변수가 설정되지 않았습니다. .env.local 파일을 확인하세요.'
    )
  }
  const adapter = new PrismaPg({ connectionString })
  return new PrismaClient({ adapter })
}

// 지연 초기화: 첫 접근 시에만 PrismaClient 생성
export const prisma: PrismaInstance = new Proxy({} as PrismaInstance, {
  get(_target, prop) {
    if (!globalForPrisma._prisma) {
      globalForPrisma._prisma = createPrismaClient()
    }
    const value = Reflect.get(globalForPrisma._prisma, prop)
    if (typeof value === 'function') {
      return value.bind(globalForPrisma._prisma)
    }
    return value
  },
})
