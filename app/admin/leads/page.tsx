import { notFound } from 'next/navigation'
import { requireOperator } from '@/lib/admin/auth'
import { prisma } from '@/lib/prisma'
import { decryptPii } from '@/lib/del/encryption'
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
  const leads = rows.map((r) => ({
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
  }))

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">도입 신청</h1>
        <p className="text-sm text-muted-foreground">
          마케팅 랜딩에서 접수된 도입 신청 (최근 200건)
        </p>
      </div>
      <LeadsTable leads={leads} status={filter ?? ''} statuses={STATUSES} />
    </div>
  )
}
