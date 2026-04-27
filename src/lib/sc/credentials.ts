// ChannelCredential 저장·복호화 헬퍼. del/encryption 의 AES-256-CBC 를 재사용.

import { prisma } from '@/lib/prisma'
import { decryptPii, encryptPii } from '@/lib/del/encryption'
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
  const json = JSON.stringify(input.payload)
  const { encrypted, iv } = encryptPii(json)

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
  const json = decryptPii(row.encryptedPayload, row.iv)
  const payload = JSON.parse(json) as T
  return { payload, expiresAt: row.expiresAt }
}

export async function deleteChannelCredential(channelId: string, kind: ChannelCredentialKind) {
  await prisma.channelCredential.delete({
    where: { channelId_kind: { channelId, kind } },
  })
}
