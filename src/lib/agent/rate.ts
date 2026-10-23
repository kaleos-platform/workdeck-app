import { prisma } from '@/lib/prisma'
import { ToolUserError } from '@/lib/agent/tools/errors'

export class RateLimitedError extends ToolUserError {
  constructor() {
    super('잠시 후 다시 시도하세요')
    this.name = 'RateLimitedError'
  }
}

/**
 * ToolAuditLog에서 actorId·tool in tools·창 안(createdAt > now - windowMs) 행 수를 세어 limit 이상이면
 * RateLimitedError. 서버리스라 메모리 카운터는 쓰지 않는다.
 */
// ponytail: actorId·tool 인덱스 없음(테이블이 커지면 스캔) — 느려지면 @@index([actorId, tool, createdAt]) 마이그레이션.
// ponytail: count 뒤 insert라 동시 요청 몇 건은 limit을 넘을 수 있다 — 정확해야 하면 advisory lock.
export async function assertUnderRate(opts: {
  actorId: string
  tools: string[]
  limit: number
  windowMs: number
  now?: Date
}): Promise<void> {
  const now = opts.now ?? new Date()
  const n = await prisma.toolAuditLog.count({
    where: {
      actorId: opts.actorId,
      tool: { in: opts.tools },
      createdAt: { gt: new Date(now.getTime() - opts.windowMs) },
    },
  })
  if (n >= opts.limit) throw new RateLimitedError()
}
