import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getUser } from '@/hooks/use-user'
import { prisma } from '@/lib/prisma'
import { ExternalLink } from 'lucide-react'

// deckKey → 진입 경로 매핑
const DECK_ENTRY: Record<string, string> = {
  'coupang-ads': '/d/coupang-ads',
}

export default async function MyDeckPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const membership = await prisma.spaceMember.findFirst({
    where: { userId: user.id },
    include: {
      space: {
        select: {
          id: true,
          name: true,
          deckInstances: {
            where: { isActive: true },
            include: {
              deckApp: {
                select: { id: true, name: true, description: true },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      },
    },
  })

  if (!membership) redirect('/workspace-setup')

  const { space } = membership
  const cards = space.deckInstances

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">My Deck</h1>
        <p className="mt-1 text-sm text-slate-500">{space.name}</p>
      </div>

      {cards.length === 0 ? (
        <p className="text-sm text-slate-500">활성화된 카드가 없습니다.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map(({ deckApp }) => {
            const href = DECK_ENTRY[deckApp.id] ?? `/d/${deckApp.id}`
            return (
              <Link
                key={deckApp.id}
                href={href}
                className="group flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md"
              >
                <div className="flex items-start justify-between">
                  <span className="text-base font-semibold text-slate-900 group-hover:text-blue-600">
                    {deckApp.name}
                  </span>
                  <ExternalLink className="h-4 w-4 flex-shrink-0 text-slate-400 group-hover:text-blue-500" />
                </div>
                {deckApp.description && (
                  <p className="text-sm leading-relaxed text-slate-500">{deckApp.description}</p>
                )}
                <span className="mt-auto inline-flex w-fit items-center rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
                  활성
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
