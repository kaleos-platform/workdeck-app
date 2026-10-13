import { prisma } from '@/lib/prisma'
import { encryptField, decryptField } from '@/lib/crypto/field-crypto'
import { maskSecrets } from '@/lib/agent/audit'
import { ToolUserError } from '@/lib/agent/tools/errors'

/** Space 외부 연동 자격증명. 평문은 field-crypto('space-credential')로 암호화해서만 저장한다. */
export async function saveSpaceCredential(
  spaceId: string,
  provider: string,
  secret: object,
  config: object
): Promise<{ id: string }> {
  const { encrypted: encryptedPayload, iv } = encryptField(
    'space-credential',
    JSON.stringify(secret)
  )
  return prisma.spaceCredential.upsert({
    where: { spaceId_provider: { spaceId, provider } },
    create: { spaceId, provider, encryptedPayload, iv, config },
    update: { encryptedPayload, iv, config, lastError: null },
    select: { id: true },
  })
}

/**
 * 서버 안에서만 복호화한다. 복호화한 자격증명 id를 audit 배열에 넣어 감사 행(decryptedCredentialIds)으로 남긴다.
 * 오류 메시지에 비밀값을 넣지 않는다.
 */
export async function loadSpaceCredential<T>(
  spaceId: string,
  provider: string,
  audit: string[]
): Promise<{ id: string; secret: T; config: Record<string, unknown> }> {
  const row = await prisma.spaceCredential.findUnique({
    where: { spaceId_provider: { spaceId, provider } },
    select: { id: true, encryptedPayload: true, iv: true, config: true },
  })
  if (!row) throw new ToolUserError(`${provider} 자격증명이 등록되지 않았습니다`)
  const secret = JSON.parse(decryptField('space-credential', row.encryptedPayload, row.iv)) as T
  audit.push(row.id)
  return { id: row.id, secret, config: (row.config ?? {}) as Record<string, unknown> }
}

/** 비밀값 없이 config만 읽는다(복호화·감사 없음). 제안 생성 시점 validateCreate의 대상 재확인용. */
export async function loadSpaceCredentialConfig<T>(spaceId: string, provider: string): Promise<T> {
  const row = await prisma.spaceCredential.findUnique({
    where: { spaceId_provider: { spaceId, provider } },
    select: { config: true },
  })
  if (!row) throw new ToolUserError(`${provider} 자격증명이 등록되지 않았습니다`)
  return (row.config ?? {}) as T
}

/** 외부 API 오류를 자격증명에 기록한다(마스킹 후 500자). 기록 실패는 무시한다. */
export async function recordCredentialError(id: string, message: string): Promise<void> {
  await prisma.spaceCredential
    .update({ where: { id }, data: { lastError: maskSecrets(message).slice(0, 500) } })
    .catch(() => undefined)
}
