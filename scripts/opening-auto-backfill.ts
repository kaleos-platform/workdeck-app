/**
 * 오프닝 자동 이전 job backfill — 이미 이전·결정된 브랜드를 job 행으로 1건 넣는다(이미 있으면 변경 없이 보고).
 * 쓰기 전에 원장(HiringMigrationRecord)과 대조한다: DONE 은 이 브랜드의 원장 행 Space 집합이 정확히 {space},
 * HELD/none 은 원장 행 0건이어야 한다. sourceRef 에는 브랜드 id 가 없어(["opening.work", table, id, occurrence])
 * 매장·직무 행의 암호화 스냅샷(sourceSpaceId)을 복호화해 판정한다 — ENCRYPTION_KEY* 가 필요하다.
 * 매장·직무가 하나도 없는 브랜드는 DONE 대조가 불가해 거부된다.
 * 기본은 dry-run이고 --apply 일 때만 쓴다. DIRECT_URL(대상 DB)은 환경변수로만 받는다.
 *
 *   DIRECT_URL=... npx tsx scripts/opening-auto-backfill.ts --brand 511 --space <spaceId> --status DONE
 *   DIRECT_URL=... npx tsx scripts/opening-auto-backfill.ts --brand 510 --space none --status HELD \
 *     --reason SIBLING_OF_511 --apply
 *
 * --close-job(별칭 --from-held): 수동 이전이 끝난 job 을 DONE 으로 닫는다(--status DONE, --space 필수·none 불가).
 * 대상은 (1) backfill 로 들어간 HELD 행(userId 없음), (2) MULTIPLE_OWNER_SPACES 로 막힌 BLOCKED 행이다.
 * 원장 대조는 DONE 과 같은 규칙이고, 조건부 updateMany(기존 status 포함)라 재실행해도 안전하다.
 * 이미 DONE 이면 EXISTS_DONE 으로 보고하되 targetSpaceId 가 --space 와 다르면 오류다.
 *   DIRECT_URL=... npx tsx scripts/opening-auto-backfill.ts --close-job --brand 510 --space <spaceId> \
 *     --status DONE --reason MOVED_AFTER_APPLY --apply
 */
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'
import { assertBackfillMatches, decideCloseJob } from '@/lib/hiring/migration/auto-job'
import { decodeMigrationSnapshot } from '@/lib/hiring/migration/ledger'
import { openingTlsConfig } from '@/lib/hiring/migration/opening-tls'

async function main() {
  const { values } = parseArgs({
    options: {
      brand: { type: 'string' },
      space: { type: 'string' },
      status: { type: 'string' },
      reason: { type: 'string' },
      apply: { type: 'boolean', default: false },
      'close-job': { type: 'boolean', default: false },
      'from-held': { type: 'boolean', default: false },
    },
  })
  const { brand, space, status, reason } = values
  if (
    !/^[1-9]\d{0,18}$/.test(brand ?? '') ||
    !/^(none|[A-Za-z0-9_-]+)$/.test(space ?? '') ||
    (status !== 'DONE' && status !== 'HELD') ||
    (reason !== undefined && !/^[A-Z][A-Z_0-9]{2,60}$/.test(reason))
  )
    throw Error('BACKFILL_ARGS_INVALID')
  const closeJob = values['close-job'] === true || values['from-held'] === true
  if (closeJob && (status !== 'DONE' || space === 'none')) throw Error('BACKFILL_ARGS_INVALID')
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
  try {
    const existing = await db.openingMigrationJob.findUnique({
      where: { openingBrandId: brand as string },
      select: {
        status: true,
        userId: true,
        blockReasons: true,
        targetSpaceId: true,
        summary: true,
      },
    })
    if (closeJob) {
      if (decideCloseJob(existing) === 'EXISTS_DONE') {
        if (existing?.targetSpaceId !== space) throw Error('CLOSE_JOB_TARGET_MISMATCH')
        return console.log(JSON.stringify({ status: 'EXISTS_DONE', brandId: brand }))
      }
    } else if (existing) return console.log(JSON.stringify({ status: 'EXISTS', brandId: brand }))
    if (
      space !== 'none' &&
      !(await db.space.findUnique({ where: { id: space }, select: { id: true } }))
    )
      throw Error('TARGET_SPACE_MISSING')
    // 원장 대조(읽기 전용). 불일치면 쓰기 거부.
    const records = await db.hiringMigrationRecord.findMany({
      where: {
        OR: [
          { sourceRef: { startsWith: '["opening.work","store",' } },
          { sourceRef: { startsWith: '["opening.work","position",' } },
        ],
      },
      select: { spaceId: true, sourceHash: true, sourceSnapshotEnc: true, sourceSnapshotIv: true },
    })
    const ledgerSpaces = new Set<string>()
    for (const record of records) {
      let snapshot: { sourceSpaceId?: string }
      try {
        snapshot = decodeMigrationSnapshot(record) as { sourceSpaceId?: string }
      } catch {
        throw Error('BACKFILL_LEDGER_UNREADABLE')
      }
      if (snapshot.sourceSpaceId === brand) ledgerSpaces.add(record.spaceId)
    }
    assertBackfillMatches(status, space as string, [...ledgerSpaces])
    if (!values.apply) return console.log(JSON.stringify({ status: 'DRY_RUN', brandId: brand }))
    if (closeJob) {
      const previousReason = (existing?.summary as { reason?: unknown } | null)?.reason
      const updated = await db.openingMigrationJob.updateMany({
        // 기존 status 를 조건에 넣어, 읽은 뒤 상태가 바뀌었으면 갱신하지 않는다.
        where: {
          openingBrandId: brand as string,
          status: existing?.status,
          ...(existing?.status === 'HELD'
            ? { userId: null }
            : { blockReasons: { has: 'MULTIPLE_OWNER_SPACES' } }),
        },
        data: {
          status: 'DONE',
          targetSpaceId: space as string,
          blockReasons: [],
          contactHitsEnc: null,
          contactHitsIv: null,
          summary: {
            ...(existing?.status === 'HELD' ? { backfilled: true } : {}),
            ...(reason ? { reason } : {}),
            previous: existing?.status,
            ...(previousReason ? { previousReason } : {}),
            closedAt: new Date().toISOString(),
          },
        },
      })
      if (updated.count !== 1) throw Error('CLOSE_JOB_UPDATE_FAILED')
      return console.log(JSON.stringify({ status: 'UPDATED', brandId: brand }))
    }
    await db.openingMigrationJob.create({
      data: {
        openingBrandId: brand as string,
        targetSpaceId: space === 'none' ? null : (space as string),
        status,
        summary: { backfilled: true, ...(reason ? { reason } : {}) },
      },
    })
    console.log(JSON.stringify({ status: 'CREATED', brandId: brand }))
  } finally {
    await db.$disconnect()
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : ''
  const code = /^[A-Z][A-Z_]{2,80}$/.test(message) ? message : 'OPENING_BACKFILL_FAILED'
  console.error(JSON.stringify({ status: 'BLOCKED', code }))
  process.exitCode = 1
})
