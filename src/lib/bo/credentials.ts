// BoChannelCredential 저장·복호화 헬퍼.
// del/encryption.ts 의 AES-256-CBC (ENCRYPTION_KEY) 를 재사용.

import { prisma } from '@/lib/prisma'
import { decryptPii, encryptPii } from '@/lib/del/encryption'
import type { BoCredentialKind } from '@/generated/prisma/client'

export interface BoCredentialPayload {
  // kind 별로 다른 형태. JSON 직렬화 후 암호화.
  // COOKIE:  { storageState: string } or { cookies: any[] }
  // OAUTH:   { accessToken: string; refreshToken?: string }
  // API_KEY: { key: string; secret?: string }
  [k: string]: unknown
}

export async function saveBoCredential(input: {
  channelId: string
  spaceId: string
  kind: BoCredentialKind
  payload: BoCredentialPayload
  expiresAt?: Date | null
}) {
  const json = JSON.stringify(input.payload)
  const { encrypted, iv } = encryptPii(json)

  return prisma.boChannelCredential.upsert({
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

export async function getBoCredential<T extends BoCredentialPayload = BoCredentialPayload>(
  channelId: string,
  kind: BoCredentialKind
): Promise<{ payload: T; expiresAt: Date | null } | null> {
  const row = await prisma.boChannelCredential.findUnique({
    where: { channelId_kind: { channelId, kind } },
  })
  if (!row) return null
  const json = decryptPii(row.encryptedPayload, row.iv)
  return { payload: JSON.parse(json) as T, expiresAt: row.expiresAt }
}

export async function deleteBoCredential(channelId: string, kind: BoCredentialKind) {
  await prisma.boChannelCredential.delete({
    where: { channelId_kind: { channelId, kind } },
  })
}
