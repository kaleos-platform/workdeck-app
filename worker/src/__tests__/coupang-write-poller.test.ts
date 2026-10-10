/** @jest-environment node */
import assert from 'node:assert/strict'
import { buildApiClient, startCoupangWritePoller } from '../coupang-write-poller.js'
import { encryptField } from '../encryption.js'
import { claimWriteJob, getApiCredential, reportWriteJob } from '../api-client.js'
import type { CoupangApiConfig } from '../coupang-api/client.js'

// 폴링 루프 테스트용 — buildApiClient 는 api-client·write-jobs 를 쓰지 않는다.
jest.mock('../api-client.js')
jest.mock('../write-jobs/price-change.js')
jest.mock('../write-jobs/product-sync.js')

const TEST_KEY = '0'.repeat(64) // 32바이트 hex
const SAVED = { ...process.env }

// 셸의 ENCRYPTION_*·VERCEL_ENV 가 쓰기 버전·키 선택을 바꾸지 못하게 매번 비운다.
function clearCryptoEnv(): void {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('ENCRYPTION_') || k === 'VERCEL_ENV') delete process.env[k]
  }
}

beforeEach(() => {
  clearCryptoEnv()
  process.env.ENCRYPTION_WRITE_VERSION = 'v1'
})

afterEach(() => {
  clearCryptoEnv()
  Object.assign(process.env, SAVED)
})

// CoupangApiClient.cfg 는 private — 테스트에서만 캐스팅해 읽는다(공개 API 는 아니다).
function cfgOf(client: unknown): CoupangApiConfig {
  return (client as { cfg: CoupangApiConfig }).cfg
}

test('accessKey 는 평문 그대로, secretKey 만 복호화한다', () => {
  process.env.ENCRYPTION_KEY_V1 = TEST_KEY
  const plainAccessKey = 'plaintext-access-key'
  const { encrypted, iv } = encryptField('collection-credential', 'plaintext-secret-key')
  assert.equal(iv, 'v1')
  assert.ok(encrypted.startsWith('v1:k1:'))

  const client = buildApiClient({
    vendorId: 'A00000000',
    accessKey: plainAccessKey,
    secretKey: encrypted,
    encryptionIv: iv,
    isActive: true,
  })

  const cfg = cfgOf(client)
  assert.equal(cfg.accessKey, plainAccessKey) // 복호화 안 됨 — 평문 그대로
  assert.equal(cfg.secretKey, 'plaintext-secret-key') // 복호화됨
})

test("encryptionIv==='none' 이면 평문 폴백 없이 재등록 오류", () => {
  assert.throws(
    () =>
      buildApiClient({
        vendorId: 'A00000000',
        accessKey: 'access',
        secretKey: 'plain-secret',
        encryptionIv: 'none',
        isActive: true,
      }),
    /iv=none/
  )
})

test('복호화 실패 잡은 FAILED 로 보고되고 다음 tick 은 계속 돈다', async () => {
  jest.useFakeTimers()
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest
    .mocked(claimWriteJob)
    .mockResolvedValueOnce({
      id: 'job-1',
      kind: 'PRICE_CHANGE',
      payload: {},
      spaceId: 's1',
    } as never)
    .mockResolvedValueOnce(null)
  jest.mocked(getApiCredential).mockResolvedValue({
    vendorId: 'A00000000',
    accessKey: 'access',
    secretKey: 'plain-secret',
    encryptionIv: 'none',
    isActive: true,
  })
  jest.mocked(reportWriteJob).mockResolvedValue(undefined as never)

  startCoupangWritePoller()
  await jest.advanceTimersByTimeAsync(30_000)
  expect(reportWriteJob).toHaveBeenCalledWith('job-1', {
    status: 'FAILED',
    error: expect.stringMatching(/iv=none/),
  })

  await jest.advanceTimersByTimeAsync(30_000)
  expect(claimWriteJob).toHaveBeenCalledTimes(2)
  jest.useRealTimers()
})
