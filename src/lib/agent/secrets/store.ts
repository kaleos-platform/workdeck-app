import { prisma } from '@/lib/prisma'
import { encryptField, decryptField } from '@/lib/crypto/field-crypto'
import type { Actor } from '@/lib/agent/identity/principal'
import { ToolUserError } from '@/lib/agent/tools/errors'
import type { ApiKeyConfig } from './config'

export const SECRET_NAME_RE = /^[a-z0-9][a-z0-9-]{1,62}$/

// 없음·종류 불일치·허용 밖 actor 모두 같은 메시지 — 존재 여부를 드러내지 않는다.
const UNUSABLE = '사용할 수 없는 비밀값입니다'

/** API 키를 암호화해 저장한다(upsert). 교체하면 revision +1, lastError 초기화. 평문은 저장하지 않는다. */
export async function saveApiKeySecret(
  spaceId: string,
  name: string,
  value: string,
  config: ApiKeyConfig,
  allowedAgentIds: string[],
  userId: string
): Promise<{ id: string; revision: number }> {
  const { encrypted: encryptedPayload, iv } = encryptField('space-secret', value)
  return prisma.spaceSecret.upsert({
    where: { spaceId_name: { spaceId, name } },
    create: {
      spaceId,
      name,
      kind: 'API_KEY',
      encryptedPayload,
      iv,
      config,
      allowedAgentIds,
      createdById: userId,
    },
    update: {
      encryptedPayload,
      iv,
      config,
      allowedAgentIds,
      revision: { increment: 1 },
      lastError: null,
    },
    select: { id: true, revision: true },
  })
}

async function findUsable(spaceId: string, name: string, actor: Actor) {
  const row = await prisma.spaceSecret.findUnique({
    where: { spaceId_name: { spaceId, name } },
    select: {
      id: true,
      kind: true,
      revision: true,
      config: true,
      allowedAgentIds: true,
      encryptedPayload: true,
      iv: true,
    },
  })
  // 복호화 전에 검사한다. 구성원 user·system actor는 허용 목록에 없으므로 거부된다.
  if (
    !row ||
    row.kind !== 'API_KEY' ||
    actor.type !== 'agent' ||
    !row.allowedAgentIds.includes(actor.id)
  ) {
    throw new ToolUserError(UNUSABLE)
  }
  return row
}

/** 허용된 agent만 복호화해 쓴다. 복호화한 비밀값 id를 audit 배열에 넣는다. */
export async function loadSecretForUse(
  spaceId: string,
  name: string,
  actor: Actor,
  audit: string[]
): Promise<{ id: string; revision: number; value: string; config: ApiKeyConfig }> {
  const row = await findUsable(spaceId, name, actor)
  const value = decryptField('space-secret', row.encryptedPayload, row.iv)
  audit.push('secret:' + row.id)
  return { id: row.id, revision: row.revision, value, config: row.config as ApiKeyConfig }
}

/** 승인 실행용: 제안 때 본 행과 같은지(Space·종류·revision·원 행위자 허용) 다시 확인한 뒤 복호화한다. */
export async function loadSecretForApproval(
  spaceId: string,
  secretId: string,
  revision: number,
  actor: Actor,
  audit: string[]
): Promise<{ id: string; value: string; config: ApiKeyConfig }> {
  const row = await prisma.spaceSecret.findUnique({
    where: { id: secretId },
    select: {
      id: true,
      config: true,
      spaceId: true,
      kind: true,
      revision: true,
      allowedAgentIds: true,
      encryptedPayload: true,
      iv: true,
    },
  })
  if (
    !row ||
    row.spaceId !== spaceId ||
    row.kind !== 'API_KEY' ||
    row.revision !== revision ||
    actor.type !== 'agent' ||
    !row.allowedAgentIds.includes(actor.id)
  ) {
    throw new ToolUserError('비밀값이 바뀌어 실행하지 않았습니다. 다시 제안하세요')
  }
  const value = decryptField('space-secret', row.encryptedPayload, row.iv)
  audit.push('secret:' + row.id)
  return { id: row.id, value, config: row.config as ApiKeyConfig }
}

/** loadSecretForUse와 같은 검사. 복호화·감사 push 없음(제안 생성용). */
export async function assertSecretUsable(
  spaceId: string,
  name: string,
  actor: Actor
): Promise<{ id: string; revision: number }> {
  const { id, revision } = await findUsable(spaceId, name, actor)
  return { id, revision }
}

/** lastError에는 오류 코드나 `HTTP <status>`만 기록한다. 기록 실패는 무시한다. */
export async function recordSecretError(id: string, code: string): Promise<void> {
  await prisma.spaceSecret
    .update({ where: { id }, data: { lastError: code.slice(0, 100) } })
    .catch(() => undefined)
}

/** 사용 시각을 남긴다. 기록 실패는 무시한다. */
export async function recordSecretUsed(id: string): Promise<void> {
  await prisma.spaceSecret
    .update({ where: { id }, data: { lastUsedAt: new Date(), lastError: null } })
    .catch(() => undefined)
}

/** 목록용 메타. 값·IV·암호문은 select하지 않는다. */
export async function listSecretMeta(spaceId: string) {
  const rows = await prisma.spaceSecret.findMany({
    where: { spaceId },
    orderBy: { name: 'asc' },
    select: {
      name: true,
      kind: true,
      config: true,
      allowedAgentIds: true,
      revision: true,
      lastUsedAt: true,
      lastError: true,
      updatedAt: true,
    },
  })
  return rows.map((r) => {
    const cfg = r.config as Partial<ApiKeyConfig> | null
    return {
      name: r.name,
      kind: r.kind,
      baseUrl: cfg?.baseUrl ?? null,
      readOpIds: (cfg?.readOps ?? []).map((o) => o.id),
      allowedAgentIds: r.allowedAgentIds,
      revision: r.revision,
      lastUsedAt: r.lastUsedAt,
      lastError: r.lastError,
      updatedAt: r.updatedAt,
    }
  })
}

export async function findSecretKind(spaceId: string, name: string) {
  const row = await prisma.spaceSecret.findUnique({
    where: { spaceId_name: { spaceId, name } },
    select: { kind: true },
  })
  return row?.kind ?? null
}

/** 삭제. 없으면 false. */
export async function deleteSecret(spaceId: string, name: string): Promise<boolean> {
  const { count } = await prisma.spaceSecret.deleteMany({ where: { spaceId, name } })
  return count > 0
}

/** 관리자 보기 전용 복호화(actor 검사 없음 — 호출자가 ADMIN+aal2·감사를 보장한다). */
export async function revealSecretValue(
  spaceId: string,
  name: string
): Promise<{ id: string; value: string } | null> {
  const row = await prisma.spaceSecret.findUnique({
    where: { spaceId_name: { spaceId, name } },
    select: { id: true, encryptedPayload: true, iv: true },
  })
  if (!row) return null
  return { id: row.id, value: decryptField('space-secret', row.encryptedPayload, row.iv) }
}
