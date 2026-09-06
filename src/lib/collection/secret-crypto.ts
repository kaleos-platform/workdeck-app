/**
 * 쿠팡 자격증명(로그인 비밀번호 · Open API secretKey) 암호화 헬퍼 — AES-256-CBC.
 * `app/api/collection/credentials/route.ts`에 있던 구현을 그대로 추출했다.
 * `ENCRYPTION_KEY` 미설정 시 평문 + `iv: 'none'` 폴백을 유지한다 — 워커
 * `worker/src/encryption.ts`의 복호화 계약이 이 값(`iv === 'none'`이면 평문)을 본다.
 * preview 환경엔 `ENCRYPTION_KEY`가 없으므로 이 폴백이 정상 동작이다
 * (메모리: project_preview_encryption_key_missing).
 */
import crypto from 'crypto'

export type EncryptedSecret = { encrypted: string; iv: string }

// 평문을 암호화한다. ENCRYPTION_KEY 미설정 + production 이면 저장을 거부한다.
export function encryptSecret(plaintext: string): EncryptedSecret {
  const key = process.env.ENCRYPTION_KEY
  if (!key) {
    if (process.env.VERCEL_ENV === 'production') {
      throw new Error('ENCRYPTION_KEY가 설정되지 않아 자격증명을 저장할 수 없습니다')
    }
    // 비운영 환경: 평문 저장 (개발/preview 전용)
    console.warn('[secret-crypto] ENCRYPTION_KEY 미설정 — 평문 저장 (비운영 환경 전용)')
    return { encrypted: plaintext, iv: 'none' }
  }
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key, 'hex'), iv)
  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  return { encrypted, iv: iv.toString('hex') }
}
