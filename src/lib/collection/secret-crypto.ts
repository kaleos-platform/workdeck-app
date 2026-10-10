/**
 * 쿠팡 자격증명(로그인 비밀번호 · Open API secretKey) 암호화 — 'collection-credential' 용도 키.
 * 평문 저장 폴백(iv='none')은 제거했다. 키가 없으면 어느 환경이든 저장을 거부한다.
 */
import { encryptField, type StoredField } from '@/lib/crypto/field-crypto'

export type EncryptedSecret = StoredField

export function encryptSecret(plaintext: string): EncryptedSecret {
  return encryptField('collection-credential', plaintext)
}
