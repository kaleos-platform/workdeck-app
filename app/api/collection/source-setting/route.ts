/**
 * /api/collection/source-setting — 데이터 종류별 수집 소스(크롤링/API) 선택 조회·변경.
 * 광고는 API 계열이 없어 CRAWL 고정 — 이 라우트가 다루는 필드에 광고는 없다.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errorResponse, assertRole } from '@/lib/api-helpers'
import { resolveCollectionAuth } from '@/lib/collection/resolve-workspace'
import type { CoupangDataSource } from '@/generated/prisma/client'

const DEFAULT_SETTING = {
  inventorySource: 'CRAWL' as CoupangDataSource,
  salesSource: 'CRAWL' as CoupangDataSource,
  settlementSource: 'CRAWL' as CoupangDataSource,
  productSource: 'CRAWL' as CoupangDataSource,
}

const SOURCE_FIELDS = [
  'inventorySource',
  'salesSource',
  'settlementSource',
  'productSource',
] as const
type SourceField = (typeof SOURCE_FIELDS)[number]

// GET /api/collection/source-setting — 세션/워커 양쪽. 레코드 없으면 전부 CRAWL 기본값 반환(생성 안 함).
export async function GET(request: NextRequest) {
  const auth = await resolveCollectionAuth(request)
  if ('error' in auth) return auth.error

  const setting = await prisma.coupangSourceSetting.findUnique({
    where: { workspaceId: auth.workspaceId },
    select: {
      inventorySource: true,
      salesSource: true,
      settlementSource: true,
      productSource: true,
    },
  })

  return NextResponse.json({ setting: setting ?? DEFAULT_SETTING })
}

// PATCH /api/collection/source-setting — 부분 갱신.
// API 로 바꾸려는데 CoupangApiCredential 이 없거나 isActive=false 면 400.
export async function PATCH(request: NextRequest) {
  const auth = await resolveCollectionAuth(request)
  if ('error' in auth) return auth.error
  if (auth.kind === 'session') {
    const permError = assertRole(auth.role, 'ADMIN')
    if (permError) return permError
  }

  let body: Partial<Record<SourceField, CoupangDataSource>>
  try {
    body = await request.json()
  } catch {
    return errorResponse('요청 본문이 올바르지 않습니다', 400)
  }

  const updates: Partial<Record<SourceField, CoupangDataSource>> = {}
  let switchesToApi = false
  for (const field of SOURCE_FIELDS) {
    const value = body[field]
    if (value === undefined) continue
    if (value !== 'CRAWL' && value !== 'API') {
      return errorResponse(`${field}는 CRAWL 또는 API여야 합니다`, 400)
    }
    updates[field] = value
    if (value === 'API') switchesToApi = true
  }

  if (Object.keys(updates).length === 0) {
    return errorResponse('변경할 필드가 없습니다', 400)
  }

  if (switchesToApi) {
    const apiCredential = await prisma.coupangApiCredential.findUnique({
      where: { workspaceId: auth.workspaceId },
      select: { isActive: true },
    })
    if (!apiCredential || !apiCredential.isActive) {
      return errorResponse(
        '쿠팡 Open API 자격증명이 등록되어 있지 않거나 비활성 상태입니다. 먼저 API 자격증명을 등록하세요.',
        400
      )
    }
  }

  const setting = await prisma.coupangSourceSetting.upsert({
    where: { workspaceId: auth.workspaceId },
    create: { workspaceId: auth.workspaceId, ...DEFAULT_SETTING, ...updates },
    update: updates,
    select: {
      inventorySource: true,
      salesSource: true,
      settlementSource: true,
      productSource: true,
    },
  })

  return NextResponse.json({ setting })
}
