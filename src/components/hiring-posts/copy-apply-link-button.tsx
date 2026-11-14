'use client'

import { Link2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { getHiringPublicApplyPath } from '@/lib/deck-routes'

// 지원서 링크(/p/{uuid}/apply)를 클립보드에 복사한다 — 공고 상세와 같은 경로 규칙.
export function CopyApplyLinkButton({ uuid }: { uuid: string }) {
  function copy() {
    const url = `${window.location.origin}${getHiringPublicApplyPath(uuid)}`
    navigator.clipboard.writeText(url).then(
      () => toast.success('지원서 링크를 복사했습니다'),
      () => toast.error('복사에 실패했습니다')
    )
  }
  return (
    <Button type="button" variant="outline" size="sm" onClick={copy}>
      <Link2 className="size-3.5" /> 지원서 링크 복사
    </Button>
  )
}
