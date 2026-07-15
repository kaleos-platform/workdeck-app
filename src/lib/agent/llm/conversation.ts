import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'

/**
 * Slack 스레드(channelId + threadTs) 단위 대화 세션.
 * messages는 최근 20턴만 유지(초과분은 앞에서 잘라낸다) — 컨텍스트 폭주·토큰 낭비 방지.
 */

// Anthropic messages 왕복에 넣을 최소 대화 턴. content는 문자열 텍스트만 저장한다
// (tool_use/tool_result 블록은 loop 내부에서만 쓰고, 영속 히스토리엔 최종 텍스트만 남긴다).
export interface ConversationTurn {
  role: 'user' | 'assistant'
  content: string
}

const MAX_TURNS = 20

/** 스레드의 저장된 대화 턴을 반환한다(없으면 빈 배열). */
export async function loadConversation(
  channelId: string,
  threadTs: string
): Promise<ConversationTurn[]> {
  const row = await prisma.agentConversation.findUnique({
    where: { channelId_threadTs: { channelId, threadTs } },
    select: { messages: true },
  })
  if (!row) return []
  const raw = row.messages as unknown
  if (!Array.isArray(raw)) return []
  // 저장 형태를 신뢰하되, 방어적으로 role/content만 추린다.
  return raw
    .filter(
      (m): m is ConversationTurn =>
        !!m &&
        typeof m === 'object' &&
        'role' in m &&
        ((m as ConversationTurn).role === 'user' || (m as ConversationTurn).role === 'assistant') &&
        'content' in m &&
        typeof (m as ConversationTurn).content === 'string'
    )
    .slice(-MAX_TURNS)
}

/**
 * 이번 사용자 발화 + 어시스턴트 응답을 스레드에 이어붙인다(최근 20턴 유지).
 * upsert로 스레드 최초 발화면 생성한다.
 */
export async function appendConversation(args: {
  spaceId: string
  channelId: string
  threadTs: string
  userText: string
  assistantText: string
}): Promise<void> {
  const prev = await loadConversation(args.channelId, args.threadTs)
  const appended: ConversationTurn[] = [
    ...prev,
    { role: 'user', content: args.userText },
    { role: 'assistant', content: args.assistantText },
  ]
  const next = appended.slice(-MAX_TURNS)

  await prisma.agentConversation.upsert({
    where: { channelId_threadTs: { channelId: args.channelId, threadTs: args.threadTs } },
    create: {
      spaceId: args.spaceId,
      channelId: args.channelId,
      threadTs: args.threadTs,
      messages: next as unknown as Prisma.InputJsonValue,
    },
    update: {
      messages: next as unknown as Prisma.InputJsonValue,
    },
  })
}
