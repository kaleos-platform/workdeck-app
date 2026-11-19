import type { Prisma } from '@/generated/prisma/client'

// 사용자 단위 직렬화 — Space 생성과 오프닝 이전 job 승인이 같은 키를 잡아 서로 경합하지 않게 한다.
export async function lockOwnerSpaces(tx: Prisma.TransactionClient, userId: string) {
  // $queryRaw 는 void 반환 컬럼을 역직렬화하지 못하므로 $executeRaw 를 쓴다(src/lib/workspace.ts 와 같은 이유).
  // ensureWorkspaceForUser(src/lib/workspace.ts)와 같은 키 — 가입·Space 생성·승인이 서로 직렬화된다.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`
}
