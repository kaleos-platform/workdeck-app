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
import 'dotenv/config'
import { config } from 'dotenv'
import pg from 'pg'

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
      const [spaceId, price = '12273'] = args
      const p = Number(price)
      if (!spaceId || !Number.isInteger(p) || p <= 0) {
        throw new Error('사용법: migrate-grant <spaceId> [보장공급가]')
      }
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
        await client.query('COMMIT')
        console.log(`✔ Space ${spaceId} 이전 혜택 부여`)
        console.table([{ ...sub.rows[0], ...access.rows[0], ...item.rows[0] }])
        const { trialEndsAtUtc } = access.rows[0] ?? {}
        const trialOver =
          !trialEndsAtUtc || new Date(`${trialEndsAtUtc.replace(' ', 'T')}Z`) <= new Date()
        if (trialOver) {
          console.log('⚠ 모집 체험 없음 또는 만료 — 면제·유예가 없다면 set-trial 또는 결제 필요')
        }
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
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

    default:
      console.error(
        '알 수 없는 명령. status|exempt|unexempt|exempt-all-existing|pricing|price|migrate-grant|set-trial|trial-all'
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
