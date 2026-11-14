/** @jest-environment node */
// 실제 migration SQL을 격리 schema에서 실행해 기존 체험 백필과 RLS를 검증한다.
import { config } from 'dotenv'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'
config({ path: '.env.local', quiet: true })
const connectionString = process.env.DATABASE_URL ?? ''
const RUN = /@(127\.0\.0\.1|localhost):55471\/deck_trials$/.test(connectionString)
const d = RUN ? describe : describe.skip

d('업무별 체험 migration 백필', () => {
  test('기존 설치 유료 업무만 종료일을 보존하고 전체 면제와 미설치 업무는 건드리지 않는다', async () => {
    const client = new Client({ connectionString })
    await client.connect()
    try {
      await client.query('BEGIN')
      const schema = `test_trial_backfill_${process.pid}`
      await client.query(`CREATE SCHEMA "${schema}"; SET LOCAL search_path TO "${schema}"`)
      await client.query(`
        CREATE TABLE "Space" (id text PRIMARY KEY);
        CREATE TABLE "BillingDeckProduct" (id text PRIMARY KEY, "pricingMode" text);
        CREATE TABLE "SpaceSubscription" ("spaceId" text, "trialEndsAt" timestamp(3), "exemptFlag" boolean);
        CREATE TABLE "DeckInstance" ("spaceId" text, "deckAppId" text, "isActive" boolean);
        INSERT INTO "Space" VALUES ('existing'), ('expired');
        INSERT INTO "BillingDeckProduct" VALUES ('finance', 'SUBSCRIPTION'), ('recruiting', 'SUBSCRIPTION'), ('free', 'FREE_BETA');
        INSERT INTO "SpaceSubscription" VALUES ('existing', '2030-01-01 12:34:56.123', true), ('expired', '2020-01-01', false);
        INSERT INTO "DeckInstance" VALUES ('existing', 'finance', true), ('existing', 'free', true), ('expired', 'finance', false);
      `)
      const sql = readFileSync(
        path.resolve('prisma/migrations/20261114053145_deck_trial_access/migration.sql'),
        'utf8'
      )
      await client.query(sql)
      const rows = await client.query(
        `SELECT "spaceId", "deckAppId", "trialEndsAt"::text, "exemptFlag" FROM "SpaceDeckAccess" ORDER BY "spaceId"`
      )
      expect(rows.rows).toEqual([
        {
          spaceId: 'existing',
          deckAppId: 'finance',
          trialEndsAt: '2030-01-01 12:34:56.123',
          exemptFlag: false,
        },
        {
          spaceId: 'expired',
          deckAppId: 'finance',
          trialEndsAt: '2020-01-01 00:00:00',
          exemptFlag: false,
        },
      ])
      const legacy = await client.query(
        `SELECT "exemptFlag" FROM "SpaceSubscription" WHERE "spaceId"='existing'`
      )
      expect(legacy.rows[0].exemptFlag).toBe(true)
      const rls = await client.query(
        `SELECT relrowsecurity FROM pg_class WHERE oid='"SpaceDeckAccess"'::regclass`
      )
      expect(rls.rows[0].relrowsecurity).toBe(true)
      const privileges = await client.query(
        `SELECT has_table_privilege('anon', '"SpaceDeckAccess"', 'SELECT') AS anon, has_table_privilege('authenticated', '"SpaceDeckAccess"', 'SELECT') AS authenticated`
      )
      expect(privileges.rows[0]).toEqual({ anon: false, authenticated: false })
    } finally {
      await client.query('ROLLBACK')
      await client.end()
    }
  })
})
