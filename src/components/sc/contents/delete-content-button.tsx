'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { SALES_CONTENT_CONTENTS_PATH } from '@/lib/deck-routes'

export function DeleteContentButton({ contentId }: { contentId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function onDelete() {
    if (
      !confirm(
        '이 콘텐츠를 삭제할까요? 본문·버전 기록·첨부 사진·배포 기록이 모두 지워지고 되돌릴 수 없습니다.'
      )
    )
      return
    setBusy(true)
    const res = await fetch(`/api/sc/contents/${contentId}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null
      alert(body?.message ?? '삭제하지 못했습니다')
      setBusy(false)
      return
    }
    router.push(SALES_CONTENT_CONTENTS_PATH)
    router.refresh()
  }

  return (
    <Button variant="outline" className="text-destructive" onClick={onDelete} disabled={busy}>
      {busy ? '삭제 중…' : '삭제'}
    </Button>
  )
}
