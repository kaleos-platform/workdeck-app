// 블랙리스트 관리(server wrapper) — 인증은 deck 레이아웃에서 강제.
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RECRUITING_APPLICATIONS_PATH } from '@/lib/deck-routes'
import { BlacklistManager } from '@/components/hiring-applicants/blacklist-manager'

export default function BlacklistPage() {
  return (
    <div className="space-y-4 p-6">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" className="size-9" asChild>
          <Link href={RECRUITING_APPLICATIONS_PATH}>
            <ArrowLeft />
            <span className="sr-only">지원자 목록으로</span>
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">블랙리스트</h1>
          <p className="text-sm text-muted-foreground">
            등록된 연락처는 지원자 목록에서 자동으로 표시됩니다. 전화번호는 마스킹되어 노출됩니다.
          </p>
        </div>
      </div>
      <BlacklistManager />
    </div>
  )
}
