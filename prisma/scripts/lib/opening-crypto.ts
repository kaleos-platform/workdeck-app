/**
 * opening-crypto.ts
 *
 * opening_api/src/lib/cipher.ts 와 동일한 AES-256-CBC 복호화 구현.
 *
 * 저장 포맷: `<base64ciphertext>|<hexiv>`
 * (cipher.ts encrypt 함수: `${encryptAES(value, iv)}|${iv.toString("hex")}`)
 *
 * 필수 환경변수:
 *   OPENING_SECRET_KEY — hex 인코딩된 32바이트 AES 키
 *   OPENING_HMAC_KEY   — HMAC-SHA256 원문 키 (hex 불필요, 그대로 사용)
 */
import * as crypto from 'crypto'

let _cachedKey: Buffer | null = null

function getSecretKey(): Buffer {
  if (_cachedKey) return _cachedKey
  const hex = process.env.OPENING_SECRET_KEY
  if (!hex) throw new Error('OPENING_SECRET_KEY 환경변수가 설정되지 않았습니다')
  _cachedKey = Buffer.from(hex, 'hex')
  if (_cachedKey.length !== 32)
    throw new Error('OPENING_SECRET_KEY 는 32바이트(64자 hex)여야 합니다')
  return _cachedKey
}

/**
 * opening `_enc` 컬럼 복호화.
 * 포맷: `<base64ciphertext>|<hexiv>`
 * 복호화 불가(잘못된 포맷·키) 시 null 반환 (abort 대신 경고 처리는 호출 측에서).
 */
export function openingDecrypt(value: string | null | undefined): string | null {
  if (!value) return null
  const pipeIdx = value.indexOf('|')
  if (pipeIdx === -1) return null
  const encrypted = value.slice(0, pipeIdx)
  const ivStr = value.slice(pipeIdx + 1)
  try {
    const iv = Buffer.from(ivStr, 'hex')
    const decipher = crypto.createDecipheriv('aes-256-cbc', getSecretKey(), iv)
    let decrypted = decipher.update(encrypted, 'base64', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  } catch {
    return null
  }
}

/**
 * opening HMAC-SHA256 해시 재계산.
 * application.name_hash, phone_hash, blacklist.phone_hash 등에서 사용.
 */
export function openingHmac(value: string): string {
  const key = process.env.OPENING_HMAC_KEY
  if (!key) throw new Error('OPENING_HMAC_KEY 환경변수가 설정되지 않았습니다')
  return crypto.createHmac('sha256', key).update(value).digest('hex')
}

/**
 * 테스트에서 캐시된 키를 초기화하기 위한 유틸.
 * 프로덕션 코드에서는 사용하지 않는다.
 */
export function _resetKeyCache(): void {
  _cachedKey = null
}
