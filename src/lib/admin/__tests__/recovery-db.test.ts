/** @jest-environment node */
import { recoveryDatabaseConfig } from '../recovery-db'
import { parse } from 'pg-connection-string'
jest.mock('server-only', () => ({}))
jest.mock('@/generated/prisma/client', () => ({ PrismaClient: jest.fn() }))
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: jest.fn() }))
const env = {
  DATABASE_URL:
    'postgresql://postgres.testproject:password@aws-1.pooler.supabase.com:5432/postgres?sslmode=no-verify&uselibpqcompat=true&sslcert=ignore',
  NEXT_PUBLIC_SUPABASE_URL: 'https://testproject.supabase.co',
  RECOVERY_DB_CA_CERT: '-----BEGIN CERTIFICATE-----\npublic-test-ca\n-----END CERTIFICATE-----',
}
test('전용 연결은 CA 검증을 강제하며 URL의 SSL override를 제거한다', () => {
  const cfg = recoveryDatabaseConfig(env)
  expect(cfg.ssl).toEqual({ rejectUnauthorized: true, ca: env.RECOVERY_DB_CA_CERT })
  expect(cfg.port).toBe(6543)
  expect(cfg.connectionString).toBeUndefined()
  expect(cfg.host).toBe('aws-1.pooler.supabase.com')
  expect(cfg.max).toBe(1)
})
test('CA가 없으면 root key를 다루는 연결을 만들지 않는다', () => {
  expect(() => recoveryDatabaseConfig({ ...env, RECOVERY_DB_CA_CERT: undefined })).toThrow(
    'RECOVERY_DB_CONFIG_UNAVAILABLE'
  )
})
test('현재 Supabase project와 DB 계정이 다르면 연결을 차단한다', () => {
  expect(() =>
    recoveryDatabaseConfig({
      ...env,
      NEXT_PUBLIC_SUPABASE_URL: 'https://anotherproject.supabase.co',
    })
  ).toThrow('RECOVERY_DB_CONFIG_UNAVAILABLE')
})
test('Supabase가 아닌 임의 DB endpoint로는 키를 전송하지 않는다', () => {
  expect(() =>
    recoveryDatabaseConfig({
      ...env,
      DATABASE_URL: 'postgresql://postgres:password@attacker.example:5432/postgres',
    })
  ).toThrow('RECOVERY_DB_CONFIG_UNAVAILABLE')
})

test('query의 host/user/password override가 실제 연결 대상을 바꾸지 못한다', () => {
  const cfg = recoveryDatabaseConfig({
    ...env,
    DATABASE_URL:
      env.DATABASE_URL +
      '&host=db.attacker.supabase.co&user=otheruser&password=otherpassword&port=1234',
  })
  const actual = cfg.connectionString ? parse(cfg.connectionString) : cfg
  expect(actual.host).toBe('aws-1.pooler.supabase.com')
  expect(actual.user).toBe('postgres.testproject')
  expect(actual.password).toBe('password')
  expect(Number(actual.port)).toBe(6543)
})
