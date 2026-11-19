import { canUseDeck, ensureTrialStarted } from '@/lib/billing/entitlement'
import { findClosedDecks } from '@/lib/billing/deck-release'
import type { Prisma } from '@/generated/prisma/client'

export type EnableDeckErrorCode =
  | 'DECK_CLOSED'
  | 'DECK_ALREADY_ACTIVE'
  | 'DECK_SUBSCRIPTION_REQUIRED'

export class EnableDeckError extends Error {
  constructor(readonly code: EnableDeckErrorCode) {
    super(code)
  }
}

/**
 * Space 에 업무를 켠다(준비중 가드 → 체험 시작 → 사용 가능 확인 → DeckInstance 생성·재활성).
 * 호출자 transaction 안에서 실행하며, 막히면 EnableDeckError 를 던져 전체를 롤백시킨다.
 * finance 시드처럼 transaction 밖에서 할 일은 호출자 몫이다.
 */
export async function enableDeckInTx(
  tx: Prisma.TransactionClient,
  spaceId: string,
  deckAppId: string
) {
  // 준비중 업무는 신규 추가 불가. Trial lazy-start 보다 먼저 막아야 평생 1회 Trial 이 소모되지 않는다.
  if ((await findClosedDecks(spaceId, [deckAppId], tx)).length > 0)
    throw new EnableDeckError('DECK_CLOSED')

  const existing = await tx.deckInstance.findUnique({
    where: { spaceId_deckAppId: { spaceId, deckAppId } },
    select: { id: true, isActive: true },
  })
  if (existing?.isActive) throw new EnableDeckError('DECK_ALREADY_ACTIVE')

  await ensureTrialStarted(spaceId, deckAppId, tx)
  if (!(await canUseDeck(spaceId, deckAppId, tx)))
    throw new EnableDeckError('DECK_SUBSCRIPTION_REQUIRED')
  const select = { id: true, deckAppId: true, isActive: true } as const
  const instance = existing
    ? await tx.deckInstance.update({ where: { id: existing.id }, data: { isActive: true }, select })
    : await tx.deckInstance.create({ data: { spaceId, deckAppId, isActive: true }, select })
  return { instance, reactivated: Boolean(existing) }
}
