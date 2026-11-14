import 'server-only'
import { prisma } from '@/lib/prisma'
import { evaluateDeckAccess } from './entitlement-core'
import { isCheckoutPausedFor } from './entitlement'
import type { SubscriptionAccessOverview } from './subscription-admin-types'
import {
  trialEndOfKstDay,
  type AdminSubscriptionPatch,
} from '@/lib/validations/admin-subscriptions'

export class SubscriptionAdminError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}

export async function getSubscriptionAccessOverview(
  now = new Date()
): Promise<SubscriptionAccessOverview> {
  const [spaces, products] = await Promise.all([
    prisma.space.findMany({
      orderBy: { name: 'asc' },
      include: {
        members: {
          where: { role: 'OWNER' },
          select: { user: { select: { id: true, email: true, name: true } } },
        },
        deckInstances: { select: { deckAppId: true, createdAt: true } },
        deckAccessPolicies: true,
        subscription: { include: { items: { where: { type: 'DECK' } } } },
      },
    }),
    prisma.billingDeckProduct.findMany({ orderBy: { name: 'asc' } }),
  ])
  return {
    spaces: spaces.map((space) => ({
      id: space.id,
      name: space.name,
      owners: space.members.map((member) => member.user),
      exemptFlag: space.subscription?.exemptFlag ?? false,
      exemptNote: space.subscription?.exemptNote ?? null,
    })),
    rows: spaces.flatMap((space) => {
      const subscription = space.subscription
      const activeDeckItemIds =
        subscription?.items
          .filter((item) => item.status === 'ACTIVE' || item.status === 'CANCEL_AT_PERIOD_END')
          .map((item) => item.deckAppId) ?? []
      const known = new Set([
        ...space.deckInstances.map((instance) => instance.deckAppId),
        ...space.deckAccessPolicies.map((policy) => policy.deckAppId),
        ...(subscription?.items.map((item) => item.deckAppId) ?? []),
      ])
      return products
        .filter((product) => known.has(product.id))
        .map((product) => {
          const policy = space.deckAccessPolicies.find((value) => value.deckAppId === product.id)
          const item = subscription?.items.find((value) => value.deckAppId === product.id)
          const paid =
            !!subscription &&
            ['ACTIVE', 'PAST_DUE'].includes(subscription.status) &&
            activeDeckItemIds.includes(product.id)
          return {
            spaceId: space.id,
            spaceName: space.name,
            owners: space.members.map((member) => member.user),
            deckAppId: product.id,
            deckName: product.name,
            pricingMode: product.pricingMode,
            accessReason: evaluateDeckAccess({
              product,
              subscription: subscription ? { ...subscription, activeDeckItemIds } : null,
              deckAccess: policy,
              deckInstanceCreatedAt:
                space.deckInstances.find((value) => value.deckAppId === product.id)?.createdAt ??
                null,
              now,
              checkoutPaused: isCheckoutPausedFor(space.id),
            }).reason,
            trialEndsAt: policy?.trialEndsAt?.toISOString() ?? null,
            currentPeriodEnd: subscription?.currentPeriodEnd?.toISOString() ?? null,
            subscriptionStatus: subscription?.status ?? null,
            itemStatus: item?.status ?? null,
            spaceExempt: subscription?.exemptFlag ?? false,
            exemptFlag: policy?.exemptFlag ?? false,
            exemptNote: policy?.exemptNote ?? null,
            canExtendTrial:
              !!policy?.trialEndsAt && product.pricingMode === 'SUBSCRIPTION' && !paid,
          }
        })
    }),
  }
}

export async function updateSubscriptionAccess(
  actorUserId: string,
  spaceId: string,
  deckAppId: string,
  patch: AdminSubscriptionPatch,
  now = new Date()
) {
  try {
    return await prisma.$transaction(
      async (tx) => {
        // 같은 Space의 청구 예약과 정책 변경을 같은 행 잠금으로 직렬화한다.
        await tx.$queryRaw`SELECT id FROM "Space" WHERE id=${spaceId} FOR UPDATE`
        const [space, product, instance, before, subscription, pendingCharge] = await Promise.all([
          tx.space.findUnique({ where: { id: spaceId }, select: { id: true } }),
          tx.billingDeckProduct.findUnique({ where: { id: deckAppId } }),
          tx.deckInstance.findUnique({
            where: { spaceId_deckAppId: { spaceId, deckAppId } },
            select: { id: true },
          }),
          tx.spaceDeckAccess.findUnique({ where: { spaceId_deckAppId: { spaceId, deckAppId } } }),
          tx.spaceSubscription.findUnique({
            where: { spaceId },
            include: { items: { where: { type: 'DECK', deckAppId } } },
          }),
          tx.billingCharge.findFirst({
            where: { spaceId, status: 'PENDING' },
            select: { id: true },
          }),
        ])
        if (!space || !product || (!instance && !before && !subscription?.items.length)) {
          throw new SubscriptionAdminError(404, '대상 업무를 찾을 수 없습니다')
        }
        if (pendingCharge)
          throw new SubscriptionAdminError(
            409,
            '처리 중인 청구가 있습니다. 결제 결과 확인 후 다시 시도해 주세요'
          )
        const paid =
          subscription &&
          ['ACTIVE', 'PAST_DUE'].includes(subscription.status) &&
          subscription.items.some(
            (item) => item.status === 'ACTIVE' || item.status === 'CANCEL_AT_PERIOD_END'
          )
        let data: { trialEndsAt: Date } | { exemptFlag: boolean; exemptNote: string }
        if ('trialEndsOn' in patch) {
          if (!before?.trialEndsAt || product.pricingMode !== 'SUBSCRIPTION' || paid) {
            throw new SubscriptionAdminError(409, '체험을 연장할 수 없는 업무입니다')
          }
          const trialEndsAt = trialEndOfKstDay(patch.trialEndsOn)
          if (trialEndsAt <= now || trialEndsAt <= before.trialEndsAt) {
            throw new SubscriptionAdminError(
              400,
              '현재와 기존 종료일보다 늦은 날짜를 선택해 주세요'
            )
          }
          data = { trialEndsAt }
        } else {
          data = { exemptFlag: patch.exempt, exemptNote: patch.note }
        }
        if (before) {
          const updated = await tx.spaceDeckAccess.updateMany({
            where: {
              spaceId,
              deckAppId,
              trialEndsAt: before.trialEndsAt,
              exemptFlag: before.exemptFlag,
              updatedAt: before.updatedAt,
            },
            data,
          })
          if (updated.count !== 1)
            throw new SubscriptionAdminError(
              409,
              '정책이 변경되었습니다. 새로고침 후 다시 시도해 주세요'
            )
        } else {
          await tx.spaceDeckAccess.create({ data: { spaceId, deckAppId, ...data } })
        }
        if ('exempt' in patch && patch.exempt && subscription) {
          await tx.subscriptionItem.updateMany({
            where: {
              subscriptionId: subscription.id,
              type: 'DECK',
              deckAppId,
              status: { in: ['ACTIVE', 'CANCEL_AT_PERIOD_END'] },
            },
            data: { status: 'ENDED', endedAt: now },
          })
        }
        let subscriptionCanceled = false
        if (
          'exempt' in patch &&
          patch.exempt &&
          subscription &&
          ['ACTIVE', 'PAST_DUE'].includes(subscription.status)
        ) {
          const remaining = await tx.subscriptionItem.count({
            where: {
              subscriptionId: subscription.id,
              status: { in: ['ACTIVE', 'CANCEL_AT_PERIOD_END'] },
            },
          })
          if (remaining === 0) {
            const updated = await tx.spaceSubscription.updateMany({
              where: { id: subscription.id, status: subscription.status },
              data: { status: 'CANCELED', retryCount: 0 },
            })
            if (updated.count !== 1)
              throw new SubscriptionAdminError(
                409,
                '구독이 변경되었습니다. 새로고침 후 다시 시도해 주세요'
              )
            subscriptionCanceled = true
          }
        }
        const prior = {
          trialEndsAt: before?.trialEndsAt?.toISOString() ?? null,
          exemptFlag: before?.exemptFlag ?? false,
          exemptNote: before?.exemptNote ?? null,
        }
        const after = {
          ...prior,
          ...('trialEndsAt' in data ? { trialEndsAt: data.trialEndsAt.toISOString() } : data),
        }
        await tx.adminAuditLog.create({
          data: {
            actorUserId,
            action:
              'trialEndsOn' in patch ? 'billing.deck.trial.extend' : 'billing.deck.exempt.update',
            targetType: 'spaceDeckAccess',
            targetId: `${spaceId}:${deckAppId}`,
            meta: {
              spaceId,
              deckAppId,
              note: patch.note,
              before: prior,
              after,
              subscriptionStatusBefore: subscription?.status ?? null,
              subscriptionStatusAfter: subscriptionCanceled
                ? 'CANCELED'
                : (subscription?.status ?? null),
            },
          },
        })
        return { spaceId, deckAppId, ...after }
      },
      { isolationLevel: 'Serializable' }
    )
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 'P2002' || error.code === 'P2034')
    ) {
      throw new SubscriptionAdminError(409, '정책이 변경되었습니다. 새로고침 후 다시 시도해 주세요')
    }
    throw error
  }
}
