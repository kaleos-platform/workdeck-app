import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

// 트리 노드 타입
type CategoryNode = {
  id: string
  spaceId: string
  parentId: string | null
  name: string
  code: string | null
  alias: string | null
  type: string
  groupLabel: string | null
  isSystem: boolean
  isActive: boolean
  sortOrder: number
  _count: { transactions: number }
  children: CategoryNode[]
}

// 조회: spaceId 기준 모든 계정과목을 트리 구조로 반환
export async function GET() {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const all = await prisma.finCategory.findMany({
    where: { spaceId },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      spaceId: true,
      parentId: true,
      name: true,
      code: true,
      alias: true,
      type: true,
      groupLabel: true,
      isSystem: true,
      isActive: true,
      sortOrder: true,
      _count: { select: { transactions: true } },
    },
  })

  // id → 노드 맵 구성
  const map = new Map<string, CategoryNode>()
  for (const row of all) {
    map.set(row.id, { ...row, children: [] })
  }

  // 트리 구성 — 최상위(parentId=null)만 roots에 수집
  const roots: CategoryNode[] = []
  for (const node of map.values()) {
    if (node.parentId === null) {
      roots.push(node)
    } else {
      const parent = map.get(node.parentId)
      if (parent) parent.children.push(node)
    }
  }

  // roots는 이미 sortOrder asc 정렬(DB orderBy 그대로)
  return NextResponse.json({ tree: roots })
}

// 생성: 사용자 하위계정 추가 (parentId 필수, 부모 type 상속)
export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const body = await req.json().catch(() => ({}))
  const { parentId, name, alias, groupLabel } = body as {
    parentId?: string
    name?: string
    alias?: string
    groupLabel?: string
  }

  if (!parentId) return errorResponse('parentId가 필요합니다', 400)
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return errorResponse('계정과목 이름이 필요합니다', 400)
  }

  // 부모 카테고리 소유 검증
  const parent = await prisma.finCategory.findFirst({
    where: { id: parentId, spaceId },
    select: { id: true, type: true },
  })
  if (!parent) return errorResponse('부모 계정과목을 찾을 수 없습니다', 400)

  // 형제 중 최대 sortOrder 조회
  const maxSortResult = await prisma.finCategory.aggregate({
    where: { spaceId, parentId },
    _max: { sortOrder: true },
  })
  const nextSortOrder = (maxSortResult._max.sortOrder ?? 0) + 1

  // 카테고리 생성 (@@unique 위반 시 409)
  try {
    const category = await prisma.finCategory.create({
      data: {
        spaceId,
        parentId,
        name: name.trim(),
        type: parent.type,
        isSystem: false,
        isActive: true,
        sortOrder: nextSortOrder,
        alias: alias ?? null,
        groupLabel: groupLabel ?? null,
      },
    })
    return NextResponse.json({ category }, { status: 201 })
  } catch (e: unknown) {
    const err = e as { code?: string }
    if (err?.code === 'P2002') {
      return errorResponse('이미 존재하는 계정과목입니다', 409)
    }
    throw e
  }
}
