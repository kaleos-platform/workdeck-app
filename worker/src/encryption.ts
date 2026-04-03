/**
 * AES-256-CBC 암호화/복호화 유틸리티
 * 쿠팡 자격증명의 비밀번호를 안전하게 저장·복호화하는 데 사용한다.
 */
import crypto from 'node:crypto'

const ALGORITHM = 'aes-256-cbc'
const KEY_LENGTH = 32 // 256비트

/** 암호화 결과 */
export type EncryptedData = {
  encrypted: string // hex 인코딩된 암호문
  iv: string // hex 인코딩된 초기화 벡터
}

/**
 * ENCRYPTION_KEY 환경변수에서 키를 가져온다.
 * 키는 32바이트(64자) hex 문자열이어야 한다.
 */
function getKeyBuffer(key?: string): Buffer {
  const hexKey = key ?? process.env.ENCRYPTION_KEY
  if (!hexKey) {
    throw new Error('ENCRYPTION_KEY 환경변수가 설정되지 않았습니다')
  }
  const buf = Buffer.from(hexKey, 'hex')
  if (buf.length !== KEY_LENGTH) {
    throw new Error(`암호화 키는 ${KEY_LENGTH}바이트(${KEY_LENGTH * 2}자 hex)여야 합니다`)
  }
  return buf
}

/**
 * 평문을 AES-256-CBC로 암호화한다.
 * @param text 암호화할 평문
 * @param key 32바이트 hex 키 (생략 시 환경변수 사용)
 * @returns 암호문과 IV (모두 hex 인코딩)
 */
export function encrypt(text: string, key?: string): EncryptedData {
  const keyBuffer = getKeyBuffer(key)
  const iv = crypto.randomBytes(16) // 128비트 IV
  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv)

  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  return {
    encrypted,
    iv: iv.toString('hex'),
  }
}

/**
 * AES-256-CBC 암호문을 복호화한다.
 * @param encrypted hex 인코딩된 암호문
 * @param iv hex 인코딩된 초기화 벡터
 * @param key 32바이트 hex 키 (생략 시 환경변수 사용)
 * @returns 복호화된 평문
 */
export function decrypt(encrypted: string, iv: string, key?: string): string {
  const keyBuffer = getKeyBuffer(key)
  const ivBuffer = Buffer.from(iv, 'hex')
  const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, ivBuffer)

  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}
