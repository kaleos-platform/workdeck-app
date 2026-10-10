/**
 * 워커 토큰 발급·폐기·목록. 평문 토큰은 발급 시 1회만 출력한다.
 *   npx tsx scripts/security/worker-token.ts issue --space <spaceId> --name macmini-uisikjuui [--ttl-days 90]
 *   npx tsx scripts/security/worker-token.ts revoke --id <tokenId>
 *   npx tsx scripts/security/worker-token.ts list --space <spaceId>
 * 필요 env: DATABASE_URL
 */
import { config } from 'dotenv'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../src/generated/prisma/client'
import {
  generateWorkerToken,
  WORKER_TOKEN_DEFAULT_TTL_DAYS,
  workerTokenExpiry,
} from '../../src/lib/worker-auth'

config({ path: '.env.local' })

const [cmd, ...rest] = process.argv.slice(2)
function arg(name: string): string {
  const i = rest.indexOf(`--${name}`)
  const v = i >= 0 ? rest[i + 1] : undefined
  if (!v || v.startsWith('--')) throw new Error(`--${name} 필요`)
  return v
}

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL 필요')
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 1 }) })

async function main() {
  if (cmd === 'issue') {
    // 인자 검증을 모두 끝낸 뒤에만 토큰을 만든다 — 실패한 발급이 평문을 남기지 않게.
    const spaceId = arg('space')
    const name = arg('name')
    const ttlDays = rest.includes('--ttl-days')
      ? Number(arg('ttl-days'))
      : WORKER_TOKEN_DEFAULT_TTL_DAYS
    const expiresAt = workerTokenExpiry(ttlDays)
    const space = await prisma.space.findUnique({ where: { id: spaceId }, select: { name: true } })
    if (!space) throw new Error('Space 없음')
    const { token, tokenHash } = generateWorkerToken()
    const row = await prisma.workerToken.create({
      data: { spaceId, name, tokenHash, expiresAt },
      select: { id: true },
    })
    console.log(`발급: ${row.id} (${space.name}), 만료 ${expiresAt.toISOString()}`)
    console.log(`토큰(이번 한 번만 표시): ${token}`)
  } else if (cmd === 'revoke') {
    const res = await prisma.workerToken.updateMany({
      where: { id: arg('id'), revokedAt: null },
      data: { revokedAt: new Date() },
    })
    console.log(res.count === 1 ? '폐기됨' : '대상 없음(이미 폐기됐거나 없는 id)')
  } else if (cmd === 'list') {
    const rows = await prisma.workerToken.findMany({
      where: { spaceId: arg('space') },
      select: {
        id: true,
        name: true,
        createdAt: true,
        expiresAt: true,
        revokedAt: true,
        lastUsedAt: true,
      },
      orderBy: { createdAt: 'asc' },
    })
    console.table(rows)
  } else {
    throw new Error('사용법: issue | revoke | list')
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
