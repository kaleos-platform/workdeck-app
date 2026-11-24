import { notFound } from 'next/navigation'
import { requireOperator } from '@/lib/admin/auth'
import { prisma } from '@/lib/prisma'
import { decryptPii } from '@/lib/del/encryption'
import { leadSignupSource, leadSignupUrl } from '@/lib/marketing/lead-signup'
import { LeadsTable } from '@/components/admin/leads-table'
import type { MarketingLeadStatus } from '@/generated/prisma/client'

const STATUSES: MarketingLeadStatus[] = ['NEW', 'CONTACTED', 'CONVERTED', 'DROPPED']

export default async function AdminLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  // layout 가드와 별개로 PII 를 직접 읽는 페이지라 한 번 더 확정 검증한다
  const auth = await requireOperator()
  if (!auth.ok) notFound()

  const { status } = await searchParams
  const filter = STATUSES.find((s) => s === status)
  const rows = await prisma.marketingLead.findMany({
    where: filter ? { status: filter } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  const emails = [...new Set(rows.map((r) => r.email.trim().toLowerCase()))]
  const [sameEmailLeads, users] = emails.length
    ? await Promise.all([
        prisma.marketingLead.findMany({
          where: { email: { in: emails, mode: 'insensitive' } },
          select: { id: true, email: true, status: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        }),
        prisma.user.findMany({
          where: { email: { in: emails, mode: 'insensitive' } },
          select: { email: true, createdAt: true },
        }),
      ])
    : [[], []]
  const counts = new Map<string, number>()
  const firstActive = new Map<string, string>()
  for (const lead of sameEmailLeads) {
    const email = lead.email.trim().toLowerCase()
    counts.set(email, (counts.get(email) ?? 0) + 1)
    if (lead.status !== 'DROPPED' && !firstActive.has(email)) firstActive.set(email, lead.id)
  }
  const joinedAt = new Map(
    users.map((u) => [u.email.trim().toLowerCase(), u.createdAt.toISOString()])
  )
  const leads = rows.map((r) => {
    const email = r.email.trim().toLowerCase()
    let signupUrl: string | null = null
    const firstId = firstActive.get(email)
    if (firstId) {
      try {
        signupUrl = leadSignupUrl(firstId, '/my-deck')
      } catch {
        /* 키 오류 때 발송 버튼만 비활성화한다. */
      }
    }
    return {
      id: r.id,
      deck: r.deck,
      name: r.name,
      phone: decryptPii(r.phoneEnc, r.phoneIv),
      email: r.email,
      companyName: r.companyName,
      position: r.position,
      employeeCount: r.employeeCount,
      status: r.status,
      memo: r.memo ?? '',
      createdAt: r.createdAt.toISOString(),
      source: leadSignupSource(r),
      applicationCount: counts.get(email) ?? 1,
      joinedAt: joinedAt.get(email) ?? null,
      invitedAt: r.invitedAt?.toISOString() ?? null,
      signupUrl,
    }
  })

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">도입 신청</h1>
        <p className="text-sm text-muted-foreground">
          마케팅 랜딩에서 접수된 도입 신청 (최근 200건)
        </p>
      </div>
      <LeadsTable leads={leads} status={filter ?? ''} statuses={STATUSES} />
    </div>
  )
}
