import Link from 'next/link'
import { Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { HIRING_APPLICANTS_LIST_PATH } from '@/lib/deck-routes'

// 지원자 관리 홈 (Phase C에서 stage 파이프라인 요약으로 확장)
export default function HiringApplicantsHomePage() {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">지원자 관리</h1>
        <p className="text-sm text-muted-foreground">
          접수된 지원서를 단계별로 검토하고 결과를 안내합니다.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Users className="size-4" /> 지원자 목록
          </CardTitle>
          <CardDescription>
            공고 제작 deck에서 공고를 발행하면 지원서가 이곳에 쌓입니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" asChild>
            <Link href={HIRING_APPLICANTS_LIST_PATH}>지원자 보기</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
