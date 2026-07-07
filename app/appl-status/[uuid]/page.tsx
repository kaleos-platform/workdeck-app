// 지원 상태 공개열람(server component, 무인증).
// uuid = HiringApplicationNotification.uuid, token = 원문(HMAC 해시 상수시간 비교).
import { prisma } from '@/lib/prisma'
import { verifyNotificationToken } from '@/lib/hiring/pii'
import { NOTIFICATION_LABELS } from '@/lib/hiring/applications'

type Props = {
  params: Promise<{ uuid: string }>
  searchParams: Promise<{ token?: string }>
}

const NOTI_MESSAGE: Record<string, string> = {
  INTERVIEW: '면접 안내드립니다. 자세한 내용은 아래를 확인해 주세요.',
  JOB_OFFER: '처우 협의 안내드립니다. 자세한 내용은 아래를 확인해 주세요.',
  ACCEPTED: '축하합니다! 합격하셨습니다.',
  REJECTED: '지원해 주셔서 감사합니다. 아쉽게도 이번에는 함께하지 못하게 되었습니다.',
}

// 토큰 검증(DB 조회 + 만료 + 상수시간 비교) — 컴포넌트 렌더 밖 순수 로직으로 분리.
async function resolveNotification(uuid: string, token?: string) {
  if (!token) return null
  const noti = await prisma.hiringApplicationNotification.findUnique({
    where: { uuid },
    select: { notiType: true, detailMessage: true, tokenHash: true, tokenExpireAt: true },
  })
  if (!noti) return null
  const valid =
    noti.tokenExpireAt.getTime() > Date.now() && verifyNotificationToken(token, noti.tokenHash)
  return valid ? noti : null
}

export default async function ApplStatusPage({ params, searchParams }: Props) {
  const { uuid } = await params
  const { token } = await searchParams

  const noti = await resolveNotification(uuid, token)

  if (!noti) {
    return (
      <div className="space-y-3 rounded-lg border bg-card p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold">확인할 수 없는 링크입니다</h1>
        <p className="text-sm text-muted-foreground">
          링크가 만료되었거나 올바르지 않습니다. 담당자에게 문의해 주세요.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4 rounded-lg border bg-card p-8 shadow-sm">
      <div className="space-y-1 text-center">
        <p className="text-xs font-medium text-muted-foreground">
          {NOTIFICATION_LABELS[noti.notiType]}
        </p>
        <h1 className="text-lg font-semibold">{NOTI_MESSAGE[noti.notiType]}</h1>
      </div>
      {noti.detailMessage && (
        <div className="rounded-md border bg-muted/30 p-4 text-sm whitespace-pre-wrap">
          {noti.detailMessage}
        </div>
      )}
    </div>
  )
}
