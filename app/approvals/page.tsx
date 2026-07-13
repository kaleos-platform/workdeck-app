import { redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { ApprovalList } from '@/components/approvals/approval-list'
import { APPROVALS_PATH } from '@/lib/deck-routes'

// 승인 대기 액션 전역 페이지 — 인증 가드 후 클라이언트 목록 위임.
export default async function ApprovalsPage() {
  const user = await getUser()
  if (!user) {
    redirect(`/login?redirectTo=${encodeURIComponent(APPROVALS_PATH)}`)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">승인 대기</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          에이전트가 요청한 작업을 검토하고 승인하거나 거부하세요.
        </p>
      </div>

      <ApprovalList />
    </div>
  )
}
