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

    default:
      console.error('알 수 없는 명령. status|exempt|unexempt|exempt-all-existing|pricing|price')
      process.exit(1)
  }
}

main()
  .catch((e) => {
    console.error(e.message)
    process.exit(1)
  })
  .finally(() => client.end())
