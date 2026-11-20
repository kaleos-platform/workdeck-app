import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import test from 'node:test'
import pg from 'pg'
import { openingTrialEnd } from '../lib/opening-trial-date.mjs'

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
const env = {
  ...process.env,
  DIRECT_URL: databaseUrl,
  DATABASE_URL: databaseUrl,
  // 실제 시각이 정기결제 cron 시간대여도 흔들리지 않게 기본은 그 밖(12:00 KST)
  BILLING_ADMIN_NOW: '2098-02-27T03:00:00Z',
}
const run = (...args) =>
  execFileSync(process.execPath, ['scripts/billing-admin.mjs', ...args], { env, encoding: 'utf8' })
const reject = (...args) =>
  assert.notEqual(
    spawnSync(process.execPath, ['scripts/billing-admin.mjs', ...args], { env, encoding: 'utf8' })
      .status,
    0
  )
// 오프닝 DB 도 같은 로컬 DB 의 가짜 pay_subscription 테이블로 대신한다.
const jobs = []
let brandSeq = 800_000_000_000 + Math.floor(Math.random() * 1e8) * 100
const runOpening = (args, extra = {}) =>
  spawnSync(process.execPath, ['scripts/billing-admin.mjs', ...args], {
    env: { ...env, OPENING_SOURCE_URL: databaseUrl, ...extra },
    encoding: 'utf8',
  })
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
async function item(spaceId, deckId, status = 'ACTIVE', locked = null, awaiting = false) {
  await client.query(
    `INSERT INTO "SubscriptionItem" (id, "subscriptionId", type, "deckAppId", "priceSnapshot", "lockedPrice", status, "awaitingTrialEnd") VALUES (gen_random_uuid()::text, $1, 'DECK', $2, 100, $3, $4, $5)`,
    [spaceId, deckId, locked, status, awaiting]
  )
}
// 오프닝 이전 job + 가짜 오프닝 구독 종료값(UTC 문자열, 여러 개 가능)을 만든다. 브랜드 번호를 돌려준다.
async function brandFor(spaceId, ends, status = 'DONE') {
  const brand = String((brandSeq += 1))
  const id = `${prefix}-job-${brand}`
  jobs.push({ id, brand })
  await client.query(
    `INSERT INTO "OpeningMigrationJob" (id, "openingBrandId", "targetSpaceId", status, "updatedAt") VALUES ($1, $2, $3, $4::"OpeningMigrationStatus", now())`,
    [id, brand, spaceId, status]
  )
  for (const end of ends) {
    await client.query(
      'INSERT INTO pay_subscription (space_id, status, current_period_end_at) VALUES ($1, $2, $3)',
      [brand, 'CANCELED', end]
    )
  }
  return brand
}
// 예약 전용 구독 하나(모집 관리 예약, 체험·결제일 지정)를 만든다.
async function reserved(label, trialDate, periodEnd = trialDate) {
  const id = await space(label, 'ACTIVE')
  await policy(id, 'recruiting', trialDate)
  await item(id, 'recruiting', 'ACTIVE', 12345, true)
  await client.query(
    `UPDATE "SpaceSubscription" SET "currentPeriodEnd" = $2, "retryCount" = 2 WHERE id = $1`,
    [id, periodEnd]
  )
  return id
}
async function period(spaceId) {
  const r = await client.query(
    `SELECT status, "retryCount", "currentPeriodEnd" AT TIME ZONE 'UTC' AS "end" FROM "SpaceSubscription" WHERE "spaceId" = $1`,
    [spaceId]
  )
  return { ...r.rows[0], end: r.rows[0].end?.toISOString() ?? null }
}
async function audits(spaceId) {
  const r = await client.query(
    `SELECT meta, "actorUserId", action, "targetType" FROM "AdminAuditLog" WHERE "targetId" = $1`,
    [`${spaceId}:recruiting`]
  )
  return r.rows
}
const OPENING_END = '2098-02-27 03:00:00' // KST 02-27 12:00 → 마지막 이용일 03-06 → 종료 03-07 00:00 KST
const NEW_END = '2098-03-06T15:00:00.000Z'

test('오프닝 종료 → 체험 종료 시각: KST 날짜 경계·월말·연말', () => {
  const iso = (text) => openingTrialEnd(text).toISOString()
  assert.equal(iso('2098-02-27 14:59:59'), '2098-03-06T15:00:00.000Z')
  assert.equal(iso('2098-02-27 15:00:00'), '2098-03-07T15:00:00.000Z')
  assert.equal(iso('2098-02-27 15:00:00.123'), '2098-03-07T15:00:00.000Z')
  assert.equal(iso('2098-11-30 03:00:00'), '2098-12-07T15:00:00.000Z')
  assert.equal(iso('2098-12-28 03:00:00'), '2099-01-04T15:00:00.000Z')
  assert.throws(() => openingTrialEnd('2098-02-27'))
})

test('billing-admin 덱별 체험 CLI 회귀', async (t) => {
  await client.connect()
  const hadPayTable =
    (await client.query(`SELECT to_regclass('pay_subscription') AS t`)).rows[0].t !== null
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
        run('migrate-grant', id, '--no-opening-trial')
        const first = await trial(id, 'recruiting')
        assert.ok(first)
        await client.query(
          `UPDATE "SpaceDeckAccess" SET "trialEndsAt" = '2020-01-01' WHERE "spaceId" = $1`,
          [id]
        )
        run('migrate-grant', id, '12345', '--no-opening-trial')
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
        reject('migrate-grant', id, '12345', '--no-opening-trial')
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
    await client.query(
      `CREATE TABLE IF NOT EXISTS pay_subscription (id bigserial, space_id bigint, status text, current_period_end_at timestamp)`
    )
    await t.test('opening-trial 미리보기는 아무것도 바꾸지 않는다', async () => {
      const id = await reserved('ot-preview', '2098-01-01')
      const brand = await brandFor(id, [OPENING_END])
      const out = runOpening(['opening-trial', brand])
      assert.equal(out.status, 0, out.stderr)
      assert.ok(out.stdout.includes('PREVIEW'))
      assert.equal(await trial(id, 'recruiting'), '2098-01-01T00:00:00.000Z')
      assert.equal((await period(id)).end, '2098-01-01T00:00:00.000Z')
      assert.equal((await audits(id)).length, 0)
    })
    await t.test(
      'opening-trial --apply 는 오프닝 종료 D+8 00:00 KST 로 연장하고 결제일·감사 기록을 남긴다',
      async () => {
        const id = await reserved('ot-apply', '2098-01-01')
        const brand = await brandFor(id, ['2097-12-01 00:00:00', OPENING_END])
        const out = runOpening(['opening-trial', brand, '--apply'])
        assert.equal(out.status, 0, out.stderr)
        assert.ok(out.stdout.includes('UPDATED'))
        assert.equal(await trial(id, 'recruiting'), NEW_END)
        const sub = await period(id)
        assert.deepEqual(sub, { status: 'ACTIVE', retryCount: 0, end: NEW_END })
        const logs = await audits(id)
        assert.equal(logs.length, 1)
        assert.equal(logs[0].actorUserId, 'cli:billing-admin')
        assert.equal(logs[0].action, 'billing.deck.trial.opening')
        assert.equal(logs[0].targetType, 'spaceDeckAccess')
        assert.equal(logs[0].meta.brandId, brand)
        assert.equal(logs[0].meta.openingPeriodEndUtc, OPENING_END)
        assert.equal(logs[0].meta.beforeTrialEndsAt, '2098-01-01 00:00:00')
        assert.equal(logs[0].meta.afterTrialEndsAt, '2098-03-06 15:00:00')
        assert.equal(logs[0].meta.beforePeriodEnd, '2098-01-01 00:00:00')
        assert.equal(logs[0].meta.afterPeriodEnd, '2098-03-06 15:00:00')
        assert.ok(logs[0].meta.runId)
        const again = runOpening(['opening-trial', brand, '--apply'])
        assert.equal(again.status, 0, again.stderr)
        assert.ok(again.stdout.includes('SKIP'))
        assert.equal((await audits(id)).length, 1)
      }
    )
    await t.test('opening-trial 은 더 이른 목표를 연장하지 않는다', async () => {
      const id = await reserved('ot-earlier', '2099-01-01')
      const brand = await brandFor(id, [OPENING_END])
      const out = runOpening(['opening-trial', brand, '--apply'])
      assert.equal(out.status, 0, out.stderr)
      assert.ok(out.stdout.includes('SKIP'))
      assert.equal(await trial(id, 'recruiting'), '2099-01-01T00:00:00.000Z')
      assert.equal((await audits(id)).length, 0)
    })
    await t.test(
      'opening-trial 은 9999 영구값을 제외하고 유한 종료가 없으면 건너뛴다',
      async () => {
        const id = await reserved('ot-9999', '2098-01-01')
        const brand = await brandFor(id, ['9999-12-31 00:00:00', OPENING_END])
        assert.equal(runOpening(['opening-trial', brand, '--apply']).status, 0)
        assert.equal(await trial(id, 'recruiting'), NEW_END)
        const only = await reserved('ot-9999-only', '2098-01-01')
        const onlyBrand = await brandFor(only, ['9999-12-31 00:00:00'])
        const out = runOpening(['opening-trial', onlyBrand, '--apply'])
        assert.equal(out.status, 0, out.stderr)
        assert.ok(out.stdout.includes('SKIP'))
        assert.equal(await trial(only, 'recruiting'), '2098-01-01T00:00:00.000Z')
      }
    )
    await t.test(
      'opening-trial 은 매핑이 없거나 대상 상태가 아닌 brand 를 건드리지 않는다',
      async () => {
        const none = runOpening(['opening-trial', String(brandSeq + 77)])
        assert.equal(none.status, 0, none.stderr)
        assert.ok(none.stdout.includes('SKIP'))
        const id = await reserved('ot-failed', '2098-01-01')
        const brand = await brandFor(id, [OPENING_END], 'FAILED')
        const out = runOpening(['opening-trial', brand, '--apply'])
        assert.equal(out.status, 0, out.stderr)
        assert.ok(out.stdout.includes('SKIP'))
        assert.equal(await trial(id, 'recruiting'), '2098-01-01T00:00:00.000Z')
        assert.equal(runOpening(['opening-trial', 'abc']).status === 0, false)
        const noUrl = spawnSync(
          process.execPath,
          ['scripts/billing-admin.mjs', 'opening-trial', brand],
          {
            env: { ...env, OPENING_SOURCE_URL: '' },
            encoding: 'utf8',
          }
        )
        assert.notEqual(noUrl.status, 0)
      }
    )
    await t.test(
      'opening-trial 은 결제된 아이템·PENDING 청구·PAST_DUE 를 ABORT 하고 변경하지 않는다',
      async () => {
        const paid = await reserved('ot-paid', '2098-01-01')
        await item(paid, deck, 'ACTIVE')
        const pending = await reserved('ot-pending', '2098-01-01')
        await client.query(
          `INSERT INTO "BillingCharge" (id, "spaceId", "orderId", amount, "supplyAmount", "vatAmount", status, provider, "periodStart", "periodEnd", breakdown, "updatedAt")
         VALUES (gen_random_uuid()::text, $1, $2, 110, 100, 10, 'PENDING', 'test', now(), now(), '[]', now())`,
          [pending, `${prefix}-order`]
        )
        const pastDue = await reserved('ot-pastdue', '2098-01-01')
        await client.query(
          `UPDATE "SpaceSubscription" SET status = 'PAST_DUE' WHERE "spaceId" = $1`,
          [pastDue]
        )
        for (const id of [paid, pending, pastDue]) {
          const brand = await brandFor(id, [OPENING_END])
          const out = runOpening(['opening-trial', brand, '--apply'])
          assert.equal(out.status, 1, id)
          assert.ok(out.stdout.includes('ABORT'), out.stdout)
          assert.equal(await trial(id, 'recruiting'), '2098-01-01T00:00:00.000Z')
          assert.equal((await audits(id)).length, 0)
        }
        assert.equal((await period(pastDue)).status, 'PAST_DUE')
      }
    )
    await t.test('opening-trial 은 다른 업무 예약이 더 이르면 결제일을 유지한다', async () => {
      const id = await reserved('ot-multi', '2098-01-20', '2098-01-15')
      await policy(id, deck, '2098-01-15')
      await item(id, deck, 'ACTIVE', null, true)
      const brand = await brandFor(id, [OPENING_END])
      const out = runOpening(['opening-trial', brand, '--apply'])
      assert.equal(out.status, 0, out.stderr)
      assert.equal(await trial(id, 'recruiting'), NEW_END)
      assert.deepEqual(await period(id), {
        status: 'ACTIVE',
        retryCount: 2,
        end: '2098-01-15T00:00:00.000Z',
      })
      assert.equal((await audits(id)).length, 1)
    })
    await t.test(
      'opening-trial --apply 는 정기결제 cron 시간대(KST 08:50~09:30)에 거부하고 미리보기는 허용한다',
      async () => {
        const id = await reserved('ot-cron', '2098-01-01')
        const brand = await brandFor(id, [OPENING_END])
        for (const now of [
          '2098-02-27T00:00:00Z',
          '2098-02-26T23:50:00Z',
          '2098-02-27T00:30:00Z',
        ]) {
          const out = runOpening(['opening-trial', brand, '--apply'], { BILLING_ADMIN_NOW: now })
          assert.notEqual(out.status, 0, now)
          assert.equal(await trial(id, 'recruiting'), '2098-01-01T00:00:00.000Z')
        }
        const preview = runOpening(['opening-trial', brand], {
          BILLING_ADMIN_NOW: '2098-02-27T00:00:00Z',
        })
        assert.equal(preview.status, 0, preview.stderr)
        const outside = runOpening(['opening-trial', brand, '--apply'], {
          BILLING_ADMIN_NOW: '2098-02-27T00:31:00Z',
        })
        assert.equal(outside.status, 0, outside.stderr)
        assert.equal(await trial(id, 'recruiting'), NEW_END)
      }
    )
    await t.test(
      'migrate-grant 는 체험을 오프닝 종료일 기준으로 맞추고 오프닝 정보가 없으면 롤백한다',
      async () => {
        const id = await space('mg-opening')
        await brandFor(id, [OPENING_END])
        const out = runOpening(['migrate-grant', id])
        assert.equal(out.status, 0, out.stderr)
        assert.equal(await trial(id, 'recruiting'), NEW_END)
        assert.equal((await audits(id)).length, 1)

        const noUrl = await space('mg-nourl')
        await brandFor(noUrl, [OPENING_END])
        const failed = spawnSync(
          process.execPath,
          ['scripts/billing-admin.mjs', 'migrate-grant', noUrl],
          {
            env: { ...env, OPENING_SOURCE_URL: '' },
            encoding: 'utf8',
          }
        )
        assert.notEqual(failed.status, 0)
        assert.ok(failed.stderr.includes('OPENING_SOURCE_URL'), failed.stderr)
        const noJob = await space('mg-nojob')
        assert.notEqual(runOpening(['migrate-grant', noJob]).status, 0)
        const empty = await space('mg-noend')
        await brandFor(empty, [])
        assert.notEqual(runOpening(['migrate-grant', empty]).status, 0)
        // 정기결제 cron 시간대 거부 · 원격 오프닝 DB 는 CA 필수
        const cron = await space('mg-cron')
        await brandFor(cron, [OPENING_END])
        assert.notEqual(
          runOpening(['migrate-grant', cron], { BILLING_ADMIN_NOW: '2098-02-27T00:00:00Z' }).status,
          0
        )
        const remote = await space('mg-remote')
        await brandFor(remote, [OPENING_END])
        const noCa = runOpening(['migrate-grant', remote], {
          OPENING_SOURCE_URL: 'postgresql://reader@opening.example.invalid:5432/opening',
          OPENING_CA_FILE: '',
        })
        assert.notEqual(noCa.status, 0)
        assert.ok(noCa.stderr.includes('OPENING_CA_FILE'), noCa.stderr)
        for (const rolled of [noUrl, noJob, empty, cron, remote]) {
          assert.equal(await trial(rolled, 'recruiting'), null)
          const subs = await client.query(
            'SELECT 1 FROM "SpaceSubscription" WHERE "spaceId" = $1',
            [rolled]
          )
          assert.equal(subs.rowCount, 0)
        }
      }
    )
  } finally {
    await client.query('DELETE FROM "AdminAuditLog" WHERE "targetId" LIKE $1', [`${prefix}%`])
    await client.query('DELETE FROM "OpeningMigrationJob" WHERE id = ANY($1::text[])', [
      jobs.map((j) => j.id),
    ])
    await client.query('DELETE FROM pay_subscription WHERE space_id = ANY($1::bigint[])', [
      jobs.map((j) => j.brand),
    ])
    if (!hadPayTable) await client.query('DROP TABLE IF EXISTS pay_subscription')
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
