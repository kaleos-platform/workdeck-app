#!/usr/bin/env node
// 결제 운영자 도구 (CLI). DATABASE_URL 환경변수 필요 — prod는 `vercel env pull` 후 실행.
//
// 사용법:
//   node scripts/billing-admin.mjs status                          # 구독 현황 전체
//   node scripts/billing-admin.mjs exempt <spaceId> [메모]         # Space 면제 설정
//   node scripts/billing-admin.mjs unexempt <spaceId>              # 면제 해제
//   node scripts/billing-admin.mjs exempt-all-existing [메모]      # 기존 전 Space 면제 백필
//                                                                  # (deck 유료 전환 전 실행 필수)
//   node scripts/billing-admin.mjs pricing <deckId> FREE_BETA|SUBSCRIPTION
//                                                                  # deck 과금 모드 전환
//                                                                  # (SUBSCRIPTION 전환 시 paidActivatedAt 기록 → 유예 14일 시작)
//   node scripts/billing-admin.mjs price <deckId> <월가(공급가)>    # deck 가격 변경
//   node scripts/billing-admin.mjs migrate-grant <spaceId> [보장공급가=12273]
//                                                                  # Opening 이전 고객: 모집 관리 보장가(lockedPrice, 실제 해지 시 소멸)
//                                                                  # 무료는 일반 고객과 같은 7일 체험뿐 — 이력이 있으면 연장하지 않음
//   node scripts/billing-admin.mjs set-trial <spaceId> <종료일 YYYY-MM-DD>
//                                                                  # 모집 관리 체험 종료일(KST) 연장. 토스 결제 공백기 이전 고객 전용 — 결제 가능일+7일로 맞춘다
//   node scripts/billing-admin.mjs trial-all <종료일 YYYY-MM-DD> [--apply]
//                                                                  # 면제 아닌 업무별 체험 일괄 연장(기본 미리보기). BILLING_CHECKOUT_PAUSED 해제 직전에 실행
//   node scripts/billing-admin.mjs opening-trial <오프닝 brandId>|--all [--apply]
//                                                                  # 오프닝 이전 고객 모집 체험 = 오프닝 이용 종료일(KST)+7일(연장만, 기본 미리보기)
//                                                                  # OPENING_SOURCE_URL(+ 선택 OPENING_CA_FILE) 필요. KST 08:50~09:30(정기결제 cron)에는 --apply 거부
//   migrate-grant 는 같은 연장을 같은 트랜잭션에서 수행한다(--no-opening-trial 로 생략: 테스트·비오프닝 용도)
import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { config } from 'dotenv'
import pg from 'pg'
import { openingTrialEnd } from './lib/opening-trial-date.mjs'

config({ path: '.env.local', override: false })

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL 또는 DIRECT_URL 환경변수가 필요합니다')
  process.exit(1)
}

const client = new pg.Client({
  connectionString,
  ssl: ['localhost', '127.0.0.1', '[::1]'].includes(new URL(connectionString).hostname)
    ? false
    : { rejectUnauthorized: false },
})

const [cmd, ...args] = process.argv.slice(2)

// Date의 자동 날짜 보정(예: 2월 30일)을 허용하지 않는다.
function validateTrialDate(value) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value ?? '') ||
    !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value ||
    value.startsWith('0000')
  ) {
    throw new Error('실제 종료일 YYYY-MM-DD가 필요합니다')
  }
}

// a는 SpaceDeckAccess. 다른 업무를 유료 구독 중이어도 대상 체험은 연장할 수 있다.
const noPaidTarget = `NOT EXISTS (
  SELECT 1 FROM "SpaceSubscription" s JOIN "SubscriptionItem" i ON i."subscriptionId" = s.id
  WHERE s."spaceId" = a."spaceId" AND s.status IN ('ACTIVE', 'PAST_DUE')
    AND i.type = 'DECK' AND i."deckAppId" = a."deckAppId"
    AND i.status IN ('ACTIVE', 'CANCEL_AT_PERIOD_END')
)`

const OPENING_JOB_STATUSES = ['APPLIED', 'GRANTED', 'GRANT_MANUAL', 'HELD', 'DONE']

class OpeningAbort extends Error {}

const utcMs = (text) => new Date(`${text.replace(' ', 'T')}Z`).getTime()
const utcText = (date) => date.toISOString().slice(0, 19).replace('T', ' ') // 목표는 항상 정각(초 단위)

// 정기결제 cron(매일 00:00 UTC = 09:00 KST)은 Space 잠금 없이 예약을 바꾸므로 KST 08:50~09:30 은 피한다.
function inCronWindow(now) {
  const kst = new Date(now.getTime() + 9 * 3600_000)
  const minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes()
  return minutes >= 8 * 60 + 50 && minutes <= 9 * 60 + 30
}

// 오프닝 DB 를 READ ONLY 트랜잭션으로 연결해 fn(oc) 를 실행한다.
async function withOpening(fn) {
  const url = process.env.OPENING_SOURCE_URL
  if (!url) throw new Error('OPENING_SOURCE_URL 환경변수가 필요합니다')
  const u = new URL(url)
  let ssl
  if (['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) ssl = false
  else {
    // 원격 오프닝 DB 는 CA 검증 TLS 필수(자격 증명·구독 정보를 다룬다) — opening-migrate.ts 와 같은 기준
    if (!process.env.OPENING_CA_FILE)
      throw new Error('원격 OPENING_SOURCE_URL 은 OPENING_CA_FILE(CA 검증)이 필요합니다')
    u.searchParams.delete('sslmode')
    ssl = { ca: readFileSync(process.env.OPENING_CA_FILE, 'utf8'), rejectUnauthorized: true }
  }
  const oc = new pg.Client({ connectionString: u.toString(), ssl })
  await oc.connect()
  try {
    await oc.query('BEGIN READ ONLY')
    return await fn(oc)
  } finally {
    await oc.query('ROLLBACK').catch(() => {})
    await oc.end()
  }
}

// 오프닝 브랜드의 가장 늦은 유한 구독 종료(UTC 문자열). 없으면 null. space_id 는 브랜드 번호.
async function openingPeriodEnd(oc, brandId) {
  if (!/^\d+$/.test(brandId)) throw new Error(`오프닝 brandId 는 숫자여야 합니다: ${brandId}`)
  const r = await oc.query(
    `SELECT current_period_end_at::text AS end_at FROM pay_subscription
     WHERE space_id = $1 AND current_period_end_at < '9999-01-01'
     ORDER BY current_period_end_at DESC LIMIT 1`,
    [brandId]
  )
  return r.rows[0]?.end_at ?? null
}

// 호출자가 연 트랜잭션 안에서 실행한다(커밋·롤백은 호출자). 연장만 한다 — 새 종료가 더 늦을 때만 갱신.
// 중단 사유는 OpeningAbort 로 던진다. 반환: { skip, before, after, periodBefore, periodAfter, periodChanged }
async function extendOpeningTrial(db, { spaceId, brandId, openingEndUtc, runId }) {
  const target = openingTrialEnd(openingEndUtc)
  const locked = await db.query('SELECT id FROM "Space" WHERE id = $1 FOR UPDATE', [spaceId])
  if (locked.rowCount !== 1) throw new OpeningAbort(`Space ${spaceId} 없음`)
  const pending = await db.query(
    `SELECT 1 FROM "BillingCharge" WHERE "spaceId" = $1 AND status = 'PENDING' LIMIT 1`,
    [spaceId]
  )
  if (pending.rowCount) throw new OpeningAbort('PENDING 청구 있음')
  const access = await db.query(
    `SELECT id, "trialEndsAt"::text AS before FROM "SpaceDeckAccess"
     WHERE "spaceId" = $1 AND "deckAppId" = 'recruiting'`,
    [spaceId]
  )
  const sub = await db.query(
    `SELECT id, status, "currentPeriodEnd"::text AS "periodEnd" FROM "SpaceSubscription" WHERE "spaceId" = $1`,
    [spaceId]
  )
  const items = sub.rowCount
    ? (
        await db.query(
          `SELECT "deckAppId", "awaitingTrialEnd", "addedAt"::text AS "addedAt" FROM "SubscriptionItem"
           WHERE "subscriptionId" = $1 AND status <> 'ENDED'`,
          [sub.rows[0].id]
        )
      ).rows
    : []
  if (items.some((i) => !i.awaitingTrialEnd))
    throw new OpeningAbort('결제된 아이템 있음(유료 고객)')
  if (sub.rows[0]?.status === 'PAST_DUE') throw new OpeningAbort('구독 PAST_DUE')

  const before = access.rows[0]?.before ?? null
  const periodBefore = sub.rows[0]?.periodEnd ?? null
  const out = { skip: null, before, after: before, periodBefore, periodAfter: periodBefore }
  if (!before) return { ...out, skip: '체험 이력 없음', periodChanged: false }
  if (target.getTime() <= utcMs(before)) {
    return { ...out, skip: '현재 체험이 더 늦거나 같음', periodChanged: false }
  }
  const after = utcText(target)
  const upd = await db.query(
    `UPDATE "SpaceDeckAccess" SET "trialEndsAt" = $3::timestamp, "updatedAt" = now()
     WHERE id = $1 AND "trialEndsAt" = $2::timestamp`,
    [access.rows[0].id, before, after]
  )
  if (upd.rowCount !== 1) throw new OpeningAbort('체험 종료일이 동시에 바뀜')
  out.after = after

  // 예약 전용 구독이면 결제일 = 비-ENDED 예약 아이템 전체의 체험 종료일 최솟값(realignReservationOnly 와 같은 규칙)
  if (sub.rows[0]?.status === 'ACTIVE' && items.length > 0) {
    const ends = await db.query(
      `SELECT "deckAppId", "trialEndsAt"::text AS "trialEndsAt" FROM "SpaceDeckAccess"
       WHERE "spaceId" = $1 AND "trialEndsAt" IS NOT NULL`,
      [spaceId]
    )
    const byDeck = new Map(ends.rows.map((r) => [r.deckAppId, r.trialEndsAt]))
    const starts = items.map((i) => byDeck.get(i.deckAppId) ?? i.addedAt)
    const next = starts.reduce((a, b) => (utcMs(b) < utcMs(a) ? b : a))
    if (periodBefore === null || utcMs(next) !== utcMs(periodBefore)) {
      const r = await db.query(
        `UPDATE "SpaceSubscription" SET status = 'ACTIVE', "currentPeriodEnd" = $2::timestamp, "retryCount" = 0, "updatedAt" = now()
         WHERE id = $1 AND "currentPeriodEnd" IS NOT DISTINCT FROM $3::timestamp`,
        [sub.rows[0].id, next, periodBefore]
      )
      if (r.rowCount !== 1) throw new OpeningAbort('결제일이 동시에 바뀜')
      out.periodAfter = next
    }
  }
  out.periodChanged = out.periodAfter !== periodBefore
  await db.query(
    `INSERT INTO "AdminAuditLog" (id, "actorUserId", action, "targetType", "targetId", meta)
     VALUES (gen_random_uuid()::text, 'cli:billing-admin', 'billing.deck.trial.opening', 'spaceDeckAccess', $1, $2::jsonb)`,
    [
      `${spaceId}:recruiting`,
      JSON.stringify({
        runId,
        brandId,
        openingPeriodEndUtc: openingEndUtc,
        beforeTrialEndsAt: before,
        afterTrialEndsAt: out.after,
        beforePeriodEnd: periodBefore,
        afterPeriodEnd: out.periodAfter,
      }),
    ]
  )
  return out
}

async function main() {
  await client.connect()
  await client.query("SET TIME ZONE 'UTC'") // now() → timestamp(무tz) 캐스팅을 Prisma 기준(UTC)에 맞춤

  switch (cmd) {
    case 'status': {
      const products = await client.query(
        'SELECT id, "pricingMode", "monthlyPrice", "paidActivatedAt" FROM "BillingDeckProduct" ORDER BY "monthlyPrice" DESC'
      )
      console.log('\n── Deck 과금 모드 ──')
      console.table(products.rows)

      const subs = await client.query(`
        SELECT s."spaceId", sp.name AS space_name, s.status, s."trialEndsAt" AS "legacyTrialEndsAt",
               s."currentPeriodEnd", s."retryCount", s."exemptFlag",
               (SELECT string_agg(i."deckAppId", ',') FROM "SubscriptionItem" i
                 WHERE i."subscriptionId" = s.id AND i.status IN ('ACTIVE','CANCEL_AT_PERIOD_END')) AS decks
        FROM "SpaceSubscription" s JOIN "Space" sp ON sp.id = s."spaceId"
        ORDER BY s."updatedAt" DESC`)
      console.log('\n── 구독 현황 (legacyTrialEndsAt은 호환 기록) ──')
      console.table(subs.rows)

      const policies = await client.query(`
        SELECT a."spaceId", sp.name AS space_name, a."deckAppId", a."trialEndsAt",
               a."exemptFlag", a."exemptNote", COALESCE(s."exemptFlag", false) AS "spaceExemptFlag"
        FROM "SpaceDeckAccess" a JOIN "Space" sp ON sp.id = a."spaceId"
        LEFT JOIN "SpaceSubscription" s ON s."spaceId" = a."spaceId"
        ORDER BY a."spaceId", a."deckAppId"`)
      console.log('\n── 업무별 체험·면제 (접근 정책) ──')
      console.table(policies.rows)

      const locked = await client.query(`
        SELECT s."spaceId", i."deckAppId", i.status, i."lockedPrice"
        FROM "SubscriptionItem" i JOIN "SpaceSubscription" s ON s.id = i."subscriptionId"
        WHERE i."lockedPrice" IS NOT NULL ORDER BY s."spaceId"`)
      console.log('\n── 보장가(lockedPrice) 보유 아이템 ──')
      console.table(locked.rows)

      const charges = await client.query(`
        SELECT "orderId", amount, status, "failReason", "createdAt"
        FROM "BillingCharge" ORDER BY "createdAt" DESC LIMIT 20`)
      console.log('\n── 최근 결제 20건 ──')
      console.table(charges.rows)
      break
    }

    case 'exempt': {
      const [spaceId, note] = args
      if (!spaceId) throw new Error('spaceId가 필요합니다')
      await client.query(
        `INSERT INTO "SpaceSubscription" (id, "spaceId", status, "exemptFlag", "exemptNote", "createdAt", "updatedAt")
         VALUES (gen_random_uuid()::text, $1, 'TRIALING', true, $2, now(), now())
         ON CONFLICT ("spaceId") DO UPDATE SET "exemptFlag" = true, "exemptNote" = $2, "updatedAt" = now()`,
        [spaceId, note ?? '운영자 수동 면제']
      )
      console.log(`✔ Space ${spaceId} 면제 설정`)
      break
    }

    case 'unexempt': {
      const [spaceId] = args
      if (!spaceId) throw new Error('spaceId가 필요합니다')
      const r = await client.query(
        `UPDATE "SpaceSubscription" SET "exemptFlag" = false, "updatedAt" = now() WHERE "spaceId" = $1`,
        [spaceId]
      )
      console.log(`✔ Space ${spaceId} 면제 해제 (${r.rowCount}행)`)
      break
    }

    case 'exempt-all-existing': {
      const note = args[0] ?? `기존 사용자 백필 ${new Date().toISOString().slice(0, 10)}`
      const r = await client.query(
        `INSERT INTO "SpaceSubscription" (id, "spaceId", status, "exemptFlag", "exemptNote", "createdAt", "updatedAt")
         SELECT gen_random_uuid()::text, sp.id, 'TRIALING', true, $1, now(), now()
         FROM "Space" sp
         ON CONFLICT ("spaceId") DO UPDATE SET "exemptFlag" = true, "exemptNote" = $1, "updatedAt" = now()`,
        [note]
      )
      console.log(`✔ 기존 Space 전체 면제 백필 완료 (${r.rowCount}행)`)
      break
    }

    case 'pricing': {
      const [deckId, mode] = args
      if (!deckId || !['FREE_BETA', 'SUBSCRIPTION'].includes(mode)) {
        throw new Error('사용법: pricing <deckId> FREE_BETA|SUBSCRIPTION')
      }
      // SUBSCRIPTION 전환 시 paidActivatedAt 기록 (이미 있으면 유지 — 유예 재시작 방지)
      const r = await client.query(
        `UPDATE "BillingDeckProduct"
         SET "pricingMode" = $2::"DeckPricingMode",
             "paidActivatedAt" = CASE WHEN $2 = 'SUBSCRIPTION' THEN COALESCE("paidActivatedAt", now()) ELSE "paidActivatedAt" END,
             "updatedAt" = now()
         WHERE id = $1`,
        [deckId, mode]
      )
      if (r.rowCount === 0) throw new Error(`deck ${deckId} 없음`)
      console.log(`✔ ${deckId} → ${mode}${mode === 'SUBSCRIPTION' ? ' (유예 14일 시작)' : ''}`)
      break
    }

    case 'price': {
      const [deckId, price] = args
      const p = Number(price)
      if (!deckId || !Number.isInteger(p) || p < 0) throw new Error('사용법: price <deckId> <월가>')
      const r = await client.query(
        `UPDATE "BillingDeckProduct" SET "monthlyPrice" = $2, "updatedAt" = now() WHERE id = $1`,
        [deckId, p]
      )
      if (r.rowCount === 0) throw new Error(`deck ${deckId} 없음`)
      console.log(
        `✔ ${deckId} 월가 → ₩${p.toLocaleString('ko-KR')} (공급가, 다음 청구부터 신규 구독에 적용)`
      )
      break
    }

    case 'migrate-grant': {
      const flags = args.filter((a) => a.startsWith('--'))
      const [spaceId, price = '12273'] = args.filter((a) => !a.startsWith('--'))
      const p = Number(price)
      if (
        !spaceId ||
        !Number.isInteger(p) ||
        p <= 0 ||
        flags.some((f) => f !== '--no-opening-trial')
      ) {
        throw new Error('사용법: migrate-grant <spaceId> [보장공급가] [--no-opening-trial]')
      }
      const skipOpening = flags.includes('--no-opening-trial')
      let opening = null
      await client.query('BEGIN')
      try {
        const sub = await client.query(
          `INSERT INTO "SpaceSubscription" (id, "spaceId", status, "createdAt", "updatedAt")
           VALUES (gen_random_uuid()::text, $1, 'TRIALING', now(), now())
           ON CONFLICT ("spaceId") DO UPDATE SET "updatedAt" = now()
           RETURNING id, status`,
          [spaceId]
        )
        const { id: subscriptionId } = sub.rows[0]
        // 모집 업무의 첫 체험만 부여한다. 기존 이력은 만료·미시작 여부와 무관하게 보존한다.
        // 면제·무료 업무에는 새 체험을 소비하지 않는다. TRIAL_DAYS와 같은 7일.
        await client.query(
          `INSERT INTO "SpaceDeckAccess" (id, "spaceId", "deckAppId", "trialEndsAt", "createdAt", "updatedAt")
           SELECT gen_random_uuid()::text, $1, 'recruiting', now() + interval '7 days', now(), now()
           FROM "SpaceSubscription" s JOIN "BillingDeckProduct" p ON p.id = 'recruiting'
           WHERE s.id = $2 AND NOT s."exemptFlag" AND p."pricingMode" = 'SUBSCRIPTION'
           ON CONFLICT ("spaceId", "deckAppId") DO NOTHING`,
          [spaceId, subscriptionId]
        )
        const access = await client.query(
          `SELECT "deckAppId", "trialEndsAt"::text AS "trialEndsAtUtc", "exemptFlag"
           FROM "SpaceDeckAccess" WHERE "spaceId" = $1 AND "deckAppId" = 'recruiting'`,
          [spaceId]
        )
        // ENDED item 에 보장가를 심는다 → startSubscription/addDeck 이 재활성화하며 사용
        const item = await client.query(
          `INSERT INTO "SubscriptionItem" (id, "subscriptionId", type, "deckAppId", "priceSnapshot", "lockedPrice", status, "endedAt")
           VALUES (gen_random_uuid()::text, $1, 'DECK', 'recruiting', $2, $2, 'ENDED', now())
           ON CONFLICT ("subscriptionId", type, "deckAppId") DO UPDATE SET "lockedPrice" = $2
           RETURNING status, "priceSnapshot", "lockedPrice"`,
          [subscriptionId, p]
        )
        if (item.rows[0].status !== 'ENDED') {
          // 이미 구독 중: 다음 정기청구는 priceSnapshot 기준이라 보장가만 심으면 반영 안 됨
          throw new Error(`모집 관리가 이미 ${item.rows[0].status} — 수동 처리 필요 (변경 없음)`)
        }
        if (!skipOpening) {
          const now = process.env.BILLING_ADMIN_NOW
            ? new Date(process.env.BILLING_ADMIN_NOW)
            : new Date()
          if (Number.isNaN(now.getTime()) || inCronWindow(now))
            throw new Error('KST 08:50~09:30 은 정기결제 cron 시간대라 migrate-grant 를 거부합니다')
          // 같은 트랜잭션에서 체험을 오프닝 종료일+7일로 맞춘다. 오프닝 정보를 못 얻으면 전체 실패(조용히 7일로 남지 않음).
          const jobs = await client.query(
            `SELECT "openingBrandId" FROM "OpeningMigrationJob"
             WHERE "targetSpaceId" = $1 AND status = ANY($2::"OpeningMigrationStatus"[])`,
            [spaceId, OPENING_JOB_STATUSES]
          )
          if (jobs.rowCount !== 1) {
            throw new Error(
              `Space ${spaceId}: 대상 OpeningMigrationJob ${jobs.rowCount}건(1건 필요) — 변경 없음`
            )
          }
          const brandId = jobs.rows[0].openingBrandId
          opening = await withOpening(async (oc) => {
            const openingEndUtc = await openingPeriodEnd(oc, brandId)
            if (!openingEndUtc)
              throw new Error(`오프닝 브랜드 ${brandId}: 종료일 조회 불가 — 변경 없음`)
            return extendOpeningTrial(client, {
              spaceId,
              brandId,
              openingEndUtc,
              runId: randomUUID(),
            })
          })
        }
        await client.query('COMMIT')
        console.log(`✔ Space ${spaceId} 이전 혜택 부여`)
        if (skipOpening)
          console.log('⚠ --no-opening-trial: 오프닝 종료일 기준 체험 연장 생략(7일 기본 체험)')
        else
          console.log(
            `오프닝 종료일 기준 체험: ${opening.skip ? `SKIP(${opening.skip})` : `${opening.before} → ${opening.after}`}`
          )
        console.table([{ ...sub.rows[0], ...access.rows[0], ...item.rows[0] }])
        const { trialEndsAtUtc } = access.rows[0] ?? {}
        const trialOver =
          !trialEndsAtUtc || new Date(`${trialEndsAtUtc.replace(' ', 'T')}Z`) <= new Date()
        if (trialOver) {
          console.log('⚠ 모집 체험 없음 또는 만료 — 면제·유예가 없다면 set-trial 또는 결제 필요')
        }
      } catch (e) {
        await client.query('ROLLBACK')
        throw e instanceof OpeningAbort ? new Error(`체험 연장 중단 — ${e.message}`) : e
      }
      break
    }

    case 'set-trial': {
      const [spaceId, until] = args
      if (!spaceId) throw new Error('사용법: set-trial <spaceId> <종료일 YYYY-MM-DD>')
      validateTrialDate(until)
      // 기존 syntax는 모집 관리 전용. 시작된 체험만 KST 날짜 말일까지 연장한다.
      const res = await client.query(
        `UPDATE "SpaceDeckAccess" a
         SET "trialEndsAt" = (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'UTC', "updatedAt" = now()
         WHERE a."spaceId" = $1 AND a."deckAppId" = 'recruiting'
           AND a."trialEndsAt" IS NOT NULL
           AND (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Seoul') > now()
           AND a."trialEndsAt" < ((($2::date + 1)::timestamp AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'UTC')
           AND ${noPaidTarget}
           AND EXISTS (SELECT 1 FROM "SpaceSubscription" s JOIN "SubscriptionItem" i ON i."subscriptionId" = s.id
                       WHERE s."spaceId" = a."spaceId" AND i.type = 'DECK'
                         AND i."deckAppId" = 'recruiting' AND i."lockedPrice" IS NOT NULL)
         RETURNING "spaceId", "deckAppId", "trialEndsAt"::text AS "trialEndsAtUtc"`,
        [spaceId, until]
      )
      if (res.rowCount === 0) {
        throw new Error(
          `Space ${spaceId}: 변경 없음 — 시작된 모집 체험, 보장가(migrate-grant), 기존보다 늦은 미래 종료일, 대상 업무 유료 구독 없음이 필요합니다`
        )
      }
      console.log(`✔ Space ${spaceId} 체험 종료일 ${until}(KST)`)
      console.table(res.rows)
      break
    }

    case 'trial-all': {
      const [until, flag] = args
      validateTrialDate(until)
      if (flag && flag !== '--apply')
        throw new Error('사용법: trial-all <종료일 YYYY-MM-DD> [--apply]')
      // 면제·유료 구독·무료 업무를 제외하고, 시작된 업무별 체험만 연장한다.
      const end = `(($1::date + 1)::timestamp AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'UTC'`
      const future = await client.query(`SELECT ${end} > (now() AT TIME ZONE 'UTC') AS ok`, [until])
      if (!future.rows[0].ok) throw new Error(`${until}: 과거 종료일은 즉시 잠금이라 거부`)
      const where = `a."exemptFlag" = false AND a."trialEndsAt" IS NOT NULL AND a."trialEndsAt" < ${end}
        AND NOT EXISTS (SELECT 1 FROM "SpaceSubscription" s WHERE s."spaceId" = a."spaceId" AND s."exemptFlag")
        AND EXISTS (SELECT 1 FROM "BillingDeckProduct" p WHERE p.id = a."deckAppId" AND p."pricingMode" = 'SUBSCRIPTION')
        AND ${noPaidTarget}`
      if (flag !== '--apply') {
        const preview = await client.query(
          `SELECT "spaceId", "deckAppId", "trialEndsAt"::text AS "trialEndsAtUtc" FROM "SpaceDeckAccess" a WHERE ${where}`,
          [until]
        )
        console.log(`미리보기: ${preview.rowCount}개 업무 → ${until}(KST). 적용하려면 --apply`)
        console.table(preview.rows)
        break
      }
      const res = await client.query(
        `UPDATE "SpaceDeckAccess" a SET "trialEndsAt" = ${end}, "updatedAt" = now()
         WHERE ${where} RETURNING "spaceId", "deckAppId", "trialEndsAt"::text AS "trialEndsAtUtc"`,
        [until]
      )
      console.log(`✔ ${res.rowCount}개 업무 체험 종료일 ${until}(KST)`)
      console.table(res.rows)
      break
    }

    case 'opening-trial': {
      const [target, ...rest] = args
      if (
        !target ||
        rest.some((a) => a !== '--apply') ||
        (target !== '--all' && !/^\d+$/.test(target))
      ) {
        throw new Error('사용법: opening-trial <오프닝 brandId>|--all [--apply]')
      }
      const apply = rest.includes('--apply')
      const now = process.env.BILLING_ADMIN_NOW
        ? new Date(process.env.BILLING_ADMIN_NOW)
        : new Date()
      if (Number.isNaN(now.getTime())) throw new Error('BILLING_ADMIN_NOW 형식 오류')
      if (apply && inCronWindow(now)) {
        throw new Error('KST 08:50~09:30 은 정기결제 cron 시간대라 --apply 를 거부합니다')
      }
      const runId = randomUUID()
      const jobs = await client.query(
        `SELECT "openingBrandId" AS brand, "targetSpaceId" AS "spaceId" FROM "OpeningMigrationJob"
         WHERE "targetSpaceId" IS NOT NULL AND status = ANY($1::"OpeningMigrationStatus"[])
           AND ($2::text IS NULL OR "openingBrandId" = $2)
         ORDER BY "openingBrandId"`,
        [OPENING_JOB_STATUSES, target === '--all' ? null : target]
      )
      const rows = []
      if (target !== '--all' && jobs.rowCount === 0) {
        rows.push({ brand: target, result: 'SKIP:매핑된 이전 job 없음' })
      }
      await withOpening(async (oc) => {
        for (const { brand, spaceId } of jobs.rows) {
          const row = { brand, spaceId }
          rows.push(row)
          try {
            const openingEndUtc = await openingPeriodEnd(oc, brand)
            row.openingEndUtc = openingEndUtc
            if (!openingEndUtc) {
              row.result = 'SKIP:오프닝 유한 종료일 없음'
              continue
            }
            await client.query('BEGIN')
            try {
              const r = await extendOpeningTrial(client, {
                spaceId,
                brandId: brand,
                openingEndUtc,
                runId,
              })
              Object.assign(row, {
                before: r.before,
                after: r.after,
                periodChanged: r.periodChanged,
                result: r.skip ? `SKIP:${r.skip}` : apply ? 'UPDATED' : 'PREVIEW',
              })
              await client.query(apply ? 'COMMIT' : 'ROLLBACK')
            } catch (e) {
              await client.query('ROLLBACK')
              throw e
            }
          } catch (e) {
            row.result = `ABORT:${e.message}`
            process.exitCode = 1
          }
        }
      })
      console.log(`opening-trial ${apply ? '적용' : '미리보기(변경 없음)'} runId=${runId}`)
      console.table(rows)
      break
    }

    default:
      console.error(
        '알 수 없는 명령. status|exempt|unexempt|exempt-all-existing|pricing|price|migrate-grant|set-trial|trial-all|opening-trial'
      )
      process.exit(1)
  }
}

main()
  .catch((e) => {
    console.error(e.message)
    process.exit(1)
  })
  .finally(() => client.end())
