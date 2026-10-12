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
 * 안전장치(src/lib/crypto/reencrypt-run.ts):
 *   - 쓰기 전에 앱이 쓴 v1 행을 지금 K1 으로 복호화해 검증한다(틀린 K1 이면 중단). 검증할 v1 행이 전혀 없으면
 *     --k1-unverified 없이는 중단한다(틀린 K1 로 덮어쓴 CBC 원본은 복구 불가).
 *   - --apply 는 .env.local 을 읽지 않는다(키는 명시적 셸 환경에서만). --apply 에서 복호화 실패 1건이면 즉시 중단.
 *   - 실패가 하나라도 있으면 종료 코드 1.
 *   - --apply 는 용도별 키 env(ENCRYPTION_KEY_<PURPOSE>[_Kn])가 하나라도 있으면 거부한다(루트 K1 만 허용). 쓰기 전에 전체 행을 읽기 전용으로 K0 복호화해 본다.
 *   - --k1-unverified 는 빈 DB / 로컬 리허설 전용이다. 운영에서는 쓰지 않는다.
 * K0(ENCRYPTION_KEY) 삭제 조건: --apply 뒤 dry-run 이 모든 모델에서 "대상 0행, 실패 0행"이어야 한다.
 */
import { config } from 'dotenv'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../src/generated/prisma/client'
import { fieldWriteVersion } from '../../src/lib/crypto/field-crypto'
import { runReencrypt, type Delegate } from '../../src/lib/crypto/reencrypt-run'
import { REENCRYPT_TARGETS } from '../../src/lib/crypto/reencrypt-targets'

const APPLY = process.argv.includes('--apply')
if (!APPLY) config({ path: '.env.local' })

async function main() {
  // v0 쓰기 상태에서는 아무것도 바꾸지 않으므로 "v0 0행"이 거짓 완료로 보인다 — 아예 거부한다.
  if (fieldWriteVersion() !== 'v1') throw new Error('ENCRYPTION_WRITE_VERSION=v1 에서만 실행합니다')
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL 필요')
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 3 }) })
  try {
    const { failed } = await runReencrypt({
      db: prisma as unknown as Record<string, Delegate>,
      targets: REENCRYPT_TARGETS,
      apply: APPLY,
      k1Unverified: process.argv.includes('--k1-unverified'),
    })
    if (failed > 0) process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
})
