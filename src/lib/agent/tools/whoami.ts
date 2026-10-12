import { prisma } from '@/lib/prisma'
import { getSpaceName } from '@/lib/mcp/context'
import type { ToolDefinition } from './types'

/** 현재 행위자·Space·scope·활성 카드를 반환하는 진단용 tool. MCP 연결·인증 확인에 쓴다. */
export const whoamiTool: ToolDefinition = {
  name: 'whoami',
  description:
    '현재 행위자(구성원·에이전트·연동 계정), 소속 공간, 허용된 scope, 활성화된 카드 목록을 반환합니다.',
  inputSchema: {},
  mode: 'read',
  scope: null,
  async execute(ctx) {
    const [name, activeInstances] = await Promise.all([
      getSpaceName(ctx.spaceId),
      prisma.deckInstance.findMany({
        where: { spaceId: ctx.spaceId, isActive: true },
        select: { deckAppId: true },
      }),
    ])
    let actorName: string | null = null
    if (ctx.actor.type === 'user') {
      const u = await prisma.user.findUnique({
        where: { id: ctx.actor.id },
        select: { email: true },
      })
      actorName = u?.email ?? null
    } else if (ctx.actor.type === 'agent' || ctx.actor.type === 'integration') {
      const a = await prisma.spaceAgent.findUnique({
        where: { id: ctx.actor.id },
        select: { name: true },
      })
      actorName = a?.name ?? null
    }
    return {
      actor: { ...ctx.actor, name: actorName },
      space: { id: ctx.spaceId, name },
      scopes: ctx.scopes,
      activeDecks: activeInstances.map((d) => d.deckAppId),
      workId: ctx.workId,
    }
  },
}
