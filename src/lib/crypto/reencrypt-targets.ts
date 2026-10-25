/**
 * v0 → v1 일괄 재암호화 대상. 새 암호화 컬럼을 추가하면 여기에도 넣는다
 * (reencrypt-targets.test.ts 가 schema 의 *Iv 컬럼 누락을 잡는다).
 */
import type { CryptoPurpose } from './field-crypto'
import type { FieldPair } from './reencrypt'

export const REENCRYPT_TARGETS: ReadonlyArray<{
  model: string
  purpose: CryptoPurpose
  pairs: readonly FieldPair[]
}> = [
  {
    model: 'CoupangCredential',
    purpose: 'collection-credential',
    pairs: [['loginPassword', 'encryptionIv']],
  },
  {
    model: 'CoupangApiCredential',
    purpose: 'collection-credential',
    pairs: [['secretKey', 'encryptionIv']],
  },
  {
    model: 'ChannelCredential',
    purpose: 'channel-credential',
    pairs: [['encryptedPayload', 'iv']],
  },
  {
    model: 'SpaceSecret',
    purpose: 'space-secret',
    pairs: [['encryptedPayload', 'iv']],
  },
  { model: 'SlackInstallation', purpose: 'slack-token', pairs: [['botToken', 'botTokenIv']] },
  { model: 'BillingMethod', purpose: 'billing-key', pairs: [['billingKey', 'billingKeyIv']] },
  { model: 'SpaceAiSetting', purpose: 'ai-key', pairs: [['encryptedApiKey', 'apiKeyIv']] },
  {
    model: 'DelOrder',
    purpose: 'pii',
    pairs: [
      ['recipientNameEnc', 'recipientNameIv'],
      ['phoneEnc', 'phoneIv'],
      ['addressEnc', 'addressIv'],
    ],
  },
  {
    model: 'HiringPosting',
    purpose: 'pii',
    pairs: [
      ['managerNameEnc', 'managerNameIv'],
      ['managerPhoneEnc', 'managerPhoneIv'],
    ],
  },
  {
    model: 'HiringApplication',
    purpose: 'pii',
    pairs: [
      ['nameEnc', 'nameIv'],
      ['phoneEnc', 'phoneIv'],
      ['emailEnc', 'emailIv'],
      ['addressEnc', 'addressIv'],
    ],
  },
  {
    model: 'HiringMigrationRecord',
    purpose: 'pii',
    pairs: [['sourceSnapshotEnc', 'sourceSnapshotIv']],
  },
  { model: 'HiringBlacklist', purpose: 'pii', pairs: [['phoneEnc', 'phoneIv']] },
  { model: 'SpaceCredential', purpose: 'space-credential', pairs: [['encryptedPayload', 'iv']] },
]
