import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveDeckContext, errorResponse, assertRole } from '@/lib/api-helpers'
import { requireAal2 } from '@/lib/auth/mfa'
import { prisma } from '@/lib/prisma'
import { loadSpaceCredential, saveSpaceCredential } from '@/lib/agent/integrations/space-credential'
import { getDataSourceSchema, notionIdFromInput, resolveDataSourceId } from '@/lib/sc/osmu/notion'
import { ensureSpaceServiceAccount } from '@/lib/sc/osmu/drive'
import { connectionSchemaError, driveFolderIdFromUrl } from '@/lib/sc/osmu/notion-schema'

export const runtime = 'nodejs'

/** GET: 노션·드라이브 연결 상태(비밀값 없음). */
export async function GET() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id
  const [notion, drive, mfaError] = await Promise.all([
    prisma.scNotionConnection.findUnique({
      where: { spaceId },
      select: {
        sourceDataSourceId: true,
        requestDataSourceId: true,
        lastPolledAt: true,
        lastError: true,
      },
    }),
    prisma.scDriveConnection.findUnique({
      where: { spaceId },
      select: { serviceAccountEmail: true, rootId: true, lastSyncedAt: true, lastError: true },
    }),
    requireAal2(),
  ])
  // 화면이 입력 전에 단계 인증부터 받게 한다(저장 시점 인증은 입력값을 잃는다).
  return NextResponse.json({ notion, drive, mfaReady: mfaError === null })
}

const putSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('notion'),
    // 비우면 저장된 토큰 유지(DB 링크만 교체)
    token: z.string().trim().min(10).max(500).optional(),
    sourceDb: z.string().trim().min(1).max(500),
    requestDb: z.string().trim().min(1).max(500),
  }),
  z.object({ kind: z.literal('drive-account') }),
  z.object({ kind: z.literal('drive-root'), root: z.string().trim().min(1).max(500) }),
])

/** PUT: 연결 등록·교체. 자격증명·SA 생성은 ADMIN + MFA. */
export async function PUT(req: NextRequest) {
  const resolved = await resolveDeckContext('sales-content', { write: true })
  if ('error' in resolved) return resolved.error
  const roleError = assertRole(resolved.role, 'ADMIN')
  if (roleError) return roleError
  const mfaError = await requireAal2()
  if (mfaError) return mfaError
  const spaceId = resolved.space.id

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }
  const parsed = putSchema.safeParse(body)
  if (!parsed.success) return errorResponse('입력값을 확인해주세요', 400)
  const input = parsed.data

  try {
    if (input.kind === 'notion') {
      const token =
        input.token ??
        (await loadSpaceCredential<{ token: string }>(spaceId, 'notion', []).catch(() => null))
          ?.secret.token
      if (!token) return errorResponse('노션 통합 토큰을 입력해주세요', 400)
      const sourceId = notionIdFromInput(input.sourceDb)
      const requestId = notionIdFromInput(input.requestDb)
      if (!sourceId || !requestId)
        return errorResponse('노션 데이터베이스 링크를 확인해주세요', 400)
      // 통합이 두 DB 에 공유됐는지 실제 조회로 확인한 뒤 저장한다.
      const [sourceDataSourceId, requestDataSourceId] = await Promise.all([
        resolveDataSourceId(token, sourceId),
        resolveDataSourceId(token, requestId),
      ])
      if (sourceDataSourceId === requestDataSourceId) {
        return errorResponse('「콘텐츠 소재」와 「콘텐츠 발행」에 서로 다른 DB를 넣어주세요', 400)
      }
      // 속성 이름·유형으로 DB 를 제대로 넣었는지 확인(cron 이 매번 실패하지 않게).
      const [sourceSchema, requestSchema] = await Promise.all([
        getDataSourceSchema(token, sourceDataSourceId),
        getDataSourceSchema(token, requestDataSourceId),
      ])
      const schemaError = connectionSchemaError(sourceSchema, requestSchema)
      if (schemaError) return errorResponse(schemaError, 400)
      await saveSpaceCredential(spaceId, 'notion', { token }, {})
      await prisma.scNotionConnection.upsert({
        where: { spaceId },
        create: { spaceId, sourceDataSourceId, requestDataSourceId },
        update: { sourceDataSourceId, requestDataSourceId, lastError: null },
      })
    } else if (input.kind === 'drive-account') {
      await ensureSpaceServiceAccount(spaceId)
    } else {
      // 공유 드라이브 링크(…/folders/0A…) 또는 id
      const rootId =
        driveFolderIdFromUrl(input.root) ?? (/^[\w-]{10,}$/.test(input.root) ? input.root : null)
      if (!rootId) return errorResponse('공유 드라이브 링크를 확인해주세요', 400)
      const updated = await prisma.scDriveConnection.updateMany({
        where: { spaceId },
        data: { rootId },
      })
      if (updated.count === 0) return errorResponse('먼저 드라이브 계정을 만들어주세요', 409)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return errorResponse(`연결에 실패했습니다: ${message.slice(0, 200)}`, 502)
  }
  return GET()
}

/** DELETE: 노션 연결 해제(토큰 삭제). 드라이브 SA 는 GCP 정리가 필요해 화면에서 지우지 않는다. */
export async function DELETE() {
  const resolved = await resolveDeckContext('sales-content', { write: true })
  if ('error' in resolved) return resolved.error
  const roleError = assertRole(resolved.role, 'ADMIN')
  if (roleError) return roleError
  const mfaError = await requireAal2()
  if (mfaError) return mfaError
  const spaceId = resolved.space.id
  await prisma.$transaction([
    prisma.scNotionConnection.deleteMany({ where: { spaceId } }),
    prisma.spaceCredential.deleteMany({ where: { spaceId, provider: 'notion' } }),
  ])
  return GET()
}
