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

/**
 * 크롤링 고정 스코프 — API 로 전환할 수 없다.
 *
 * 재고: 로켓창고 재고 API 는 주문가능수량과 30일 판매량만 준다. 재고건전성 엑셀이 주는
 * 반품 등급·입고예정·보관일수·소진예상·보관료·아이템위너 등 12개 컬럼이 전부 빠지고,
 * 그 컬럼들은 재고현황 화면·재고 분석기·발주 판단이 실제로 쓰고 있다. prod 실측 기준
 * 반품 등급 옵션 106개(재고 117개)가 정상품과 구분되지 않아 총량만 맞고 성격이 사라진다.
 *
 * 판매·주문: 로켓그로스 주문 API 는 주문/수량/단가만 준다. 판매분석(VENDOR) 크롤링이 주는
 * totalCancelled(취소)·orderCount 가 없어 취소를 반영할 수 없고, 현재 판매 lineage 인
 * OUTBOUND 장부와 달리 주문수요 축이라 발주 실적 모니터링과 어긋난다.
 *
 * UI 에서도 잠그지만(coupang-source-card.tsx) 여기서 함께 막는다 — UI 잠금만으로는
 * API 를 직접 호출해 우회할 수 있고, 그러면 워커가 그대로 API 수집을 수행한다.
 */
const CRAWL_ONLY_FIELDS: Partial<Record<SourceField, string>> = {
  inventorySource:
    '재고는 크롤링 전용입니다. 쿠팡 Open API 가 반품 등급·입고예정·보관일수를 제공하지 않아 재고 파악이 부정확해집니다.',
  salesSource:
    '판매·주문은 크롤링 전용입니다. 쿠팡 Open API 주문 조회가 취소 정보를 제공하지 않고, 집계 축이 달라 출고 장부와 어긋납니다.',
  settlementSource:
    '정산은 크롤링 전용입니다. 쿠팡 Open API 매출내역이 판매자배송만 제공하고 로켓그로스 정산은 포함하지 않습니다.',
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
    if (value === 'API' && CRAWL_ONLY_FIELDS[field]) {
      return errorResponse(CRAWL_ONLY_FIELDS[field]!, 400)
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
