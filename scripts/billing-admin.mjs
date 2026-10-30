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
  ssl: { rejectUnauthorized: false },
})

const [cmd, ...args] = process.argv.slice(2)

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
        SELECT s."spaceId", sp.name AS space_name, s.status, s."trialEndsAt",
               s."currentPeriodEnd", s."retryCount", s."exemptFlag",
               (SELECT string_agg(i."deckAppId", ',') FROM "SubscriptionItem" i
                 WHERE i."subscriptionId" = s.id AND i.status IN ('ACTIVE','CANCEL_AT_PERIOD_END')) AS decks
        FROM "SpaceSubscription" s JOIN "Space" sp ON sp.id = s."spaceId"
        ORDER BY s."updatedAt" DESC`)
      console.log('\n── 구독 현황 ──')
      console.table(subs.rows)

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
        // 이전 고객도 무료는 일반 고객과 같은 7일 체험(TRIAL_DAYS)뿐 — 보장가가 곧 프로모션.
        // 체험 이력(trialEndsAt)이 없을 때만 지금부터 7일을 부여하고, 있으면 그대로 둔다(평생 1회).
        const sub = await client.query(
          `INSERT INTO "SpaceSubscription" (id, "spaceId", status, "trialEndsAt", "createdAt", "updatedAt")
           VALUES (gen_random_uuid()::text, $1, 'TRIALING', now() + interval '7 days', now(), now())
           ON CONFLICT ("spaceId") DO UPDATE SET
             "trialEndsAt" = CASE WHEN "SpaceSubscription"."trialEndsAt" IS NULL AND "SpaceSubscription".status = 'TRIALING'
                                  THEN EXCLUDED."trialEndsAt" ELSE "SpaceSubscription"."trialEndsAt" END,
             "updatedAt" = now()
           RETURNING id, status, "trialEndsAt"::text AS "trialEndsAtUtc"`,
          [spaceId]
        )
        const { id: subscriptionId } = sub.rows[0]
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
        console.table([{ ...sub.rows[0], ...item.rows[0] }])
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      }
      break
    }

    default:
      console.error(
        '알 수 없는 명령. status|exempt|unexempt|exempt-all-existing|pricing|price|migrate-grant'
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
