import { isHiringDeadlinePassed } from '@/lib/hiring/closing-date'
// 공개 지원 폼 페이지(server wrapper) — posting.applicationEntries 스키마를 파싱해 클라이언트 폼에 전달.
// ?preview=1 + 스페이스 멤버인 경우 DRAFT/CLOSED 여도 폼 화면을 볼 수 있다(제출은 불가).
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getHiringPublicPostingPath } from '@/lib/deck-routes'
import { getUser } from '@/hooks/use-user'
import { parseApplicationEntriesSchema } from '@/lib/validations/hiring-applicants'
import { ApplyForm } from '@/components/hiring-public/apply-form'

type Params = { params: Promise<{ uuid: string }>; searchParams: Promise<{ preview?: string }> }

async function isSpaceMemberPreview(preview: string | undefined, spaceId: string) {
  if (preview !== '1') return false
  const user = await getUser()
  if (!user) return false
  const membership = await prisma.spaceMember.findFirst({
    where: { userId: user.id, spaceId },
    select: { id: true },
  })
  return !!membership
}

export default async function ApplyPage({ params, searchParams }: Params) {
  const { uuid } = await params
  const { preview } = await searchParams
  const posting = await prisma.hiringPosting.findUnique({
    where: { uuid },
    select: {
      spaceId: true,
      title: true,
      status: true,
      closingDate: true,
      applicationEntries: true,
      positions: { orderBy: { createdAt: 'asc' }, select: { id: true, name: true } },
      stores: { include: { store: { select: { id: true, name: true } } } },
    },
  })

  if (!posting || posting.status === 'ARCHIVED') notFound()

  const isPreview = await isSpaceMemberPreview(preview, posting.spaceId)

  if ((posting.status !== 'ACTIVE' || isHiringDeadlinePassed(posting.closingDate)) && !isPreview) {
    return (
      <section className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center gap-3 px-4 text-center">
        <h1 className="text-xl font-semibold">현재 지원할 수 없는 공고입니다</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          아직 접수가 시작되지 않았거나 모집이 마감되어 지원서를 제출할 수 없습니다.
        </p>
        <p className="text-sm text-muted-foreground">
          자세한 사항은 채용 담당자에게 문의해 주세요.
        </p>
      </section>
    )
  }

  const fields = parseApplicationEntriesSchema(posting.applicationEntries)
  const positions = posting.positions.map((p) => ({ id: p.id, name: p.name }))
  const stores = posting.stores.map((s) => ({ id: s.store.id, name: s.store.name }))

  return (
    <div className="space-y-6">
      {isPreview && (
        <div className="sticky top-0 z-50 -mx-4 -mt-4 bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-900 shadow-sm sm:-mx-6 sm:-mt-6 dark:bg-amber-950 dark:text-amber-200">
          미리보기 — 발행 전 화면입니다
        </div>
      )}

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

      <ApplyForm
        postingUuid={uuid}
        fields={fields}
        positions={positions}
        stores={stores}
        preview={isPreview}
      />
    </div>
  )
}
