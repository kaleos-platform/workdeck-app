import { ToolUserError } from '@/lib/agent/tools/errors'
import { prisma } from '@/lib/prisma'

/**
 * MCP tool executor 전용 Space 게이트. 순수 데이터를 반환하고 실패는 한국어 Error를 throw한다.
 * 입력은 항상 McpToolContext.spaceId — 사용자 멤버십으로 Space를 다시 추론하지 않는다.
 */

/** Space 이름 (whoami용). */
export async function getSpaceName(spaceId: string): Promise<string> {
  const space = await prisma.space.findUnique({ where: { id: spaceId }, select: { name: true } })
  if (!space) throw new ToolUserError('공간이 없습니다')
  return space.name
}

/** Deck이 이 Space에서 활성인지 확인한다. 아니면 throw. */
export async function requireDeck(spaceId: string, deckKey: string): Promise<void> {
  const deckInstance = await prisma.deckInstance.findUnique({
    where: { spaceId_deckAppId: { spaceId, deckAppId: deckKey } },
    select: { isActive: true },
  })
  if (!deckInstance?.isActive) throw new ToolUserError(`${deckKey} 카드가 활성화되지 않았습니다`)
}

/** coupang-ads(레거시 Workspace 스코프) — Workspace.spaceId FK로만 찾는다. */
export async function resolveMcpWorkspace(spaceId: string): Promise<{ id: string }> {
  await requireDeck(spaceId, 'coupang-ads').catch(() => {
    throw new ToolUserError('쿠팡 광고 카드가 활성화되지 않았습니다')
  })
  const workspace = await prisma.workspace.findUnique({ where: { spaceId }, select: { id: true } })
  if (!workspace) throw new ToolUserError('쿠팡 워크스페이스가 이 Space에 연결되어 있지 않습니다')
  return workspace
}
