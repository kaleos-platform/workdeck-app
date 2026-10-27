/** @jest-environment node */
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { Client } from 'pg'
import { recoveryDatabaseConfig } from '../recovery-db'
jest.mock('server-only', () => ({}))

// 개발 DB의 합성 Vault 항목 하나만 사용하고 transaction 전체를 rollback한다.
test('실제 Vault에 합성 키를 암호화 보관·복호화하고 rollback 후 잔여 0건', async () => {
  const project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname.split('.')[0]
  if (project === 'duyteczbadcuvfeawlzu' || project !== process.env.VAULT_QA_ALLOWED_PROJECT) {
    throw new Error('VAULT_QA_REQUIRES_EXPLICIT_DEVELOPMENT_PROJECT')
  }
  const db = new Client(recoveryDatabaseConfig())
  const name = `workdeck.qa.recovery.${randomUUID()}`
  const synthetic = randomBytes(32).toString('hex')
  try {
    await db.connect()
    await db.query('BEGIN')
    await db.query("SELECT set_config('log_parameter_max_length_on_error','0',true)")
    const created = await db.query('SELECT vault.create_secret($1,$2,$3)::text AS id', [
      synthetic,
      name,
      'Rollback-only synthetic recovery QA',
    ])
    const rows = await db.query(
      'SELECT decrypted_secret AS value FROM vault.decrypted_secrets WHERE id=$1::uuid AND name=$2',
      [created.rows[0].id, name]
    )
    expect(rows.rows.length).toBe(1)
    expect(
      timingSafeEqual(Buffer.from(rows.rows[0].value, 'hex'), Buffer.from(synthetic, 'hex'))
    ).toBe(true)
    await db.query('ROLLBACK')
    expect(
      (await db.query('SELECT count(*)::int AS total FROM vault.secrets WHERE name=$1', [name]))
        .rows[0].total
    ).toBe(0)
  } finally {
    await db.query('ROLLBACK').catch(() => undefined)
    await db.end()
  }
}, 60000)
