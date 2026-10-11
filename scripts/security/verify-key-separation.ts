/**
 * "preview 키로 운영 암호문을 복호화할 수 없다"(spec §5.7) 확인.
 * 운영 v1 암호문 1개를 SQL Editor 에서 읽기 조회로 가져와 인자로 넘긴다:
 *   SELECT "encryptedPayload" FROM "ChannelCredential" WHERE iv = 'v1' LIMIT 1;
 * 실행: PROD_KEY=… PREVIEW_KEY=… npx tsx scripts/security/verify-key-separation.ts '<v1 암호문>' channel-credential
 */
import { decryptField, type CryptoPurpose } from '../../src/lib/crypto/field-crypto'

const [ciphertext, purpose] = process.argv.slice(2) as [string, CryptoPurpose]
if (!ciphertext?.startsWith('v1:') || !purpose) throw new Error('인자: <v1 암호문> <purpose>')

function tryWith(root: string | undefined): boolean {
  if (!root) throw new Error('PROD_KEY, PREVIEW_KEY 모두 필요')
  process.env.ENCRYPTION_KEY_V1 = root
  delete process.env.ENCRYPTION_KEY
  try {
    decryptField(purpose, ciphertext, 'v1')
    return true
  } catch {
    return false
  }
}

const prodOk = tryWith(process.env.PROD_KEY)
const previewOk = tryWith(process.env.PREVIEW_KEY)
console.log(
  `운영 키 복호화: ${prodOk ? '성공' : '실패'} / preview 키 복호화: ${previewOk ? '성공' : '실패'}`
)
if (!prodOk || previewOk) process.exitCode = 1
