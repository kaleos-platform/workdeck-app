import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import test from 'node:test'
import pg from 'pg'

// 테스트는 지정한 전용 로컬 DB만 허용한다. .env의 운영 URL은 읽지 않는다.
const databaseUrl = process.env.BILLING_CLI_TEST_DATABASE_URL
const target = databaseUrl ? new URL(databaseUrl) : null
if (
  !target ||
  !['127.0.0.1', 'localhost'].includes(target.hostname) ||
  target.port !== '55471' ||
  target.pathname !== '/deck_trials'
) {
  throw new Error('BILLING_CLI_TEST_DATABASE_URL은 localhost:55471/deck_trials 전용 DB여야 합니다')
}
const client = new pg.Client({ connectionString: databaseUrl, ssl: false })
const prefix = `cli-trial-${randomUUID()}`
const deck = `${prefix}-paid`
const freeDeck = `${prefix}-free`
const spaces = []
const env = { ...process.env, DIRECT_URL: databaseUrl, DATABASE_URL: databaseUrl }
const run = (...args) =>
  execFileSync(process.execPath, ['scripts/billing-admin.mjs', ...args], { env, encoding: 'utf8' })
const reject = (...args) =>
  assert.notEqual(
    spawnSync(process.execPath, ['scripts/billing-admin.mjs', ...args], { env, encoding: 'utf8' })
      .status,
    0
  )
const until = '2098-02-28'
const end = '2098-02-28T15:00:00.000Z'

async function space(label, status = null, exempt = false) {
  const id = `${prefix}-${label}`
  spaces.push(id)
  await client.query('INSERT INTO "Space" (id, name, "updatedAt") VALUES ($1, $1, now())', [id])
  if (status)
    await client.query(
      `INSERT INTO "SpaceSubscription" (id, "spaceId", status, "exemptFlag", "updatedAt") VALUES ($1, $1, $2, $3, now())`,
      [id, status, exempt]
    )
  return id
}
async function policy(spaceId, deckId = deck, date = '2020-01-01', exempt = false) {
  await client.query(
    `INSERT INTO "SpaceDeckAccess" (id, "spaceId", "deckAppId", "trialEndsAt", "exemptFlag", "updatedAt") VALUES (gen_random_uuid()::text, $1, $2, $3, $4, now())`,
    [spaceId, deckId, date, exempt]
  )
}
async function trial(spaceId, deckId = deck) {
  const result = await client.query(
    `SELECT "trialEndsAt" AT TIME ZONE 'UTC' AS "trialEndsAt" FROM "SpaceDeckAccess" WHERE "spaceId" = $1 AND "deckAppId" = $2`,
    [spaceId, deckId]
  )
  return result.rows[0]?.trialEndsAt?.toISOString() ?? null
}
async function item(spaceId, deckId, status = 'ACTIVE', locked = null) {
  await client.query(
    `INSERT INTO "SubscriptionItem" (id, "subscriptionId", type, "deckAppId", "priceSnapshot", "lockedPrice", status) VALUES (gen_random_uuid()::text, $1, 'DECK', $2, 100, $3, $4)`,
    [spaceId, deckId, locked, status]
  )
}

test('billing-admin 덱별 체험 CLI 회귀', async (t) => {
  await client.connect()
  const recruiting = await client.query(
    `SELECT "pricingMode", "isActive" FROM "BillingDeckProduct" WHERE id = 'recruiting'`
  )
  try {
    // 기존 제품 설정을 보존하고 테스트에 필요한 유료 업무 상태만 임시 적용한다.
    await client.query(
      `INSERT INTO "BillingDeckProduct" (id, name, "monthlyPrice", "pricingMode", "isActive", "updatedAt")
       VALUES ('recruiting', '모집 관리 테스트', 100, 'SUBSCRIPTION', true, now())
       ON CONFLICT (id) DO UPDATE SET "pricingMode" = 'SUBSCRIPTION', "isActive" = true`
    )
    await client.query(
      `INSERT INTO "BillingDeckProduct" (id, name, "monthlyPrice", "pricingMode", "updatedAt") VALUES ($1, $1, 100, 'SUBSCRIPTION', now()), ($2, $2, 100, 'FREE_BETA', now())`,
      [deck, freeDeck]
    )
    await t.test(
      'migrate-grant는 모집 체험을 한 번만 만들고 레거시 날짜를 쓰지 않는다',
      async () => {
        const id = await space('migrate')
        run('migrate-grant', id)
        const first = await trial(id, 'recruiting')
        assert.ok(first)
        await client.query(
          `UPDATE "SpaceDeckAccess" SET "trialEndsAt" = '2020-01-01' WHERE "spaceId" = $1`,
          [id]
        )
        run('migrate-grant', id, '12345')
        assert.equal(await trial(id, 'recruiting'), '2020-01-01T00:00:00.000Z')
        const sub = await client.query(
          'SELECT "trialEndsAt" FROM "SpaceSubscription" WHERE "spaceId" = $1',
          [id]
        )
        assert.equal(sub.rows[0].trialEndsAt, null)
        const locked = await client.query(
          'SELECT "lockedPrice" FROM "SubscriptionItem" WHERE "subscriptionId" = (SELECT id FROM "SpaceSubscription" WHERE "spaceId" = $1)',
          [id]
        )
        assert.equal(locked.rows[0].lockedPrice, 12345)
      }
    )
    await t.test(
      'set-trial은 모집만 연장하고 단축·미시작·유료 target·보장가 없음·잘못된 날짜는 거절한다',
      async () => {
        const id = await space('set', 'ACTIVE')
        await policy(id, 'recruiting')
        await policy(id)
        await item(id, 'recruiting', 'ENDED', 12345)
        await item(id, deck)
        run('set-trial', id, until)
        assert.equal(await trial(id, 'recruiting'), end)
        assert.equal(await trial(id), '2020-01-01T00:00:00.000Z')
        reject('set-trial', id, until)
        reject('set-trial', id, '2097-01-01')
        reject('set-trial', id, '2099-02-29')
        reject('set-trial', id, '2020-01-01')
        await client.query(
          `UPDATE "SubscriptionItem" SET status = 'CANCEL_AT_PERIOD_END' WHERE "subscriptionId" = $1 AND "deckAppId" = 'recruiting'`,
          [id]
        )
        reject('set-trial', id, '2099-03-01')
        await client.query(
          `UPDATE "SubscriptionItem" SET status = 'ENDED', "lockedPrice" = NULL WHERE "subscriptionId" = $1 AND "deckAppId" = 'recruiting'`,
          [id]
        )
        reject('set-trial', id, '2099-03-01')
        await client.query(
          `UPDATE "SubscriptionItem" SET "lockedPrice" = 100 WHERE "subscriptionId" = $1 AND "deckAppId" = 'recruiting'`,
          [id]
        )
        await client.query(
          `UPDATE "SpaceDeckAccess" SET "trialEndsAt" = NULL WHERE "spaceId" = $1 AND "deckAppId" = 'recruiting'`,
          [id]
        )
        reject('set-trial', id, '2099-03-01')
      }
    )
    await t.test(
      'migrate-grant의 유료 아이템 거절은 체험·보장가 변경을 모두 롤백한다',
      async () => {
        const id = await space('migrate-paid', 'ACTIVE')
        await item(id, 'recruiting', 'ACTIVE', 99)
        reject('migrate-grant', id, '12345')
        assert.equal(await trial(id, 'recruiting'), null)
        const result = await client.query(
          'SELECT "lockedPrice" FROM "SubscriptionItem" WHERE "subscriptionId" = $1',
          [id]
        )
        assert.equal(result.rows[0].lockedPrice, 99)
      }
    )
    await t.test('기존 전체 면제 명령은 업무별 정책을 바꾸지 않는다', async () => {
      const id = await space('exempt')
      await policy(id, deck, '2020-01-01', true)
      run('exempt', id, '호환 면제')
      let result = await client.query(
        'SELECT "exemptFlag", "exemptNote" FROM "SpaceSubscription" WHERE "spaceId" = $1',
        [id]
      )
      assert.equal(result.rows[0].exemptFlag, true)
      assert.equal(result.rows[0].exemptNote, '호환 면제')
      run('unexempt', id)
      result = await client.query(
        'SELECT "exemptFlag" FROM "SpaceSubscription" WHERE "spaceId" = $1',
        [id]
      )
      assert.equal(result.rows[0].exemptFlag, false)
      result = await client.query(
        'SELECT "exemptFlag" FROM "SpaceDeckAccess" WHERE "spaceId" = $1',
        [id]
      )
      assert.equal(result.rows[0].exemptFlag, true)
      assert.equal(await trial(id), '2020-01-01T00:00:00.000Z')
    })
    await t.test(
      'trial-all은 미리보기이며 면제·무료·미시작·유료 target을 제외하고 업무별로 연장한다',
      async () => {
        const eligible = await space('eligible', 'ACTIVE')
        await policy(eligible)
        await policy(eligible, 'recruiting')
        await item(eligible, 'recruiting')
        const noSub = await space('no-sub')
        await policy(noSub)
        const globalExempt = await space('global-exempt', 'TRIALING', true)
        await policy(globalExempt)
        const deckExempt = await space('deck-exempt')
        await policy(deckExempt, deck, '2020-01-01', true)
        const unstarted = await space('unstarted')
        await policy(unstarted, deck, null)
        const free = await space('free')
        await policy(free, freeDeck)
        const later = await space('later')
        await policy(later, deck, '2099-01-01')
        const paid = await space('past-due', 'PAST_DUE')
        await policy(paid)
        await item(paid, deck, 'CANCEL_AT_PERIOD_END')
        const preview = run('trial-all', until)
        assert.ok(preview.includes(deck))
        assert.equal(await trial(eligible), '2020-01-01T00:00:00.000Z')
        run('trial-all', until, '--apply')
        assert.equal(await trial(eligible), end)
        assert.equal(await trial(noSub), end)
        for (const id of [globalExempt, deckExempt, paid])
          assert.equal(await trial(id), '2020-01-01T00:00:00.000Z')
        assert.equal(await trial(eligible, 'recruiting'), '2020-01-01T00:00:00.000Z')
        assert.equal(await trial(unstarted), null)
        assert.equal(await trial(free, freeDeck), '2020-01-01T00:00:00.000Z')
        assert.equal(await trial(later), '2099-01-01T00:00:00.000Z')
        reject('trial-all', '2099-02-29', '--apply')
        const status = run('status')
        assert.ok(status.includes('업무별 체험'))
        assert.ok(status.includes(deck))
      }
    )
  } finally {
    await client.query('DELETE FROM "Space" WHERE id = ANY($1::text[])', [spaces])
    await client.query('DELETE FROM "BillingDeckProduct" WHERE id = ANY($1::text[])', [
      [deck, freeDeck],
    ])
    if (recruiting.rowCount) {
      await client.query(
        `UPDATE "BillingDeckProduct" SET "pricingMode" = $1, "isActive" = $2 WHERE id = 'recruiting'`,
        [recruiting.rows[0].pricingMode, recruiting.rows[0].isActive]
      )
    } else {
      await client.query(`DELETE FROM "BillingDeckProduct" WHERE id = 'recruiting'`)
    }
    await client.end()
  }
})
