// ChannelCredential 저장·복호화 헬퍼. 공통 모듈의 'channel-credential' 용도 키.

import { prisma } from '@/lib/prisma'
import { decryptField, encryptField } from '@/lib/crypto/field-crypto'
import { upgradeIfLegacy } from '@/lib/crypto/reencrypt'
import type { ChannelCredentialKind } from '@/generated/prisma/client'

export interface CredentialPayload {
  // kind 별로 다른 형태. JSON 직렬화 후 암호화.
  // COOKIE:  { storageState: string } or { cookies: any[] }
  // OAUTH:   { accessToken: string; refreshToken?: string; tokenType?: string }
  // API_KEY: { key: string; secret?: string }
  [k: string]: unknown
}

export async function upsertChannelCredential(input: {
  spaceId: string
  channelId: string
  kind: ChannelCredentialKind
  payload: CredentialPayload
  expiresAt?: Date | null
}) {
  const { encrypted, iv } = encryptField('channel-credential', JSON.stringify(input.payload))

  return prisma.channelCredential.upsert({
    where: { channelId_kind: { channelId: input.channelId, kind: input.kind } },
    create: {
      spaceId: input.spaceId,
      channelId: input.channelId,
      kind: input.kind,
      encryptedPayload: encrypted,
      iv,
      expiresAt: input.expiresAt ?? null,
    },
    update: {
      encryptedPayload: encrypted,
      iv,
      expiresAt: input.expiresAt ?? null,
      lastError: null,
    },
  })
}

export async function readChannelCredential<T extends CredentialPayload = CredentialPayload>(
  channelId: string,
  kind: ChannelCredentialKind
): Promise<{ payload: T; expiresAt: Date | null } | null> {
  const row = await prisma.channelCredential.findUnique({
    where: { channelId_kind: { channelId, kind } },
  })
  if (!row) return null
  const json = decryptField('channel-credential', row.encryptedPayload, row.iv)
  // v0 면 v1 으로 올린다 — 같은 암호문일 때만(그 사이 재등록됐으면 덮어쓰지 않음).
  await upgradeIfLegacy(
    'channel-credential',
    { encrypted: row.encryptedPayload, iv: row.iv },
    json,
    (next) =>
      prisma.channelCredential.updateMany({
        where: { id: row.id, encryptedPayload: row.encryptedPayload },
        data: { encryptedPayload: next.encrypted, iv: next.iv },
      })
  )
  return { payload: JSON.parse(json) as T, expiresAt: row.expiresAt }
}

// 워커 전달용 — 서버에서 평문을 만들지 않는다(워커가 channel-credential 용도 키로 복호화).
export async function readChannelCredentialSealed(
  channelId: string,
  kind: ChannelCredentialKind
): Promise<{ encryptedPayload: string; iv: string; expiresAt: Date | null } | null> {
  const row = await prisma.channelCredential.findUnique({
    where: { channelId_kind: { channelId, kind } },
    select: { encryptedPayload: true, iv: true, expiresAt: true },
  })
  if (!row) return null
  return { encryptedPayload: row.encryptedPayload, iv: row.iv, expiresAt: row.expiresAt }
}

export async function deleteChannelCredential(channelId: string, kind: ChannelCredentialKind) {
  await prisma.channelCredential.delete({
    where: { channelId_kind: { channelId, kind } },
  })
}
