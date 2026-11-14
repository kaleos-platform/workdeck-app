import { NextRequest, NextResponse } from 'next/server'
import { InvStorageLocationType } from '@/generated/prisma/client'
import { resolveDeckContext, errorResponse, assertRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { resolveSyncState, isWekeepLoginUrl } from '@/lib/inv/location-sync'
import { isExternalSource, EXTERNAL_SOURCE_LABEL } from '@/lib/inv/external-sources'

type RouteContext = { params: Promise<{ locationId: string }> }

const LOCATION_TYPES: ReadonlySet<InvStorageLocationType> = new Set([
  InvStorageLocationType.OWN,
  InvStorageLocationType.THIRD_PARTY,
  InvStorageLocationType.STORE,
])

function parseLocationType(v: unknown): InvStorageLocationType | undefined {
  if (typeof v !== 'string') return undefined
  return LOCATION_TYPES.has(v as InvStorageLocationType) ? (v as InvStorageLocationType) : undefined
}

async function loadLocation(spaceId: string, locationId: string) {
  return prisma.invStorageLocation.findFirst({
    where: { id: locationId, spaceId },
  })
}

async function hasNonZeroStock(locationId: string) {
  const nonZero = await prisma.invStockLevel.findFirst({
    where: { locationId, NOT: { quantity: 0 } },
    select: { id: true },
  })
  return !!nonZero
}

// PATCH /api/inv/locations/[locationId] { name?, isActive? }
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const resolved = await resolveDeckContext('seller-hub', { write: true })
  if ('error' in resolved) return resolved.error

  const { locationId } = await ctx.params
  const location = await loadLocation(resolved.space.id, locationId)
  if (!location) return errorResponse('위치를 찾을 수 없습니다', 404)

  const body = (await req.json().catch(() => ({}))) as {
    name?: string
    isActive?: boolean
    type?: string
    externalSource?: string | null
    syncProvider?: string | null
    syncSecretName?: string | null
    autoReconcileWeekly?: boolean
  }

  const data: {
    syncProvider?: string | null
    syncSecretName?: string | null
    autoReconcileWeekly?: boolean
    name?: string
    isActive?: boolean
    type?: InvStorageLocationType
    externalSource?: string | null
  } = {}

  if (body.type !== undefined) {
    const parsed = parseLocationType(body.type)
    if (!parsed) {
      return errorResponse('type은 OWN, THIRD_PARTY, STORE 중 하나여야 합니다', 400)
    }
    data.type = parsed
  }

  if (typeof body.name === 'string') {
    const name = body.name.trim()
    if (!name) return errorResponse('위치명이 필요합니다', 400)
    if (name !== location.name) {
      const duplicate = await prisma.invStorageLocation.findFirst({
        where: {
          spaceId: resolved.space.id,
          name,
          NOT: { id: locationId },
        },
        select: { id: true },
      })
      if (duplicate) return errorResponse('같은 이름의 위치가 이미 존재합니다', 409)
    }
    data.name = name
  }

  if (typeof body.isActive === 'boolean') {
    if (body.isActive === false && location.isActive === true) {
      if (await hasNonZeroStock(locationId)) {
        return errorResponse('재고가 남아있는 위치는 비활성화할 수 없습니다', 400)
      }
    }
    data.isActive = body.isActive
  }

  if (body.externalSource !== undefined) {
    if (body.externalSource === null || body.externalSource === '') {
      data.externalSource = null
    } else {
      if (!isExternalSource(body.externalSource)) {
        return errorResponse('지원하지 않는 연결 소스입니다', 400)
      }
      if (body.externalSource !== location.externalSource) {
        const dup = await prisma.invStorageLocation.findFirst({
          where: {
            spaceId: resolved.space.id,
            externalSource: body.externalSource,
            NOT: { id: locationId },
          },
          select: { id: true, name: true },
        })
        if (dup) {
          return errorResponse(
            `이미 '${dup.name}' 위치가 ${EXTERNAL_SOURCE_LABEL[body.externalSource]} 소스에 연결되어 있습니다`,
            409
          )
        }
      }
      data.externalSource = body.externalSource
    }
  }

  // 외부 연동(위킵) 설정 — 3PL 위치 + 같은 Space의 LOGIN 비밀값만 허용
  const sync = resolveSyncState(body, location, data.type ?? location.type)
  if (!sync.ok) return errorResponse(sync.message, 400)
  // 로그인 비밀값 연결(변경)은 ADMIN 만 — MEMBER 가 다른 비밀값을 위킵 로그인에 물리지 못하게 한다.
  const st = sync.state
  if (
    st &&
    ((st.syncProvider && st.syncProvider !== location.syncProvider) ||
      (st.syncSecretName && st.syncSecretName !== location.syncSecretName))
  ) {
    const denied = assertRole(resolved.role, 'ADMIN')
    if (denied) return errorResponse('위킵 로그인 연결은 관리자만 변경할 수 있습니다.', 403)
  }
  // 이름을 바꾸는 요청일 때만 존재 확인 — 연결 비밀값이 나중에 삭제된 위치의 다른 수정은 막지 않는다.
  if (sync.secretToCheck && sync.secretToCheck !== location.syncSecretName) {
    const secret = await prisma.spaceSecret.findFirst({
      where: { spaceId: resolved.space.id, name: sync.secretToCheck, kind: 'LOGIN' },
      select: { id: true, config: true },
    })
    if (!secret) return errorResponse('선택한 로그인 비밀값을 찾을 수 없습니다', 400)
    if (!isWekeepLoginUrl((secret.config as { loginUrl?: unknown } | null)?.loginUrl)) {
      return errorResponse('위킵 로그인 주소(wekeep.co.kr)의 비밀값만 연결할 수 있습니다.', 400)
    }
  }
  if (sync.state) Object.assign(data, sync.state)

  if (Object.keys(data).length === 0) {
    return errorResponse('변경할 내용이 없습니다', 400)
  }

  const updated = await prisma.invStorageLocation.update({
    where: { id: locationId },
    data,
  })

  return NextResponse.json({ location: updated })
}

// DELETE /api/inv/locations/[locationId] — soft delete (isActive = false)
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const resolved = await resolveDeckContext('seller-hub', { write: true })
  if ('error' in resolved) return resolved.error

  const { locationId } = await ctx.params
  const location = await loadLocation(resolved.space.id, locationId)
  if (!location) return errorResponse('위치를 찾을 수 없습니다', 404)

  if (location.isActive && (await hasNonZeroStock(locationId))) {
    return errorResponse('재고가 남아있는 위치는 비활성화할 수 없습니다', 400)
  }

  const updated = await prisma.invStorageLocation.update({
    where: { id: locationId },
    data: { isActive: false },
  })

  return NextResponse.json({ location: updated })
}
