// 워크스페이스 보장(ensure) 헬퍼 — 계정(User)당 1 Workspace.
//
// POST /api/workspace 와 크레덴셜 설정(seller-ops 진입점)이 공유한다.
// Supabase Auth UUID ↔ Prisma User 동기화 + Workspace + (최초 1회)Space 구조 생성을
// 한 트랜잭션으로 묶어, 어느 Deck 에서 먼저 호출해도 동일하게 계정에 존속된다.

import { prisma } from '@/lib/prisma'

export type EnsureWorkspaceUser = {
  id: string
  email?: string | null
  name?: string | null
}

export type EnsureWorkspaceResult = {
  workspace: { id: string; name: string }
  created: boolean
}

/**
 * 유저의 Workspace 를 보장한다(없으면 생성). User upsert + Space 구조 복구 포함.
 * @param name 신규 생성 시 워크스페이스 이름. 비면 email local-part / "내 워크스페이스".
 */
export async function ensureWorkspaceForUser(
  user: EnsureWorkspaceUser,
  name?: string
): Promise<EnsureWorkspaceResult> {
  // Supabase Auth UUID ↔ Prisma User 동기화
  await prisma.user.upsert({
    where: { id: user.id },
    create: { id: user.id, email: user.email ?? '', name: user.name ?? null },
    update: { email: user.email ?? '' },
  })

  const fallbackName = name?.trim() || user.email?.split('@')[0]?.trim() || '내 워크스페이스'

  return prisma.$transaction(async (tx) => {
    // 동시 최초 가입 / 레거시 계정 동시 접근 레이스 방지.
    // $queryRaw는 void 반환 컬럼을 역직렬화하지 못하므로 $executeRaw 사용.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}))`

    const existing = await tx.workspace.findUnique({
      where: { ownerId: user.id },
      select: { id: true, name: true },
    })

    const workspace =
      existing ??
      (await tx.workspace.create({
        data: { name: fallbackName, ownerId: user.id },
        select: { id: true, name: true },
      }))

    const existingMembership = await tx.spaceMember.findFirst({
      where: { userId: user.id },
      select: { id: true },
    })

    // 기존 계정 호환: Workspace만 존재하는 계정은 Space 구조를 자동 복구한다.
    if (!existingMembership) {
      await tx.deckApp.upsert({
        where: { id: 'coupang-ads' },
        create: { id: 'coupang-ads', name: '쿠팡 광고 자동화', isActive: true },
        update: {},
      })
      await tx.space.create({
        data: {
          name: workspace.name,
          type: 'PERSONAL',
          members: { create: { userId: user.id, role: 'OWNER' } },
          deckInstances: { create: { deckAppId: 'coupang-ads', isActive: true } },
        },
      })
    }

    return { workspace, created: !existing }
  })
}
