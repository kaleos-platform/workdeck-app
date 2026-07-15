/**
 * Slack bot 토큰(xoxb-) 암호화/복호화 — AES-256-CBC.
 * 배송 PII 암호화(src/lib/del/encryption.ts)와 동일한 ENCRYPTION_KEY·형식을 쓴다.
 */
import crypto from 'node:crypto'

const ALGORITHM = 'aes-256-cbc'
const KEY_LENGTH = 32 // 256비트

function getKeyBuffer(): Buffer {
  const hexKey = process.env.ENCRYPTION_KEY
  if (!hexKey) {
    throw new Error('ENCRYPTION_KEY 환경변수가 설정되지 않았습니다')
  }
  const buf = Buffer.from(hexKey, 'hex')
  if (buf.length !== KEY_LENGTH) {
    throw new Error(`암호화 키는 ${KEY_LENGTH}바이트(${KEY_LENGTH * 2}자 hex)여야 합니다`)
  }
  return buf
}

/** bot 토큰을 암호화한다. { token, iv }는 각각 hex 문자열. */
export function encryptBotToken(plaintext: string): { token: string; iv: string } {
  const key = getKeyBuffer()
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  return { token: encrypted, iv: iv.toString('hex') }
}

/** 암호화된 bot 토큰을 복호화해 평문(xoxb-...)을 반환한다. */
export function decryptBotToken(token: string, iv: string): string {
  const key = getKeyBuffer()
  const ivBuffer = Buffer.from(iv, 'hex')
  const decipher = crypto.createDecipheriv(ALGORITHM, key, ivBuffer)

  let decrypted = decipher.update(token, 'hex', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}
