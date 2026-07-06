// 공개 지원 폼 페이지(server wrapper) — posting.applicationEntries 스키마를 파싱해 클라이언트 폼에 전달.
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getHiringPublicPostingPath } from '@/lib/deck-routes'
import { parseApplicationEntriesSchema } from '@/lib/validations/hiring-applicants'
import { ApplyForm } from '@/components/hiring-public/apply-form'

type Params = { params: Promise<{ uuid: string }> }

export default async function ApplyPage({ params }: Params) {
  const { uuid } = await params
  const posting = await prisma.hiringPosting.findUnique({
    where: { uuid },
    select: {
      title: true,
      status: true,
      applicationEntries: true,
      positions: { orderBy: { createdAt: 'asc' }, select: { id: true, name: true } },
      stores: { include: { store: { select: { id: true, name: true } } } },
    },
  })

  if (!posting || posting.status === 'DRAFT' || posting.status === 'ARCHIVED') notFound()
  // ACTIVE 아니면 공고 페이지로(마감 안내)
  if (posting.status !== 'ACTIVE') redirect(getHiringPublicPostingPath(uuid))

  const fields = parseApplicationEntriesSchema(posting.applicationEntries)
  const positions = posting.positions.map((p) => ({ id: p.id, name: p.name }))
  const stores = posting.stores.map((s) => ({ id: s.store.id, name: s.store.name }))

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link
          href={getHiringPublicPostingPath(uuid)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← 공고로 돌아가기
        </Link>
        <h1 className="text-xl font-semibold">{posting.title}</h1>
        <p className="text-sm text-muted-foreground">아래 항목을 작성해 지원해 주세요.</p>
      </header>

      <ApplyForm postingUuid={uuid} fields={fields} positions={positions} stores={stores} />
    </div>
  )
}
