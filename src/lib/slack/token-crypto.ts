/**
 * Slack bot 토큰(xoxb-) 암호화/복호화 — 공통 모듈의 'slack-token' 용도 키.
 * 워커(worker/src/slack-notifier.ts)도 같은 용도 키로 복호화한다.
 */
import { decryptField, encryptField } from '@/lib/crypto/field-crypto'

export function encryptBotToken(plaintext: string): { token: string; iv: string } {
  const { encrypted, iv } = encryptField('slack-token', plaintext)
  return { token: encrypted, iv }
}

export function decryptBotToken(token: string, iv: string): string {
  return decryptField('slack-token', token, iv)
}
