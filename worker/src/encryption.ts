/**
 * 워커 복호화 — 앱과 같은 공통 모듈의 복사본(./field-crypto.ts)을 쓴다.
 * 원본은 src/lib/crypto/field-crypto.ts. 고칠 때는 원본을 고치고 `cp` 로 복사한다(worker-copy.test.ts 가 검사).
 * 키: v1 루트(ENCRYPTION_KEY_V1) 대신 용도별 키(ENCRYPTION_KEY_COLLECTION_CREDENTIAL,
 * ENCRYPTION_KEY_CHANNEL_CREDENTIAL, ENCRYPTION_KEY_SLACK_TOKEN)와 v0 용 ENCRYPTION_KEY 만 둔다.
 */
export { decryptField as decryptSecret, encryptField, type CryptoPurpose } from './field-crypto.js'
