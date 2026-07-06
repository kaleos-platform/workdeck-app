/**
 * migrate-opening.ts
 *
 * opening.work → workdeck 채용 데이터 1회성 이관 스크립트.
 * 특정 opening brand 의 최근 1년 데이터를 읽어 workdeck HiringXxx 모델로 upsert 한다.
 *
 * 실행:
 *   npx tsx prisma/scripts/migrate-opening.ts \
 *     --brand <openingBrandId> \
 *     --space <workdeckSpaceId> \
 *     [--dry-run] \
 *     [--since <ISO 날짜, 기본값: 오늘 - 365일>]
 *
 * 필수 환경변수: README-migrate-opening.md 참고
 */

import 'dotenv/config'
import { config } from 'dotenv'
import pg from 'pg'
import { PrismaClient, Prisma } from '../../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import {
  transformStore,
  transformPosition,
  transformPosting,
  transformPostingPosition,
  transformApplication,
  transformComment,
  transformBlacklist,
  transformMessageTemplate,
  deterministicUuid,
  type OpeningStoreRow,
  type OpeningPositionRow,
  type OpeningPostingRow,
  type OpeningPostingPositionRow,
  type OpeningApplicationRow,
  type OpeningCommentRow,
  type OpeningBlacklistRow,
  type OpeningMessageTemplateRow,
} from './lib/opening-transform'

// ─── 환경 로드 ────────────────────────────────────────────────────────────────

config({ path: '.env.local', override: true })

// ─── 안전 점검 ────────────────────────────────────────────────────────────────

const REQUIRED_ENV = [
  'OPENING_DATABASE_URL',
  'OPENING_SECRET_KEY',
  'OPENING_HMAC_KEY',
  'ENCRYPTION_KEY',
  'HIRING_HMAC_KEY',
] as const

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`❌ 필수 환경변수 누락: ${key}`)
    process.exit(1)
  }
}

// ─── 인자 파싱 ────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2)
  const get = (flag: string) => {
    const i = args.indexOf(flag)
    return i !== -1 ? args[i + 1] : undefined
  }
  const brandId = get('--brand')
  const spaceId = get('--space')
  const dryRun = args.includes('--dry-run')
  const sinceArg = get('--since')

  if (!brandId || !spaceId) {
    console.error('사용법: npx tsx prisma/scripts/migrate-opening.ts --brand <id> --space <id> [--dry-run] [--since <ISO>]')
    process.exit(1)
  }

  const since = sinceArg
    ? new Date(sinceArg)
    : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)

  if (isNaN(since.getTime())) {
    console.error(`❌ --since 날짜 형식 오류: ${sinceArg}`)
    process.exit(1)
  }

  return { brandId: Number(brandId), spaceId, dryRun, since }
}

// ─── Prisma (workdeck) 초기화 ─────────────────────────────────────────────────

const connectionString = process.env['DIRECT_URL'] ?? process.env['DATABASE_URL']
if (!connectionString) throw new Error('DATABASE_URL 또는 DIRECT_URL 환경변수가 필요합니다')

const adapter = new PrismaPg({ connectionString })
const prisma = new PrismaClient({ adapter } as never)

// ─── opening DB 클라이언트 ────────────────────────────────────────────────────

const openingPool = new pg.Pool({ connectionString: process.env.OPENING_DATABASE_URL })

// ─── 마스킹 로그 헬퍼 ────────────────────────────────────────────────────────

const mask = (s: string | null | undefined) =>
  s ? `${s.slice(0, 2)}${'*'.repeat(Math.max(0, s.length - 2))}` : '(없음)'

// ─── 카운터 ───────────────────────────────────────────────────────────────────

type Stats = {
  stores: number
  positions: number
  postings: number
  postingPositions: number
  postingStores: number
  applications: number
  comments: number
  blacklists: number
  messageTemplates: number
  skipped: number
}

// ─── 메인 ─────────────────────────────────────────────────────────────────────

async function main() {
  const { brandId, spaceId, dryRun, since } = parseArgs()

  console.log(`\n🚀 opening 이관 시작`)
  console.log(`  brand_id : ${brandId}`)
  console.log(`  spaceId  : ${spaceId}`)
  console.log(`  since    : ${since.toISOString()}`)
  console.log(`  dry-run  : ${dryRun}\n`)

  // ─── Space + DeckInstance 검증 ───────────────────────────────────────────

  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    include: { deckInstances: { where: { deckAppId: { startsWith: 'hiring' } } } },
  })

  if (!space) {
    console.error(`❌ Space(${spaceId}) 를 찾을 수 없습니다`)
    process.exit(1)
  }
  if (space.deckInstances.length === 0) {
    console.error(`❌ Space(${spaceId}) 에 hiring DeckInstance 가 없습니다 — 이관 대상 아님`)
    process.exit(1)
  }
  console.log(`✅ Space "${space.name}" (${spaceId}) 확인 완료\n`)

  const stats: Stats = {
    stores: 0, positions: 0, postings: 0, postingPositions: 0,
    postingStores: 0, applications: 0, comments: 0, blacklists: 0,
    messageTemplates: 0, skipped: 0,
  }

  // ─── store ───────────────────────────────────────────────────────────────

  console.log('📦 매장(store) 이관 중...')
  const storeRows = await openingPool.query<OpeningStoreRow>(`
    SELECT s.id, s.name, s.brand_id, s.status,
           a.road_address, a.original_addr2, a.zipcode
    FROM store s
    LEFT JOIN address a ON s.address_id = a.id
    WHERE s.brand_id = $1 AND s.status IN (0, 1)
  `, [brandId])

  // opening store.id → workdeck HiringStore.id 매핑
  const storeIdMap = new Map<number, string>()

  for (const row of storeRows.rows) {
    const input = transformStore(row)
    if (dryRun) {
      console.log(`  [dry] store "${input.name}"`)
      stats.stores++
      continue
    }
    const existing = await prisma.hiringStore.findFirst({
      where: { spaceId, name: input.name },
      select: { id: true },
    })
    let storeId: string
    if (existing) {
      storeId = existing.id
      await prisma.hiringStore.update({ where: { id: existing.id }, data: input })
    } else {
      const created = await prisma.hiringStore.create({ data: { spaceId, ...input } })
      storeId = created.id
      stats.stores++
    }
    storeIdMap.set(row.id, storeId)
  }
  console.log(`  → 매장 ${stats.stores}개 upsert\n`)

  // ─── position ────────────────────────────────────────────────────────────

  console.log('📦 직무(position) 이관 중...')
  const positionRows = await openingPool.query<OpeningPositionRow>(`
    SELECT p.id, p.name, p.brand_id, p.status, pc.name as category_name
    FROM position p
    LEFT JOIN position_category pc ON p.category_id = pc.id
    WHERE p.brand_id = $1 AND p.status IN (0, 1)
  `, [brandId])

  const positionIdMap = new Map<number, string>()

  for (const row of positionRows.rows) {
    const input = transformPosition(row)
    if (dryRun) {
      console.log(`  [dry] position "${input.name}"`)
      stats.positions++
      continue
    }
    const existing = await prisma.hiringPosition.findFirst({
      where: { spaceId, name: input.name },
      select: { id: true },
    })
    let posId: string
    if (existing) {
      posId = existing.id
      await prisma.hiringPosition.update({ where: { id: existing.id }, data: input })
    } else {
      const created = await prisma.hiringPosition.create({ data: { spaceId, ...input } })
      posId = created.id
      stats.positions++
    }
    positionIdMap.set(row.id, posId)
  }
  console.log(`  → 직무 ${stats.positions}개 upsert\n`)

  // ─── posting ─────────────────────────────────────────────────────────────

  console.log('📦 공고(posting) 이관 중...')
  // 윈도우 내 공고 + 윈도우 내 지원이 있는 오래된 공고 포함
  const postingRows = await openingPool.query<OpeningPostingRow>(`
    SELECT p.*
    FROM posting p
    WHERE p.brand_id = $1
      AND p.status != 0
      AND (
        p.created_at >= $2
        OR EXISTS (
          SELECT 1 FROM application a
          WHERE a.posting_id = p.id AND a.created_at >= $2
        )
      )
    ORDER BY p.created_at ASC
  `, [brandId, since])

  const postingIdMap = new Map<number, string>()

  for (const row of postingRows.rows) {
    const input = transformPosting(row)
    if (dryRun) {
      console.log(`  [dry] posting "${input.title}" (${input.uuid}) → ${input.status}`)
      stats.postings++
      continue
    }
    // uuid 가 idempotency 앵커
    const upserted = await prisma.hiringPosting.upsert({
      where: { uuid: input.uuid },
      create: {
        spaceId,
        uuid: input.uuid,
        title: input.title,
        status: input.status,
        detail: input.detail ?? undefined,
        applicationEntries: input.applicationEntries ?? undefined,
        closingDate: input.closingDate,
        publishedAt: input.publishedAt,
        notificationEnabled: input.notificationEnabled,
        authorUserId: input.authorUserId,
        managerNameEnc: input.managerNameEnc,
        managerNameIv: input.managerNameIv,
        managerPhoneEnc: input.managerPhoneEnc,
        managerPhoneIv: input.managerPhoneIv,
      },
      update: {
        title: input.title,
        status: input.status,
        detail: input.detail ?? undefined,
        applicationEntries: input.applicationEntries ?? undefined,
        closingDate: input.closingDate,
        publishedAt: input.publishedAt,
        notificationEnabled: input.notificationEnabled,
      },
    })
    postingIdMap.set(row.id, upserted.id)
    stats.postings++
  }
  console.log(`  → 공고 ${stats.postings}개 upsert\n`)

  // ─── posting_position ────────────────────────────────────────────────────

  if (postingIdMap.size > 0) {
    console.log('📦 공고 직무(posting_position) 이관 중...')
    const openingPostingIds = Array.from(postingIdMap.keys())
    const ppRows = await openingPool.query<OpeningPostingPositionRow>(`
      SELECT * FROM posting_position
      WHERE posting_id = ANY($1) AND status = 1
    `, [openingPostingIds])

    // opening posting_position.id → workdeck id 매핑 (application 조인용)
    const ppIdMap = new Map<number, string>()

    for (const row of ppRows.rows) {
      const wdPostingId = postingIdMap.get(row.posting_id)
      if (!wdPostingId) continue
      const wdPositionId = row.position_id ? positionIdMap.get(row.position_id) : undefined
      const input = transformPostingPosition(row)

      if (dryRun) {
        console.log(`  [dry] posting_position "${input.name}"`)
        stats.postingPositions++
        continue
      }
      // (postingId, name) 으로 upsert
      const existing = await prisma.hiringPostingPosition.findFirst({
        where: { postingId: wdPostingId, name: input.name },
        select: { id: true },
      })
      let ppId: string
      if (existing) {
        ppId = existing.id
        // workDays: number[] | null — Json? 컬럼에 null 은 Prisma.DbNull 로 전달
        const workDaysValue = input.workDays !== null
          ? input.workDays as Prisma.InputJsonValue
          : Prisma.DbNull
        await prisma.hiringPostingPosition.update({
          where: { id: existing.id },
          data: {
            ...input,
            workDays: workDaysValue,
            positionId: wdPositionId ?? null,
          },
        })
      } else {
        const workDaysValue = input.workDays !== null
          ? input.workDays as Prisma.InputJsonValue
          : Prisma.DbNull
        const created = await prisma.hiringPostingPosition.create({
          data: {
            spaceId,
            postingId: wdPostingId,
            positionId: wdPositionId ?? null,
            ...input,
            workDays: workDaysValue,
          },
        })
        ppId = created.id
        stats.postingPositions++
      }
      ppIdMap.set(row.id, ppId)
    }
    console.log(`  → 공고 직무 ${stats.postingPositions}개 upsert\n`)

    // ─── posting_store ─────────────────────────────────────────────────────

    console.log('📦 공고 매장 조인(posting_store) 이관 중...')
    const psRows = await openingPool.query<{ posting_id: number; store_id: number }>(`
      SELECT posting_id, store_id FROM posting_store
      WHERE posting_id = ANY($1)
    `, [openingPostingIds])

    for (const row of psRows.rows) {
      const wdPostingId = postingIdMap.get(row.posting_id)
      const wdStoreId = storeIdMap.get(row.store_id)
      if (!wdPostingId || !wdStoreId) continue
      if (dryRun) { stats.postingStores++; continue }
      await prisma.hiringPostingStore.upsert({
        where: { postingId_storeId: { postingId: wdPostingId, storeId: wdStoreId } },
        create: { postingId: wdPostingId, storeId: wdStoreId },
        update: {},
      })
      stats.postingStores++
    }
    console.log(`  → 공고 매장 조인 ${stats.postingStores}개 upsert\n`)

    // ─── application ───────────────────────────────────────────────────────

    console.log('📦 지원서(application) 이관 중...')
    let offset = 0
    const PAGE = 500

    while (true) {
      const applRows = await openingPool.query<OpeningApplicationRow>(`
        SELECT * FROM application
        WHERE posting_id = ANY($1)
          AND brand_id = $2
          AND created_at >= $3
        ORDER BY created_at ASC
        LIMIT $4 OFFSET $5
      `, [openingPostingIds, brandId, since, PAGE, offset])

      if (applRows.rows.length === 0) break

      for (const row of applRows.rows) {
        const wdPostingId = postingIdMap.get(row.posting_id)
        if (!wdPostingId) { stats.skipped++; continue }

        const input = transformApplication(row)
        const wdPpId = row.posting_position_id ? ppIdMap.get(row.posting_position_id) : undefined

        if (dryRun) {
          console.log(
            `  [dry] application ${row.id} → uuid=${input.uuid} ` +
            `이름=${mask(input.maskedName)} 단계=${input.stage}/${input.hiringStage}`
          )
          stats.applications++
          continue
        }

        await prisma.hiringApplication.upsert({
          where: { uuid: input.uuid },
          create: {
            spaceId,
            postingId: wdPostingId,
            postingPositionId: wdPpId ?? null,
            uuid: input.uuid,
            applicationEntries: (input.applicationEntries as unknown as Prisma.InputJsonValue) ?? undefined,
            nameEnc: input.nameEnc, nameIv: input.nameIv, nameHash: input.nameHash,
            maskedName: input.maskedName,
            phoneEnc: input.phoneEnc, phoneIv: input.phoneIv, phoneHash: input.phoneHash,
            phoneLastDigitsHash: input.phoneLastDigitsHash,
            emailEnc: input.emailEnc, emailIv: input.emailIv, emailHash: input.emailHash,
            addressEnc: input.addressEnc, addressIv: input.addressIv,
            stage: input.stage,
            hiringStage: input.hiringStage,
            referrer: input.referrer,
            directRegistration: input.directRegistration,
            duplicated: input.duplicated,
            memo: input.memo,
            privacyAgreedAt: input.privacyAgreedAt,
            canceledAt: input.canceledAt,
            deletedAt: input.deletedAt,
          },
          update: {
            stage: input.stage,
            hiringStage: input.hiringStage,
            memo: input.memo,
            canceledAt: input.canceledAt,
            deletedAt: input.deletedAt,
          },
        })
        stats.applications++
      }

      console.log(`  → 지원서 ${stats.applications}건 처리 (offset ${offset})`)
      offset += PAGE
      if (applRows.rows.length < PAGE) break
    }
    console.log(`  → 지원서 합계 ${stats.applications}건 upsert\n`)

    // ─── comment ───────────────────────────────────────────────────────────

    console.log('📦 코멘트(comment) 이관 중...')
    // source_id 가 opening application.id 이므로 posting_id 경유 조회
    const commentRows = await openingPool.query<OpeningCommentRow>(`
      SELECT c.* FROM comment c
      JOIN application a ON c.source_id = a.id AND c.source_type = 'application'
      WHERE a.posting_id = ANY($1)
        AND a.brand_id = $2
        AND a.created_at >= $3
    `, [openingPostingIds, brandId, since])

    // opening application.id → workdeck HiringApplication.id (uuid 경유)
    const applUuidMap = new Map<number, string>()
    for (const row of commentRows.rows) {
      if (!applUuidMap.has(row.source_id)) {
        const wdUuid = deterministicUuid(String(row.source_id))
        const found = await prisma.hiringApplication.findUnique({
          where: { uuid: wdUuid },
          select: { id: true },
        })
        if (found) applUuidMap.set(row.source_id, found.id)
      }
    }

    for (const row of commentRows.rows) {
      const wdApplId = applUuidMap.get(row.source_id)
      if (!wdApplId) { stats.skipped++; continue }

      const input = transformComment(row)
      if (dryRun) {
        console.log(`  [dry] comment ${row.id} → application ${row.source_id}`)
        stats.comments++
        continue
      }
      // opening comment.id 기반 결정론적 cuid 는 없으므로 content+createdAt 중복 방지 대신
      // (applicationId, userId, createdAt) 으로 조회해 없을 때만 삽입
      const exists = await prisma.hiringComment.findFirst({
        where: {
          applicationId: wdApplId,
          userId: input.userId,
          createdAt: row.created_at,
        },
        select: { id: true },
      })
      if (!exists) {
        await prisma.hiringComment.create({
          data: {
            spaceId,
            applicationId: wdApplId,
            userId: input.userId,
            content: input.content,
            editedAt: input.editedAt,
            deletedAt: input.deletedAt,
            createdAt: row.created_at,
          },
        })
        stats.comments++
      }
    }
    console.log(`  → 코멘트 ${stats.comments}개 upsert\n`)
  }

  // ─── blacklist ────────────────────────────────────────────────────────────

  console.log('📦 블랙리스트(blacklist) 이관 중...')
  const blRows = await openingPool.query<OpeningBlacklistRow>(`
    SELECT id, space_id, phone_enc, phone_hash, status
    FROM blacklist
    WHERE space_id = $1
  `, [brandId])

  for (const row of blRows.rows) {
    const input = transformBlacklist(row)
    if (!input) { stats.skipped++; continue }

    if (dryRun) {
      console.log(`  [dry] blacklist ${row.id}`)
      stats.blacklists++
      continue
    }
    // HiringBlacklist 는 (spaceId, phoneHash) 에 @unique 없음 — findFirst + create/update
    const existingBl = await prisma.hiringBlacklist.findFirst({
      where: { spaceId, phoneHash: input.phoneHash },
      select: { id: true },
    })
    if (existingBl) {
      await prisma.hiringBlacklist.update({
        where: { id: existingBl.id },
        data: { phoneEnc: input.phoneEnc, phoneIv: input.phoneIv, isActive: input.isActive },
      })
    } else {
      await prisma.hiringBlacklist.create({
        data: {
          spaceId,
          phoneEnc: input.phoneEnc,
          phoneIv: input.phoneIv,
          phoneHash: input.phoneHash,
          isActive: input.isActive,
        },
      })
    }
    stats.blacklists++
  }
  console.log(`  → 블랙리스트 ${stats.blacklists}개 upsert\n`)

  // ─── message_template ─────────────────────────────────────────────────────

  console.log('📦 메시지 템플릿(message_template) 이관 중...')
  const mtRows = await openingPool.query<OpeningMessageTemplateRow>(`
    SELECT id, brand_id, title, content, status, last_used_at
    FROM message_template
    WHERE brand_id = $1 AND status = 1
  `, [brandId])

  for (const row of mtRows.rows) {
    const input = transformMessageTemplate(row)
    if (!input) continue

    if (dryRun) {
      console.log(`  [dry] message_template "${input.title}"`)
      stats.messageTemplates++
      continue
    }
    const existing = await prisma.hiringMessageTemplate.findFirst({
      where: { spaceId, title: input.title },
      select: { id: true },
    })
    if (existing) {
      await prisma.hiringMessageTemplate.update({
        where: { id: existing.id },
        data: { content: input.content, lastUsedAt: input.lastUsedAt },
      })
    } else {
      await prisma.hiringMessageTemplate.create({
        data: { spaceId, ...input },
      })
      stats.messageTemplates++
    }
  }
  console.log(`  → 메시지 템플릿 ${stats.messageTemplates}개 upsert\n`)

  // ─── 완료 요약 ────────────────────────────────────────────────────────────

  console.log('─'.repeat(50))
  if (dryRun) {
    console.log('🔍 Dry-run 완료 — 실제 DB 변경 없음')
  } else {
    console.log('✅ 이관 완료')
  }
  console.log(`  매장              : ${stats.stores}`)
  console.log(`  직무              : ${stats.positions}`)
  console.log(`  공고              : ${stats.postings}`)
  console.log(`  공고 직무         : ${stats.postingPositions}`)
  console.log(`  공고 매장 조인    : ${stats.postingStores}`)
  console.log(`  지원서            : ${stats.applications}`)
  console.log(`  코멘트            : ${stats.comments}`)
  console.log(`  블랙리스트        : ${stats.blacklists}`)
  console.log(`  메시지 템플릿     : ${stats.messageTemplates}`)
  if (stats.skipped > 0) console.log(`  ⚠ 스킵(매핑실패) : ${stats.skipped}`)
}

main()
  .catch((e) => {
    console.error('❌ 이관 오류:', e)
    process.exit(1)
  })
  .finally(async () => {
    await openingPool.end()
    await prisma.$disconnect()
  })
