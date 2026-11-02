'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Props = {
  deploymentId: string
  shortUrl: string
  html: string
  text: string
}

/** 수동 게시 대기 배포: 네이버용 복사 → 게시 → URL 입력으로 완료. */
export function ManualPublishPanel({ deploymentId, shortUrl, html, text }: Props) {
  const router = useRouter()
  const [platformUrl, setPlatformUrl] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function copyPost() {
    setError(null)
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ])
      setNotice('본문을 복사했습니다')
    } catch {
      setError('복사하지 못했습니다. 브라우저 권한을 확인해 주세요')
    }
  }

  async function copyLink() {
    setError(null)
    try {
      await navigator.clipboard.writeText(shortUrl)
      setNotice('추적 링크를 복사했습니다')
    } catch {
      setError('복사하지 못했습니다. 브라우저 권한을 확인해 주세요')
    }
  }

  async function complete() {
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/sc/deployments/${deploymentId}/complete-manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platformUrl }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.message ?? '게시 완료 처리에 실패했습니다')
        return
      }
      router.refresh()
    } catch {
      setError('네트워크 오류가 발생했습니다')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-3 space-y-2 border-t pt-3">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={copyPost}>
          네이버용 복사
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={copyLink}>
          추적 링크 복사
        </Button>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={platformUrl}
          onChange={(e) => setPlatformUrl(e.target.value)}
          placeholder="게시한 글 주소 (https://blog.naver.com/...)"
          aria-label="게시한 글 주소"
        />
        <Button type="button" size="sm" onClick={complete} disabled={saving || !platformUrl.trim()}>
          {saving ? '처리 중…' : '게시 완료'}
        </Button>
      </div>
      {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
