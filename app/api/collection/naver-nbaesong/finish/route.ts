/** POST — 워커의 한 스토어 수집 결과. 백필 커서를 전진시키고 오류를 기록·해소한다. */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { recordCredentialError } from '@/lib/agent/integrations/space-credential'
import { advanceCursor } from '@/lib/naver-commerce/schedule'
import { loadNbaesongStore, resolveNbaesongScope } from '@/lib/naver-commerce/worker-api'

const ymd = z.iso.date()
const BodySchema = z.object({
  spaceId: z.string().min(1),
  storeKey: z.string().min(1),
  attempted: z.array(ymd).max(100),
  ok: z.array(ymd).max(100),
  error: z.string().optional(),
})

export async function POST(request: NextRequest) {
  const resolved = await resolveNbaesongScope(request.headers)
  if ('error' in resolved) return resolved.error
  const { scope } = resolved
  const parsed = BodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse('입력값이 올바르지 않습니다', 400)
  const { spaceId, storeKey, attempted, ok, error } = parsed.data

  const found = await loadNbaesongStore(scope, spaceId, storeKey)
  if (found.error) return found.error
  const { credentialId, config, store } = found

  const backfilledThrough = advanceCursor(
    store.backfilledThrough,
    store.startDate,
    attempted,
    new Set(ok)
  )
  await prisma.spaceCredential.update({
    where: { id: credentialId },
    data: {
      config: {
        ...config,
        stores: config.stores.map((s) => (s.key === storeKey ? { ...s, backfilledThrough } : s)),
      },
      ...(error ? {} : { lastError: null }),
    },
  })
  if (error) await recordCredentialError(credentialId, error)
  return NextResponse.json({ backfilledThrough })
}
