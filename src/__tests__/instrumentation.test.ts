/** @jest-environment node */
import { register } from '../instrumentation'

jest.mock('../../sentry.server.config', () => ({}))

beforeEach(() => {
  process.env.NEXT_RUNTIME = 'nodejs'
  process.env.ENCRYPTION_WRITE_VERSION = 'v0'
  process.env.ENCRYPTION_KEY = 'c'.repeat(64)
})

test('v0 쓰기인데 K0(ENCRYPTION_KEY)가 없으면 부팅이 실패한다(K0 폐기 뒤 v0 전환 차단)', async () => {
  await expect(register()).resolves.toBeUndefined()
  delete process.env.ENCRYPTION_KEY
  await expect(register()).rejects.toThrow('ENCRYPTION_KEY 미설정')
})

test('v1 쓰기인데 활성 kid 가 잘못되면 첫 쓰기가 아니라 부팅에서 실패한다', async () => {
  process.env.ENCRYPTION_WRITE_VERSION = 'v1'
  process.env.ENCRYPTION_KEY_V1_ACTIVE_KID = 'K2'
  await expect(register()).rejects.toThrow('ENCRYPTION_KEY_V1_ACTIVE_KID')
  process.env.ENCRYPTION_KEY_V1_ACTIVE_KID = 'k1'
  await expect(register()).resolves.toBeUndefined()
  delete process.env.ENCRYPTION_KEY_V1_ACTIVE_KID
})
