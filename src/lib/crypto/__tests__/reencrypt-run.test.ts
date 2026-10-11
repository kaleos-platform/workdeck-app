/** @jest-environment node */
import crypto from 'node:crypto'
import { encryptField } from '../field-crypto'
import { runReencrypt, type Delegate } from '../reencrypt-run'

const hex = () => crypto.randomBytes(32).toString('hex')
const K0 = hex()
const K1 = hex()
const targets = [
  { model: 'SlackInstallation', purpose: 'slack-token', pairs: [['botToken', 'botTokenIv']] },
] as const

function v0(plain: string) {
  const iv = crypto.randomBytes(16)
  const c = crypto.createCipheriv('aes-256-cbc', Buffer.from(K0, 'hex'), iv)
  return {
    botToken: c.update(plain, 'utf8', 'hex') + c.final('hex'),
    botTokenIv: iv.toString('hex'),
  }
}

function fakeDb(rows: Array<Record<string, string>>) {
  const updates: unknown[] = []
  const delegate: Delegate = {
    async findMany(args) {
      const a = args as { where?: Record<string, string>; cursor?: unknown }
      if (a.cursor) return []
      return rows
        .filter((r) => !a.where || Object.entries(a.where).every(([k, v]) => r[k] === v))
        .map((r, i) => ({ ...r, id: r.id ?? String(i) }))
    },
    async updateMany(args) {
      updates.push(args)
      return { count: 1 }
    },
  }
  return { db: { slackInstallation: delegate }, updates }
}

beforeEach(() => {
  process.env.ENCRYPTION_KEY = K0
  process.env.ENCRYPTION_KEY_V1 = K1
  process.env.ENCRYPTION_WRITE_VERSION = 'v1'
  delete process.env.ENCRYPTION_KEY_V1_ACTIVE_KID
})

const quiet = { log: () => {}, error: () => {} }
const appV1 = () => {
  const e = encryptField('slack-token', 'xoxb-app')
  return { id: 'app', botToken: e.encrypted, botTokenIv: e.iv }
}

test('I1: 틀린 K1 이면 쓰기 전에 중단', async () => {
  const { db, updates } = fakeDb([appV1(), { id: 'old', ...v0('xoxb-old') }])
  process.env.ENCRYPTION_KEY_V1 = hex()
  await expect(runReencrypt({ db, targets, apply: true, ...quiet })).rejects.toThrow('K1 검증 실패')
  expect(updates).toHaveLength(0)
})

test('I1: 검증할 v1 행이 없으면 중단, --k1-unverified 면 진행', async () => {
  const { db, updates } = fakeDb([{ id: 'old', ...v0('xoxb-old') }])
  await expect(runReencrypt({ db, targets, apply: true, ...quiet })).rejects.toThrow('K1 검증 불가')
  expect(updates).toHaveLength(0)
  await runReencrypt({ db, targets, apply: true, k1Unverified: true, ...quiet })
  expect(updates).toHaveLength(1)
})

test('정상: K1 검증 통과 후 v0 행만 갱신', async () => {
  const { db, updates } = fakeDb([appV1(), { id: 'old', ...v0('xoxb-old') }])
  const r = await runReencrypt({ db, targets, apply: true, ...quiet })
  expect(r.failed).toBe(0)
  expect(updates).toHaveLength(1)
})

test('I2: --apply 는 첫 복호화 실패에서 중단, 이후 쓰기 없음', async () => {
  process.env.ENCRYPTION_KEY = hex() // 틀린 K0
  const { db, updates } = fakeDb([
    appV1(),
    { id: 'a', botToken: 'zz', botTokenIv: '00'.repeat(16) },
    { id: 'b', ...v0('x') },
  ])
  await expect(runReencrypt({ db, targets, apply: true, ...quiet })).rejects.toThrow('중단')
  expect(updates).toHaveLength(0)
})

test('I2: dry-run 은 실패를 모두 세고 failed>0 을 돌려준다', async () => {
  const bad = { botToken: 'zz', botTokenIv: '00'.repeat(16) }
  const { db, updates } = fakeDb([appV1(), { id: 'a', ...bad }, { id: 'b', ...bad }])
  const r = await runReencrypt({ db, targets, apply: false, ...quiet })
  expect(r.failed).toBe(2)
  expect(updates).toHaveLength(0)
})
