import Link from 'next/link'
import { Briefcase, Users } from 'lucide-react'
import { redirect } from 'next/navigation'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { PostingStatusBadge } from '@/components/hiring-posts/status-badge'
import { NewPostingButton } from '@/components/hiring-posts/new-posting-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  RECRUITING_POSTINGS_PATH,
  RECRUITING_APPLICATIONS_PATH,
  RECRUITING_DETAIL_TEMPLATES_PATH,
  getRecruitingPostingBuildPath,
  getRecruitingPostingDetailPath,
} from '@/lib/deck-routes'

// 본문·지원자 집계 없이 최근 생성 공고의 탐색에 필요한 필드만 조회한다.
export default async function RecruitingHomePage() {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) redirect('/my-deck')
  const postings = await prisma.hiringPosting.findMany({
    where: { spaceId: resolved.space.id, status: { not: 'ARCHIVED' } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 5,
    select: { id: true, title: true, status: true, createdAt: true },
  })
  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">모집 관리</h1>
          <p className="text-sm text-muted-foreground">
            공고를 만들고 HTML을 복사해 외부 채용사이트에 게시하세요. 지원자 접수도 관리할 수
            있습니다.
          </p>
        </div>
        <NewPostingButton />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Briefcase className="size-4" /> 최근 만든 공고
          </CardTitle>
          <CardDescription>
            보관 공고를 제외하고 생성일이 최근인 5건을 표시합니다. 편집을 이어가거나 HTML을
            확인하세요.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {postings.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">
              표시할 공고가 없습니다. 새 공고를 만들거나 전체 공고를 확인하세요.
            </p>
          ) : (
            <ul className="divide-y">
              {postings.map((posting) => (
                <li
                  key={posting.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0"
                >
                  <div className="min-w-0 flex-1 basis-48 space-y-1">
                    <Link
                      href={getRecruitingPostingDetailPath(posting.id)}
                      className="block truncate font-medium hover:underline"
                      title={posting.title}
                    >
                      {posting.title}
                    </Link>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <PostingStatusBadge status={posting.status} />
                      <span>
                        생성{' '}
                        {posting.createdAt.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="outline" size="sm" asChild>
                      <Link href={getRecruitingPostingBuildPath(posting.id)}>편집</Link>
                    </Button>
                    <Button variant="outline" size="sm" asChild>
                      <Link href={getRecruitingPostingDetailPath(posting.id)}>HTML 확인</Link>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button variant="outline" size="sm" asChild>
              <Link href={RECRUITING_POSTINGS_PATH}>전체 공고 보기</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href={RECRUITING_DETAIL_TEMPLATES_PATH}>상세 템플릿 관리</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Users className="size-4" /> 지원자 목록
          </CardTitle>
          <CardDescription>공고를 발행하면 지원서가 이곳에 쌓입니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" asChild>
            <Link href={RECRUITING_APPLICATIONS_PATH}>지원자 보기</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
