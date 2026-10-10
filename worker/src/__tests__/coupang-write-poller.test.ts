/** @jest-environment node */
import assert from 'node:assert/strict'
import { buildApiClient } from '../coupang-write-poller.js'
import { encryptField } from '../encryption.js'
import type { CoupangApiConfig } from '../coupang-api/client.js'

const TEST_KEY = '0'.repeat(64) // 32바이트 hex

// CoupangApiClient.cfg 는 private — 테스트에서만 캐스팅해 읽는다(공개 API 는 아니다).
function cfgOf(client: unknown): CoupangApiConfig {
  return (client as { cfg: CoupangApiConfig }).cfg
}

test('accessKey 는 평문 그대로, secretKey 만 복호화한다', () => {
  process.env.ENCRYPTION_KEY_V1 = TEST_KEY
  const plainAccessKey = 'plaintext-access-key'
  const { encrypted, iv } = encryptField('collection-credential', 'plaintext-secret-key')

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
