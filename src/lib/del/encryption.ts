/**
 * PII 암호화/복호화 — 배송(DelOrder)·채용(Hiring*) 개인정보. 공통 모듈의 'pii' 용도 키를 쓴다.
 * 쓰기는 v1(AES-256-GCM), 읽기는 v1·v0(CBC) 모두.
 */
import { decryptField, encryptField, type StoredField } from '@/lib/crypto/field-crypto'

export type EncryptedField = StoredField

export function encryptPii(plaintext: string): EncryptedField {
  return encryptField('pii', plaintext)
}

export function decryptPii(encrypted: string, iv: string): string {
  return decryptField('pii', encrypted, iv)
}

/**
 * 주문의 PII 필드 3개(이름, 전화, 주소)를 한번에 암호화한다.
 */
export function encryptOrderPii(data: { recipientName: string; phone: string; address: string }) {
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
