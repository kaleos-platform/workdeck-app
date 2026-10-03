import { Loader2 } from 'lucide-react'

export default function RecruitingLoading() {
  return (
    <div
      role="status"
      className="flex min-h-60 items-center justify-center gap-2 p-6 text-sm text-muted-foreground"
    >
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      모집 관리 화면을 불러오고 있습니다
    </div>
  )
}
