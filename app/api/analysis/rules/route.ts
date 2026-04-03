// GET/POST /api/analysis/rules — 분석 규칙 목록 조회 및 추가

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'

// GET — 활성 분석 규칙 목록 조회
export async function GET() {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const rules = await prisma.analysisRule.findMany({
    where: { workspaceId: workspace.id, isActive: true },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      rule: true,
      source: true,
      isActive: true,
      appliedCount: true,
      createdAt: true,
    },
  })

  return NextResponse.json({ rules })
}

// POST — 새 분석 규칙 추가
export async function POST(request: NextRequest) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  let body: { rule?: string; source?: string }
  try {
    body = await request.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const { rule, source } = body

  if (!rule || typeof rule !== 'string' || rule.trim().length === 0) {
    return errorResponse('rule 필드가 필요합니다', 400)
  }

  const validSources = ['user', 'model', 'system']
  if (!source || !validSources.includes(source)) {
    return errorResponse('source는 "user", "model", "system" 중 하나여야 합니다', 400)
  }

  const created = await prisma.analysisRule.create({
    data: {
      workspaceId: workspace.id,
      rule: rule.trim(),
      source,
    },
    select: {
      id: true,
      rule: true,
      source: true,
      isActive: true,
      appliedCount: true,
      createdAt: true,
    },
  })

  return NextResponse.json(created, { status: 201 })
}
