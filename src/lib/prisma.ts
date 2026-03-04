// Prisma 7: PrismaPg 어댑터를 통해 PostgreSQL 연결
// DATABASE_URL 환경변수에서 연결 정보를 읽음
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

type PrismaInstance = InstanceType<typeof PrismaClient>

const globalForPrisma = globalThis as unknown as { _prisma: PrismaInstance }

function createPrismaClient(): PrismaInstance {
  const rawConnectionString =
    process.env.NODE_ENV === 'production'
      ? (process.env.DATABASE_URL ?? process.env.DIRECT_URL)
      : (process.env.DIRECT_URL ?? process.env.DATABASE_URL)
  if (!rawConnectionString) {
    throw new Error(
      '[prisma] DATABASE_URL 또는 DIRECT_URL 환경변수가 설정되지 않았습니다. .env.local 파일을 확인하세요.'
    )
  }

  // Supabase pooler를 Session mode(5432)로 사용하면 서버리스에서 max clients 에러가 자주 발생한다.
  // 프로덕션에서는 transaction mode(6543)로 보정해 연결 폭주를 완화한다.
  const connectionString = (() => {
    if (process.env.NODE_ENV !== 'production') return rawConnectionString
    try {
      const parsed = new URL(rawConnectionString)
      if (parsed.hostname.endsWith('.pooler.supabase.com') && parsed.port === '5432') {
        parsed.port = '6543'
        parsed.searchParams.set('pgbouncer', 'true')
        return parsed.toString()
      }
    } catch {
      return rawConnectionString
    }
    return rawConnectionString
  })()

  // Supabase 연결은 로컬/프로덕션 모두 SSL을 사용한다.
  const hostname = (() => {
    try {
      return new URL(connectionString).hostname
    } catch {
      return ''
    }
  })()
  const useSsl =
    process.env.NODE_ENV === 'production' ||
    hostname.endsWith('.supabase.co') ||
    hostname.endsWith('.pooler.supabase.com')
  const ssl = useSsl ? { rejectUnauthorized: false } : undefined

  // 서버리스 환경에서 커넥션 폭주를 막기 위해 풀 크기를 명시적으로 제한한다.
  const parsedPoolMax = Number(process.env.PRISMA_POOL_MAX)
  const max =
    Number.isInteger(parsedPoolMax) && parsedPoolMax > 0
      ? parsedPoolMax
      : process.env.NODE_ENV === 'production'
        ? 1
        : 10

  const adapter = new PrismaPg({
    connectionString,
    ssl,
    max,
  })
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
