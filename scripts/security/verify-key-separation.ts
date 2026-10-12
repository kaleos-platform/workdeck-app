/**
 * "preview 키로 운영 암호문을 복호화할 수 없다"(spec §5.7) 확인.
 * 운영 v1 암호문 1개를 SQL Editor 에서 읽기 조회로 가져와 인자로 넘긴다:
 *   SELECT "encryptedPayload" FROM "ChannelCredential" WHERE iv = 'v1' LIMIT 1;
 * 실행: PROD_KEY=… PREVIEW_KEY=… npx tsx scripts/security/verify-key-separation.ts '<v1 암호문>' channel-credential
 */
import { decryptField, type CryptoPurpose } from '../../src/lib/crypto/field-crypto'

const [ciphertext, purpose] = process.argv.slice(2) as [string, CryptoPurpose]
if (!ciphertext?.startsWith('v1:') || !purpose) throw new Error('인자: <v1 암호문> <purpose>')

const HEX64 = /^[0-9a-f]{64}$/i
for (const name of ['PROD_KEY', 'PREVIEW_KEY']) {
  // 형식 오류를 "복호화 실패(분리 성공)"로 오인하지 않도록 먼저 거부한다.
  if (!HEX64.test(process.env[name] ?? '')) throw new Error(`${name} 는 64자 hex 여야 합니다`)
}

function tryWith(root: string): boolean {
  // 용도별 직접 키·k2 키가 셸에 있으면 root 와 무관하게 풀릴 수 있다 — 전부 지운다.
  for (const k of Object.keys(process.env))
    if (k.startsWith('ENCRYPTION_KEY')) delete process.env[k]
  process.env.ENCRYPTION_KEY_V1 = root
  try {
    decryptField(purpose, ciphertext, 'v1')
    return true
  } catch {
    return false
  }
}

const prodOk = tryWith(process.env.PROD_KEY!)
const previewOk = tryWith(process.env.PREVIEW_KEY!)
console.log(
  `운영 키 복호화: ${prodOk ? '성공' : '실패'} / preview 키 복호화: ${previewOk ? '성공' : '실패'}`
)
if (!prodOk || previewOk) process.exitCode = 1
