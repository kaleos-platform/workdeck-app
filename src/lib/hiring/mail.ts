import 'server-only'
// 모집 관리 메일 알림 2종.
//  1) 지원자 「지원 접수 완료」 — 공개 지원 제출 직후(after) 발송. 실패해도 제출은 성공이다.
//  2) 담당자 「일일 새 지원자 요약」 — 매일 09시 KST cron. 지원자 개인정보는 넣지 않는다.
// 담당자 = 공고 작성자(현재 Space 멤버일 때). 없으면 Space OWNER·ADMIN.
import { after } from 'next/server'
import { prisma } from '@/lib/prisma'
import { decryptPii } from '@/lib/del/encryption'
import { buildAppUrl } from '@/lib/domain'
import { escapeHtml, formatFrom, sendEmail } from '@/lib/email/send'
import { RECRUITING_BASE_PATH } from '@/lib/deck-routes'
import { z } from 'zod'
import { dailyDigestPostingWhere } from './mail-settings'

type Recipient = { userId: string; email: string }

const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/** 공고 담당자 — 작성자가 아직 멤버면 작성자, 아니면 OWNER·ADMIN */
async function resolvePostingManagers(
  spaceId: string,
  authorUserId: string | null
): Promise<Recipient[]> {
  const members = await prisma.spaceMember.findMany({
    where: {
      spaceId,
      OR: [
        ...(authorUserId ? [{ userId: authorUserId }] : []),
        { role: { in: ['OWNER', 'ADMIN'] as const } },
      ],
    },
    select: { userId: true, role: true, user: { select: { email: true } } },
  })
  const author = members.find((m) => m.userId === authorUserId)
  const picked = author ? [author] : members.filter((m) => m.role !== 'MEMBER')
  return picked.map((m) => ({ userId: m.userId, email: m.user.email }))
}

function formatKstDateTime(d: Date): string {
  const k = new Date(d.getTime() + KST_OFFSET_MS)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${k.getUTCFullYear()}년 ${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일 ${pad(k.getUTCHours())}:${pad(k.getUTCMinutes())}`
}

function layout(paragraphs: string[]): string {
  return `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#111">${paragraphs
    .map((p) => `<p>${p}</p>`)
    .join('')}</div>`
}

// ─── 1) 지원 접수 완료 ─────────────────────────────────────────────────────────

export function buildReceiptEmail(input: {
  postingTitle: string
  submittedAt: Date
  hasReplyTo: boolean
}) {
  const at = formatKstDateTime(input.submittedAt)
  const contact = input.hasReplyTo
    ? '문의 사항은 이 메일에 회신하면 채용 담당자에게 전달됩니다.'
    : '문의 사항은 채용 공고에 안내된 연락처로 문의해 주세요.'
  const lines = [
    `「${input.postingTitle}」 지원서가 정상적으로 접수되었습니다.`,
    `접수 시각: ${at} (한국 시간)`,
    contact,
  ]
  return {
    subject: `[지원 접수 완료] ${input.postingTitle}`,
    text: lines.join('\n'),
    html: layout(lines.map(escapeHtml)),
  }
}

/** 지원자 접수 완료 메일. 절대 throw 하지 않는다(제출 흐름 보호). 로그에 개인정보 금지. */
export async function sendApplicantReceipt(applicationId: string): Promise<void> {
  try {
    const app = await prisma.hiringApplication.findFirst({
      where: { id: applicationId, deletedAt: null },
      select: {
        id: true,
        createdAt: true,
        emailEnc: true,
        emailIv: true,
        posting: {
          select: {
            title: true,
            spaceId: true,
            authorUserId: true,
            mailSetting: { select: { applicantReceiptEmail: true } },
            space: { select: { name: true } },
          },
        },
      },
    })
    if (!app?.emailEnc || !app.emailIv) return
    if (app.posting.mailSetting?.applicantReceiptEmail === false) return
    const to = decryptPii(app.emailEnc, app.emailIv)
    // 공개 폼 입력이라 단일 주소 형식만 허용(쉼표 다중 수신·잘못된 값 차단)
    if (!z.string().email().safeParse(to).success) return
    const managers = await resolvePostingManagers(app.posting.spaceId, app.posting.authorUserId)
    const replyTo = managers.map((m) => m.email)
    const mail = buildReceiptEmail({
      postingTitle: app.posting.title,
      submittedAt: app.createdAt,
      hasReplyTo: replyTo.length > 0,
    })
    await sendEmail({
      from: formatFrom(`${app.posting.space.name} via Workdeck`),
      to,
      ...(replyTo.length > 0 && { replyTo }),
      ...mail,
      idempotencyKey: `hiring-receipt/${app.id}`,
    })
  } catch (error) {
    console.error('[hiring-mail] 접수 완료 메일 실패', {
      applicationId,
      error: error instanceof Error ? error.message : 'unknown',
    })
  }
}

// ─── 2) 일일 새 지원자 요약 ────────────────────────────────────────────────────

/** now 기준 KST 전날 0시~24시 구간과 'YYYY-MM-DD' */
export function kstPreviousDay(now: Date) {
  const kstToday = new Date(now.getTime() + KST_OFFSET_MS)
  kstToday.setUTCHours(0, 0, 0, 0)
  const end = new Date(kstToday.getTime() - KST_OFFSET_MS)
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000)
  const date = new Date(start.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10)
  return { start, end, date }
}

type DigestItem = { title: string; count: number; url: string }

export function buildDigestEmail(date: string, items: DigestItem[]) {
  const total = items.reduce((sum, i) => sum + i.count, 0)
  const [, m, d] = date.split('-').map(Number)
  const head = `${m}월 ${d}일 새 지원자가 ${total}명 있습니다.`
  const text = [head, ...items.map((i) => `- ${i.title}: ${i.count}명 ${i.url}`)].join('\n')
  const html = layout([
    escapeHtml(head),
    `<ul>${items
      .map(
        (i) => `<li><a href="${escapeHtml(i.url)}">${escapeHtml(i.title)}</a>: ${i.count}명</li>`
      )
      .join('')}</ul>`,
    '지원자 정보는 워크덱 「모집 관리」에서 확인하세요. 알림은 공고 설정의 「새 지원자 일일 요약 메일」에서 끌 수 있습니다.',
  ])
  return { subject: `[워크덱 모집 관리] 어제 새 지원자 ${total}명`, text, html }
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}

// 선점 후 함수가 강제 종료되면 sentAt 없는 행이 남는다 — 이 시간이 지나면 다시 선점한다.
const STALE_CLAIM_MS = 30 * 60 * 1000

/** (수신자, 집계일) 발송 권한 선점. 이미 보냈거나 다른 실행이 진행 중이면 null. */
async function claimDigest(userId: string, date: string, items: DigestItem[], now: Date) {
  const counts = {
    postingCount: items.length,
    applicationCount: items.reduce((sum, i) => sum + i.count, 0),
  }
  try {
    const log = await prisma.hiringDailyDigestLog.create({
      data: { userId, digestDate: date, ...counts },
      select: { id: true },
    })
    return log.id
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
  }
  const reclaimed = await prisma.hiringDailyDigestLog.updateMany({
    where: {
      userId,
      digestDate: date,
      sentAt: null,
      createdAt: { lt: new Date(now.getTime() - STALE_CLAIM_MS) },
    },
    data: { createdAt: now, ...counts },
  })
  if (!reclaimed.count) return null
  const log = await prisma.hiringDailyDigestLog.findUnique({
    where: { userId_digestDate: { userId, digestDate: date } },
    select: { id: true },
  })
  return log?.id ?? null
}

/** 알림 켠 공고의 전날 새 지원을 담당자별로 묶어 1통씩 보낸다. (수신자, 집계일) 1회 보장. */
export async function runDailyDigest(now = new Date()) {
  const { start, end, date } = kstPreviousDay(now)
  const groups = await prisma.hiringApplication.groupBy({
    by: ['postingId'],
    where: {
      createdAt: { gte: start, lt: end },
      deletedAt: null,
      directRegistration: false,
      posting: dailyDigestPostingWhere,
    },
    _count: { _all: true },
  })
  const counts = new Map(groups.map((g) => [g.postingId, g._count._all]))
  const postings = counts.size
    ? await prisma.hiringPosting.findMany({
        where: { id: { in: [...counts.keys()] } },
        select: { id: true, title: true, spaceId: true, authorUserId: true },
        orderBy: { createdAt: 'asc' },
      })
    : []

  const byRecipient = new Map<string, { email: string; items: DigestItem[] }>()
  const managerCache = new Map<string, Promise<Recipient[]>>()
  for (const posting of postings) {
    const key = `${posting.spaceId}:${posting.authorUserId ?? ''}`
    if (!managerCache.has(key))
      managerCache.set(key, resolvePostingManagers(posting.spaceId, posting.authorUserId))
    for (const manager of await managerCache.get(key)!) {
      const entry = byRecipient.get(manager.userId) ?? { email: manager.email, items: [] }
      entry.items.push({
        title: posting.title,
        count: counts.get(posting.id) ?? 0,
        url: buildAppUrl(`${RECRUITING_BASE_PATH}/applications?posting=${posting.id}`),
      })
      byRecipient.set(manager.userId, entry)
    }
  }

  let sent = 0
  let skipped = 0
  let failed = 0
  for (const [userId, { email, items }] of byRecipient) {
    const logId = await claimDigest(userId, date, items, now)
    if (!logId) {
      skipped++
      continue
    }
    try {
      const delivered = await sendEmail({
        from: formatFrom('Workdeck 모집 관리'),
        to: email,
        ...buildDigestEmail(date, items),
        idempotencyKey: `hiring-digest/${userId}/${date}`,
      })
      if (!delivered) throw new Error('RESEND_API_KEY 미설정')
      await prisma.hiringDailyDigestLog.update({
        where: { id: logId },
        data: { sentAt: new Date() },
      })
      sent++
    } catch (error) {
      failed++
      console.error('[hiring-mail] 일일 요약 실패', {
        userId,
        error: error instanceof Error ? error.message : 'unknown',
      })
      await prisma.hiringDailyDigestLog.delete({ where: { id: logId } }).catch(() => undefined)
    }
  }
  return { date, postings: postings.length, recipients: byRecipient.size, sent, skipped, failed }
}

/** 응답 후 접수 완료 메일 예약 — 공개 제출 라우트에서 새 지원서가 생성됐을 때만 호출한다 */
// 예약 실패도 제출 응답을 바꾸면 안 되므로 삼킨다.
export function queueApplicantReceipt(applicationId: string) {
  try {
    after(() => sendApplicantReceipt(applicationId))
  } catch (error) {
    console.error('[hiring-mail] 접수 완료 메일 예약 실패', {
      applicationId,
      error: error instanceof Error ? error.message : 'unknown',
    })
  }
}
