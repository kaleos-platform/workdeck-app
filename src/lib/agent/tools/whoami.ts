import { prisma } from '@/lib/prisma'
import { resolveMcpSpaceContext } from '@/lib/mcp/context'
import type { ToolDefinition } from './types'

/**
 * 현재 인증된 사용자·소속 공간·활성 카드 목록을 반환하는 진단용 tool.
 * MCP 연결/인증이 올바른지 확인하는 최소 read tool.
 */
export const whoamiTool: ToolDefinition = {
  name: 'whoami',
  description: '현재 인증된 사용자, 소속 공간과 역할, 활성화된 카드 목록을 반환합니다.',
  inputSchema: {}, // 입력 없음 — 빈 zod raw shape
  mode: 'read',
  async execute(ctx) {
    const { space, role } = await resolveMcpSpaceContext(ctx.userId)

    const user = await prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { id: true, email: true, name: true },
    })
    if (!user) throw new Error('사용자를 찾을 수 없습니다')

    const activeInstances = await prisma.deckInstance.findMany({
      where: { spaceId: space.id, isActive: true },
      select: { deckAppId: true },
    })
    const activeDecks = activeInstances.map((d) => d.deckAppId)

    return {
      user: { id: user.id, email: user.email, name: user.name },
      space: { id: space.id, name: space.name, role },
      activeDecks,
    }
  },
}
