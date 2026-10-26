import 'server-only'
import type { PoolConfig } from 'pg'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

/** root key를 전송하는 연결은 공용 client와 분리하고 인증서 검증을 항상 강제한다. */
export function recoveryDatabaseConfig(
  env: Record<string, string | undefined> = process.env
): PoolConfig {
  try {
    const ca = env.RECOVERY_DB_CA_CERT?.replaceAll('\\n', '\n')
    if (!ca?.includes('-----BEGIN CERTIFICATE-----') || !ca.includes('-----END CERTIFICATE-----'))
      throw new Error()
    const project = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? '')
    if (project.protocol !== 'https:' || !/^[a-z0-9]+\.supabase\.co$/.test(project.hostname))
      throw new Error()
    const ref = project.hostname.split('.')[0]
    const url = new URL(env.DATABASE_URL ?? '')
    const direct = url.hostname === `db.${ref}.supabase.co`
    const pooler =
      url.hostname.endsWith('.pooler.supabase.com') &&
      decodeURIComponent(url.username).endsWith(`.${ref}`)
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || (!direct && !pooler))
      throw new Error()
    // connectionString을 전달하면 query의 host/user/ssl 옵션이 검증값을 덮어쓸 수 있다.
    // 검증한 authority의 필드만 직접 넘기고 query 옵션은 사용하지 않는다.
    const port = pooler && url.port === '5432' ? 6543 : Number(url.port || 5432)
    if (![5432, 6543].includes(port)) throw new Error()
    return {
      host: url.hostname,
      port,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.slice(1)),
      ssl: { rejectUnauthorized: true, ca },
      max: 1,
      connectionTimeoutMillis: 10000,
    }
  } catch {
    throw new Error('RECOVERY_DB_CONFIG_UNAVAILABLE')
  }
}

const holder = globalThis as unknown as { _recoveryPrisma?: PrismaClient }
// 환경/DB 접근은 실제 운영자 요청 시에만 한다. SQL·bind 값을 로깅하지 않는다.
export const recoveryPrisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    holder._recoveryPrisma ??= new PrismaClient({
      adapter: new PrismaPg(recoveryDatabaseConfig()),
      log: [],
    })
    const value = Reflect.get(holder._recoveryPrisma, property)
    return typeof value === 'function' ? value.bind(holder._recoveryPrisma) : value
  },
})
