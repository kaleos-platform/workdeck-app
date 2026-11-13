import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'

// 공고 메일 알림 실효값. 일일 요약은 설정 행 값이 우선이고, 없으면 기존 공고 notificationEnabled.

export type PostingMailSettings = { notificationEnabled: boolean; applicantReceiptEmail: boolean }

export function effectiveMailSettings(posting: {
  notificationEnabled: boolean
  mailSetting: { applicantReceiptEmail: boolean; dailyDigestEmail: boolean | null } | null
}): PostingMailSettings {
  return {
    notificationEnabled: posting.mailSetting?.dailyDigestEmail ?? posting.notificationEnabled,
    applicantReceiptEmail: posting.mailSetting?.applicantReceiptEmail ?? true,
  }
}

export async function getPostingMailSettings(postingId: string) {
  const posting = await prisma.hiringPosting.findUniqueOrThrow({
    where: { id: postingId },
    select: {
      notificationEnabled: true,
      mailSetting: { select: { applicantReceiptEmail: true, dailyDigestEmail: true } },
    },
  })
  return effectiveMailSettings(posting)
}

/** 일일 요약 대상 공고 조건 */
export const dailyDigestPostingWhere: Prisma.HiringPostingWhereInput = {
  OR: [
    { mailSetting: { is: { dailyDigestEmail: true } } },
    {
      notificationEnabled: true,
      OR: [{ mailSetting: { is: null } }, { mailSetting: { is: { dailyDigestEmail: null } } }],
    },
  ],
}
