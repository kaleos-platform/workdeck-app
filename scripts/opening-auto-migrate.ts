/**
 * 오프닝 고객 자동 대조·이전 계획 워커(맥미니 launchd 1회 실행 후 종료). 이번 범위는 match·plan 처리기뿐이다.
 * 계획: docs/superpowers/plans/2026-11-18-opening-auto-migration.md
 *
 *   npx tsx scripts/opening-auto-migrate.ts          # match → plan(1건)
 *   npx tsx scripts/opening-auto-migrate.ts --dry    # DB·checked.json 쓰기 없이 할 일만 출력
 *
 * 비밀값은 환경변수로만 받는다: DIRECT_URL(워크덱 DB), OPENING_SOURCE_URL, OPENING_CA_FILE, MIGRATION_CA_FILE,
 * OPENING_HMAC_KEY, OPENING_AWS_PROFILE, ENCRYPTION_KEY*(contactHits 암호화).
 * stdout/stderr 에는 고정 코드·건수·job id 만 남긴다. 이메일·연락처·접속 정보는 출력하지 않는다.
 */
import { config } from 'dotenv'
if (!process.env.DATABASE_URL && !process.env.DIRECT_URL) config({ path: '.env.local' })

import { execFile } from 'node:child_process'
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs, promisify } from 'node:util'
import { PrismaPg } from '@prisma/adapter-pg'
import { Client } from 'pg'
import { Prisma, PrismaClient } from '@/generated/prisma/client'
import { encryptField } from '@/lib/crypto/field-crypto'
import {
  canTransition,
  emailHashVariants,
  pickTargetSpace,
  planMatches,
} from '@/lib/hiring/migration/auto-job'
import {
  MAX_ATTEMPTS,
  computePlan,
  fixedCode,
  planNext,
  type QueueJob,
} from '@/lib/hiring/migration/auto-plan'
import { runOpeningImport, safeMigrationSummary } from '@/lib/hiring/migration/opening-import'
import {
  assertOutDir,
  prepareOpeningCustomer,
  writeReviewDir,
} from '@/lib/hiring/migration/opening-prepare'
import { readPacketSet, readS3, writePacketSet } from '@/lib/hiring/migration/opening-run'
import { openingTlsConfig } from '@/lib/hiring/migration/opening-tls'

const run = promisify(execFile)
const repoRoot = resolve(__dirname, '..')
const ROOT = join(homedir(), '.local/share/workdeck/opening-migrations/auto')
const LOCK = join(ROOT, '.lock')
const CHECKED = join(ROOT, 'checked.json')
const SLACK_CHANNEL = 'C0APP3N44JZ'
// 이미 이전·결정된 브랜드(영구 기록 기준). 이 job 행이 모두 있어야 워커가 돈다.
const BACKFILL_BRANDS = ['1', '271', '378', '484', '511', '510']
const LOCK_STALE_MS = 30 * 60 * 1000

const { values: args } = parseArgs({ options: { dry: { type: 'boolean', default: false } } })
const dry = args.dry === true

const out = (record: Record<string, unknown>) => console.log(JSON.stringify(record))

// Slack 알림은 실패해도 워커를 멈추지 않는다. 메시지에는 브랜드 id·상태·건수·고정 코드만 싣는다.
async function notify(text: string) {
  if (dry) return
  try {
    await run('slack-post', ['--account', 'karls', '--channel', SLACK_CHANNEL, '--text', text])
  } catch {
    out({ status: 'SLACK_FAILED' })
  }
}

// 'LOCKED_LONG' = 30분 넘게 풀리지 않는 lock(알림 대상).
function acquireLock(): 'ACQUIRED' | 'LOCKED' | 'LOCKED_LONG' {
  mkdirSync(ROOT, { recursive: true, mode: 0o700 })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(LOCK, 'wx', 0o600)
      writeFileSync(fd, String(process.pid))
      closeSync(fd)
      return 'ACQUIRED'
    } catch {
      const heldMs = Date.now() - statSync(LOCK).mtimeMs
      const pid = Number(readFileSync(LOCK, 'utf8').trim())
      let stale: boolean
      if (Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0)
          stale = false
        } catch (error) {
          // EPERM 은 다른 사용자의 살아 있는 프로세스다.
          stale = (error as NodeJS.ErrnoException).code === 'ESRCH'
        }
      } else {
        // 빈·깨진 lock 은 쓰는 중일 수 있어 오래된 경우에만 회수한다.
        stale = heldMs > LOCK_STALE_MS
      }
      if (!stale) return heldMs > LOCK_STALE_MS ? 'LOCKED_LONG' : 'LOCKED'
      unlinkSync(LOCK)
    }
  }
  return 'LOCKED'
}

function readChecked(): Set<string> {
  if (!existsSync(CHECKED)) return new Set()
  try {
    const parsed: unknown = JSON.parse(readFileSync(CHECKED, 'utf8'))
    if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== 'string')) throw Error()
    return new Set(parsed as string[])
  } catch {
    throw Error('CHECKED_CORRUPT')
  }
}
// 임시 파일에 쓴 뒤 rename — 쓰는 중 종료돼도 기존 파일이 깨지지 않는다.
function writeChecked(ids: Set<string>) {
  const tmp = `${CHECKED}.tmp`
  writeFileSync(tmp, JSON.stringify([...ids]), { mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, CHECKED)
}

async function connectOpening() {
  const url = process.env.OPENING_SOURCE_URL
  if (!url) throw Error('OPENING_SOURCE_URL_REQUIRED')
  if (!process.env.OPENING_CA_FILE) throw Error('OPENING_CA_FILE_REQUIRED')
  const client = new Client(
    openingTlsConfig(url, readFileSync(process.env.OPENING_CA_FILE, 'utf8'))
  )
  // 유휴 연결 오류가 처리되지 않은 'error' 이벤트로 프로세스를 죽이거나 원문을 남기지 않게 한다. 다음 쿼리가 실패한다.
  client.on('error', () => {})
  try {
    await client.connect()
  } catch {
    throw Error('OPENING_DB_CONNECT_FAILED')
  }
  return client
}

async function matchUsers(db: PrismaClient) {
  const hmacKey = process.env.OPENING_HMAC_KEY
  if (!hmacKey) throw Error('OPENING_HMAC_KEY_REQUIRED')
  const checked = readChecked()
  const existing = await db.openingMigrationJob.findMany({
    select: { openingBrandId: true, userId: true },
  })
  const jobUsers = new Set(existing.flatMap((job) => (job.userId ? [job.userId] : [])))
  const users = (
    await db.$queryRaw<{ id: string; email: string }[]>`
      SELECT u.id, a.email FROM auth.users a JOIN "User" u ON u.id = a.id::text
      WHERE a.email_confirmed_at IS NOT NULL AND a.deleted_at IS NULL AND a.email IS NOT NULL`
  ).filter((user) => !checked.has(user.id) && !jobUsers.has(user.id))
  if (!users.length) return out({ status: 'MATCH_NONE' })

  const userByHash = new Map<string, string>()
  for (const user of users)
    for (const hash of emailHashVariants(user.email, hmacKey)) userByHash.set(hash, user.id)

  const client = await connectOpening()
  const brandsByUser = new Map<string, string[]>()
  try {
    await client.query('BEGIN READ ONLY')
    const { rows } = await client.query<{ email_hash: string; brand_id: string }>(
      `SELECT m.email_hash, bm.brand_id::text FROM member m
         JOIN brand_member bm ON bm.member_id = m.id
         JOIN brand b ON b.id = bm.brand_id
        WHERE m.email_hash = ANY($1) AND bm.member_type = 'admin' AND bm.status = 1
          AND m.status = 1 AND b.status = 1`,
      [[...userByHash.keys()]]
    )
    await client.query('ROLLBACK')
    for (const row of rows) {
      const userId = userByHash.get(row.email_hash)
      if (!userId) continue
      const brands = brandsByUser.get(userId) ?? []
      if (!brands.includes(row.brand_id)) brands.push(row.brand_id)
      brandsByUser.set(userId, brands)
    }
  } finally {
    await client.end().catch(() => {})
  }

  const plan = planMatches(users, brandsByUser, existing)
  if (dry)
    return out({
      status: 'MATCH_DRY',
      users: users.length,
      jobs: plan.creates.length,
      blocked: plan.blockExisting.length,
    })
  // openingBrandId unique 충돌은 이미 예약된 브랜드라 건너뛴다.
  const created = await db.openingMigrationJob.createMany({
    data: plan.creates,
    skipDuplicates: true,
  })
  // 이미 다른 사용자에게 예약된 브랜드는 기존 job 에 MULTI_USER 를 조건부로 추가한다(승인 이후 상태는 건드리지 않음).
  for (const openingBrandId of plan.blockExisting)
    await db.openingMigrationJob.updateMany({
      where: {
        openingBrandId,
        status: { in: ['MATCHED', 'PLANNED', 'BLOCKED'] },
        NOT: { blockReasons: { has: 'MULTI_USER' } },
      },
      data: { status: 'BLOCKED', blockReasons: { push: 'MULTI_USER' } },
    })
  for (const id of plan.checkedUserIds) checked.add(id)
  writeChecked(checked)
  out({
    status: 'MATCHED',
    users: users.length,
    jobs: created.count,
    blocked: plan.blockExisting.length,
  })
  if (created.count || plan.blockExisting.length)
    await notify(
      `[오프닝 이전] 신규 매칭 job ${created.count}건, 중복 사용자 차단 ${plan.blockExisting.length}건`
    )
}

async function targetFor(db: PrismaClient, userId: string) {
  const memberships = await db.spaceMember.findMany({
    where: { userId },
    select: {
      spaceId: true,
      role: true,
      createdAt: true,
      space: {
        select: {
          deckInstances: { where: { deckAppId: 'recruiting' }, select: { isActive: true } },
        },
      },
    },
  })
  return pickTargetSpace(
    memberships.map((member) => ({
      id: member.spaceId,
      role: member.role,
      memberSince: member.createdAt,
      recruitingActive: member.space.deckInstances.some((deck) => deck.isActive),
    }))
  )
}

async function planJob(db: PrismaClient, job: QueueJob, targetSpaceId: string | null) {
  const jobDir = join(ROOT, job.id)
  rmSync(jobDir, { recursive: true, force: true })
  mkdirSync(jobDir, { recursive: true, mode: 0o700 })
  const webOrigin = process.env.OPENING_WEB_URL ?? 'https://opening.work'
  const brandId = job.openingBrandId
  const packets = assertOutDir(join(jobDir, 'packets'), repoRoot)

  const client = await connectOpening()
  try {
    const result = await computePlan(
      {
        prepare: (review) => prepareOpeningCustomer(client, readS3, { brandId, webOrigin, review }),
        writePackets: (prepared) => writePacketSet(packets, prepared),
        dryRun: async (review) => {
          const report = await runOpeningImport(db, readPacketSet(packets), {
            spaceId: targetSpaceId as string,
            brandId,
            apply: false,
            readAsset: async (sha256) => readFileSync(join(packets, 'assets', sha256)),
            review,
          })
          return {
            conflicts:
              report.issues.conflicts.length || (report.status === 'CONFLICT_STOPPED' ? 1 : 0),
            refused: report.issues.refused.length,
            summary: safeMigrationSummary(report),
          }
        },
        targetHasData: async (spaceId) =>
          (await db.hiringPosting.count({ where: { spaceId } })) +
            (await db.hiringDetailTemplate.count({ where: { spaceId } })) >
          0,
      },
      {
        jobId: job.id,
        userId: job.userId,
        targetSpaceId,
        brandCount: 1,
        packetsDir: packets,
        today: new Date().toISOString().slice(0, 10),
      }
    )
    // 운영자 확인용 review 폴더와 승인 후보 review.json (DONE·HELD·FAILED 때 review 폴더 삭제)
    writeReviewDir(join(jobDir, 'review'), result.first.review)
    writeFileSync(join(jobDir, 'review.json'), JSON.stringify(result.review), { mode: 0o600 })
    const brandRows = (await client.query('SELECT name FROM brand WHERE id = $1', [brandId])).rows
    const brandName = String((brandRows[0] as { name?: string } | undefined)?.name ?? '')

    // 연락처 감지 항목: 제목 + 조각만 암호화 저장(운영자 전용)
    const sealed = result.fragments.length
      ? encryptField('pii', JSON.stringify(result.fragments))
      : null
    const next = result.blockReasons.length ? ('BLOCKED' as const) : ('PLANNED' as const)
    if (!canTransition(job.status, next)) throw Error('TRANSITION_DENIED')
    const summary = {
      brandName,
      prepare: safeMigrationSummary(result.prepared.summary),
      dryRun: result.dryRunSummary,
      warnings: result.warnings,
      snapshot: result.snapshot,
    }
    // 조건부 update: 그 사이 상태가 바뀌었으면 반영하지 않는다.
    const updated = await db.openingMigrationJob.updateMany({
      where: { id: job.id, status: job.status },
      data: {
        status: next,
        targetSpaceId,
        summary: summary as unknown as Prisma.InputJsonValue,
        blockReasons: result.blockReasons,
        contactHitsEnc: sealed?.encrypted ?? null,
        contactHitsIv: sealed?.iv ?? null,
        error: null,
      },
    })
    if (updated.count !== 1) throw Error('JOB_STATE_CHANGED')
    const counts = result.prepared.summary as unknown as {
      postings: { included: number }
      templates: { included: number }
    }
    out({ status: next, jobId: job.id, brandId, blockReasons: result.blockReasons })
    await notify(
      `[오프닝 이전] 브랜드 ${brandId} ${next} (공고 ${counts.postings.included}, 템플릿 ${counts.templates.included}, 차단 ${result.blockReasons.join(',') || '없음'})`
    )
  } finally {
    await client.end().catch(() => {})
  }
}

// 확정된(HELD·FAILED·DONE) job 의 연락처 원문 review 폴더를 지운다. packets 는 보관한다.
async function cleanupReviewDirs(db: PrismaClient) {
  const jobs = await db.openingMigrationJob.findMany({
    where: { status: { in: ['HELD', 'FAILED', 'DONE'] } },
    select: { id: true },
  })
  for (const { id } of jobs) rmSync(join(ROOT, id, 'review'), { recursive: true, force: true })
}

// 재시도 상한에 닿은 MATCHED 는 FAILED 로 옮겨 큐에서 조용히 사라지지 않게 한다.
async function failExhausted(db: PrismaClient) {
  const jobs = await db.openingMigrationJob.findMany({
    where: { status: 'MATCHED', attempts: { gte: MAX_ATTEMPTS } },
    select: { id: true, openingBrandId: true },
  })
  for (const job of jobs) {
    const result = await db.openingMigrationJob.updateMany({
      where: { id: job.id, status: 'MATCHED' },
      data: { status: 'FAILED', error: 'PLAN_RETRY_EXHAUSTED' },
    })
    if (result.count === 1) {
      out({ status: 'FAILED', jobId: job.id, code: 'PLAN_RETRY_EXHAUSTED' })
      await notify(`[오프닝 이전] 브랜드 ${job.openingBrandId} FAILED PLAN_RETRY_EXHAUSTED`)
    }
  }
}

async function planStep(db: PrismaClient) {
  const select = {
    id: true,
    userId: true,
    openingBrandId: true,
    status: true,
  } as const
  const toJob = (row: {
    id: string
    userId: string | null
    openingBrandId: string
    status: string
  }) => ({ ...row, userId: row.userId as string, status: row.status as QueueJob['status'] })
  const outcome = await planNext({
    nextMatched: async () => {
      const row = await db.openingMigrationJob.findFirst({
        where: { status: 'MATCHED', attempts: { lt: MAX_ATTEMPTS }, userId: { not: null } },
        orderBy: { createdAt: 'asc' },
        select,
      })
      return row ? toJob(row) : null
    },
    blockedRetries: async () =>
      (
        await db.openingMigrationJob.findMany({
          where: {
            status: 'BLOCKED',
            attempts: { lt: MAX_ATTEMPTS },
            userId: { not: null },
            blockReasons: { equals: ['NO_TARGET_SPACE'] },
          },
          orderBy: { updatedAt: 'asc' },
          take: 20,
          select,
        })
      ).map(toJob),
    targetFor: (userId) => targetFor(db, userId),
    // updatedAt 은 @updatedAt 이라 빈 갱신으로도 새로 찍힌다.
    touch: async (id) => {
      if (!dry) await db.openingMigrationJob.update({ where: { id }, data: { error: null } })
    },
    plan: async (job, target) => {
      if (dry) return out({ status: 'PLAN_DRY', jobId: job.id, brandId: job.openingBrandId })
      await planJob(db, job, target)
    },
    fail: async (job, code) => {
      if (!dry)
        await db.openingMigrationJob.update({
          where: { id: job.id },
          data: { error: code, attempts: { increment: 1 } },
        })
      out({ status: 'PLAN_FAILED', jobId: job.id, code })
      await notify(`[오프닝 이전] 브랜드 ${job.openingBrandId} 계획 실패 ${code}`)
    },
  })
  if (outcome.status === 'PLAN_NONE') out({ status: 'PLAN_NONE' })
}

async function main() {
  const url = process.env.DIRECT_URL
  if (!url) throw Error('DIRECT_URL_REQUIRED')
  const db = new PrismaClient({
    adapter: new PrismaPg(
      openingTlsConfig(
        url,
        process.env.MIGRATION_CA_FILE
          ? readFileSync(process.env.MIGRATION_CA_FILE, 'utf8')
          : undefined
      )
    ),
  })
  const lock = dry ? 'ACQUIRED' : acquireLock()
  if (lock !== 'ACQUIRED') {
    out({ status: 'LOCKED' })
    if (lock === 'LOCKED_LONG')
      await notify('[오프닝 이전] 워커 lock 이 30분 넘게 유지됨 LOCKED_LONG')
    return
  }
  try {
    const present = new Set(
      (
        await db.openingMigrationJob
          .findMany({
            where: { openingBrandId: { in: BACKFILL_BRANDS } },
            select: { openingBrandId: true },
          })
          .catch(() => {
            throw Error('WORKDECK_DB_FAILED')
          })
      ).map((job) => job.openingBrandId)
    )
    if (BACKFILL_BRANDS.some((brand) => !present.has(brand))) {
      out({ status: 'BLOCKED', code: 'BACKFILL_MISSING' })
      await notify('[오프닝 이전] 워커 중단 BACKFILL_MISSING')
      process.exitCode = 1
      return
    }
    if (!dry) {
      await cleanupReviewDirs(db)
      await failExhausted(db)
    }
    await matchUsers(db)
    await planStep(db)
  } finally {
    if (lock === 'ACQUIRED' && !dry) unlinkSync(LOCK)
    await db.$disconnect()
  }
}

main().catch(async (error) => {
  // 접속·검증 오류에 원문과 비밀정보가 섞일 수 있어 고정 코드만 출력·알림한다.
  const code = fixedCode(error)
  console.error(JSON.stringify({ status: 'BLOCKED', code }))
  await notify(`[오프닝 이전] 워커 실패 ${code}`)
  process.exitCode = 1
})
