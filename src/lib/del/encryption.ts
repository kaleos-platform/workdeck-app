/**
 * PII 암호화/복호화 유틸리티 (AES-256-CBC)
 * 배송 관리 덱의 개인정보(이름, 전화, 주소) 암호화에 사용한다.
 */
import crypto from 'node:crypto'

const ALGORITHM = 'aes-256-cbc'
const KEY_LENGTH = 32 // 256비트

export type EncryptedField = {
  encrypted: string // hex 인코딩된 암호문
  iv: string // hex 인코딩된 초기화 벡터
}

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

/**
 * 평문을 AES-256-CBC로 암호화한다.
 */
export function encryptPii(plaintext: string): EncryptedField {
  const key = getKeyBuffer()
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  return { encrypted, iv: iv.toString('hex') }
}

/**
 * AES-256-CBC 암호문을 복호화한다.
 */
export function decryptPii(encrypted: string, iv: string): string {
  const key = getKeyBuffer()
  const ivBuffer = Buffer.from(iv, 'hex')
  const decipher = crypto.createDecipheriv(ALGORITHM, key, ivBuffer)

  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}

/**
 * 주문의 PII 필드 3개(이름, 전화, 주소)를 한번에 암호화한다.
 */
export function encryptOrderPii(data: {
  recipientName: string
  phone: string
  address: string
}) {
  const name = encryptPii(data.recipientName)
  const phone = encryptPii(data.phone)
  const address = encryptPii(data.address)

  return {
    recipientNameEnc: name.encrypted,
    recipientNameIv: name.iv,
    phoneEnc: phone.encrypted,
    phoneIv: phone.iv,
    addressEnc: address.encrypted,
    addressIv: address.iv,
  }
}

/**
 * 주문의 PII 필드 3개를 복호화한다.
 */
export function decryptOrderPii(data: {
  recipientNameEnc: string
  recipientNameIv: string
  phoneEnc: string
  phoneIv: string
  addressEnc: string
  addressIv: string
}) {
  return {
    recipientName: decryptPii(data.recipientNameEnc, data.recipientNameIv),
    phone: decryptPii(data.phoneEnc, data.phoneIv),
    address: decryptPii(data.addressEnc, data.addressIv),
  }
}
