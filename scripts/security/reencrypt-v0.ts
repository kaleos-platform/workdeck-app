/**
 * 지금 쓰기 형식(v1 + 활성 키 ID)이 아닌 암호문(v0 CBC, 비활성 kid 의 v1)을 일괄 재암호화한다.
 * 멱등 — 이미 지금 형식인 행은 건너뛴다. v0 백필(Task 5 Step 6)이 쓰고, 향후 키 회전(계획 부록 런북)도 같은 스크립트를 쓴다.
 *
 * 실행(운영은 사람이 직접, 먼저 dry-run):
 *   npx tsx scripts/security/reencrypt-v0.ts            # dry-run: 건수만
 *   npx tsx scripts/security/reencrypt-v0.ts --apply    # 실제 갱신
 * 필요 env: DATABASE_URL, ENCRYPTION_KEY_V1(k1 루트), ENCRYPTION_KEY(v0 원키, v0 가 남아 있는 동안)
 *   회전 중이면 ENCRYPTION_KEY_V1_K2 와 ENCRYPTION_KEY_V1_ACTIVE_KID=k2 도.
 * 동시 수정 보호: 같은 암호문일 때만 갱신(updateMany where 원래 값).
 */
import { config } from 'dotenv'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../src/generated/prisma/client'
import { fieldWriteVersion } from '../../src/lib/crypto/field-crypto'
import { reencryptLegacyFields } from '../../src/lib/crypto/reencrypt'
import { REENCRYPT_TARGETS } from '../../src/lib/crypto/reencrypt-targets'

config({ path: '.env.local' })

// v0 쓰기 상태에서는 아무것도 바꾸지 않으므로 "v0 0행"이 거짓 완료로 보인다 — 아예 거부한다.
if (fieldWriteVersion() !== 'v1') throw new Error('ENCRYPTION_WRITE_VERSION=v1 에서만 실행합니다')

const APPLY = process.argv.includes('--apply')
const BATCH = 200

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL 필요')
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 3 }) })

type Delegate = {
  findMany(args: unknown): Promise<Array<Record<string, unknown> & { id: string }>>
  updateMany(args: unknown): Promise<{ count: number }>
}

async function main() {
  for (const target of REENCRYPT_TARGETS) {
    const key = target.model[0].toLowerCase() + target.model.slice(1)
    const delegate = (prisma as unknown as Record<string, Delegate>)[key]
    const select: Record<string, true> = { id: true }
    for (const [enc, iv] of target.pairs) {
      select[enc] = true
      select[iv] = true
    }

    let cursor: string | undefined
    let legacy = 0
    let updated = 0
    let plaintext = 0
    let failed = 0
    for (;;) {
      const rows = await delegate.findMany({
        select,
        orderBy: { id: 'asc' },
        take: BATCH,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      })
      if (rows.length === 0) break
      cursor = rows[rows.length - 1].id

      for (const row of rows) {
        plaintext += target.pairs.filter(([, iv]) => row[iv] === 'none').length
        let data: Record<string, string> | null
        try {
          data = reencryptLegacyFields(target.purpose, row, target.pairs)
        } catch (err) {
          failed += 1
          console.error(`[${target.model}] ${row.id} 복호화 실패: ${(err as Error).message}`)
          continue
        }
        if (!data) continue
        legacy += 1
        if (!APPLY) continue
        const where: Record<string, unknown> = { id: row.id }
        for (const [enc] of target.pairs) if (enc in data) where[enc] = row[enc]
        const res = await delegate.updateMany({ where, data })
        updated += res.count
      }
    }
    console.log(
      `${target.model}: 대상(v0·비활성 kid) ${legacy}행, 갱신 ${updated}행, 평문(iv=none) ${plaintext}칸, 실패 ${failed}행${APPLY ? '' : ' (dry-run)'}`
    )
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
