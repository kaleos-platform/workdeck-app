import Link from 'next/link'
import { Briefcase, Plus, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { RECRUITING_POSTINGS_PATH, RECRUITING_APPLICATIONS_PATH } from '@/lib/deck-routes'

// 모집 관리 홈 (Phase B에서 KPI·최근 공고로 확장)
export default function RecruitingHomePage() {
  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">모집 관리</h1>
          <p className="text-sm text-muted-foreground">
            채용 공고를 만들고 발행해 공개 지원 페이지를 운영합니다.
          </p>
        </div>
        <Button asChild>
          <Link href={RECRUITING_POSTINGS_PATH}>
            <Plus /> 새 공고
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Briefcase className="size-4" /> 시작하기
          </CardTitle>
          <CardDescription>
            공고 관리에서 첫 공고를 작성하세요. 발행하면 공개 URL이 즉시 활성화됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" asChild>
            <Link href={RECRUITING_POSTINGS_PATH}>공고 관리로 이동</Link>
          </Button>
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
