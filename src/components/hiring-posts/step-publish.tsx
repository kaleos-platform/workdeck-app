'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, X, Copy, Send, Lock, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { PostingStatus } from './status-badge'
import { getHiringPublicPostingPath } from '@/lib/deck-routes'
import type { FormFieldInput } from '@/lib/validations/hiring-posts'

type Props = {
  postingId: string
  uuid: string
  title: string
  status: PostingStatus
  positionCount: number
  formFields: FormFieldInput[]
  onStatusChange: (status: PostingStatus) => void
}

export function PublishBar({
  postingId,
  uuid,
  title,
  status,
  positionCount,
  formFields,
  onStatusChange,
}: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [checklistOpen, setChecklistOpen] = useState(false)

  const checks = useMemo(() => {
    const keys = new Set(formFields.map((f) => f.key))
    return [
      { ok: !!title.trim(), label: '공고 제목 입력' },
      { ok: positionCount >= 1, label: '직무 1개 이상 등록' },
      { ok: keys.has('name') && keys.has('phone'), label: '지원서에 이름·연락처 포함' },
    ]
  }, [title, positionCount, formFields])

  const passedCount = checks.filter((c) => c.ok).length
  const canPublish = passedCount === checks.length

  const publicPath = getHiringPublicPostingPath(uuid)
  const publicUrl =
    typeof window !== 'undefined' ? `${window.location.origin}${publicPath}` : publicPath

  async function runAction(action: 'publish' | 'close' | 'reopen') {
    setBusy(true)
    try {
      const res = await fetch(`/api/hiring-posts/postings/${postingId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message ?? '처리에 실패했습니다')
      }
      const { posting } = await res.json()
      onStatusChange(posting.status)
      toast.success(
        action === 'publish'
          ? '공고를 발행했습니다'
          : action === 'close'
            ? '공고를 마감했습니다'
            : '공고를 재개했습니다'
      )
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '처리에 실패했습니다')
    } finally {
      setBusy(false)
    }
  }

  function copyUrl() {
    navigator.clipboard.writeText(publicUrl).then(
      () => toast.success('공개 URL을 복사했습니다'),
      () => toast.error('복사에 실패했습니다')
    )
  }

  function handlePublishClick() {
    if (canPublish) {
      runAction('publish')
    } else {
      setChecklistOpen(true)
    }
  }

  const publishLabel = status === 'CLOSED' ? '재발행' : '발행'

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status !== 'ACTIVE' && (
        <>
          {/* 열기는 handlePublishClick(요건 미충족 시)만 허용 — 요건 충족 발행 클릭 시
              trigger 기본 토글로 팝오버가 같이 열리는 것을 방지 */}
          <Popover
            open={checklistOpen}
            onOpenChange={(open) => {
              if (!open) setChecklistOpen(false)
            }}
          >
            <PopoverTrigger asChild>
              <Button onClick={handlePublishClick} disabled={busy}>
                <Send /> {publishLabel}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72">
              <div className="space-y-2">
                <div className="text-sm font-medium">발행 요건</div>
                <ul className="space-y-1.5">
                  {checks.map((c) => (
                    <li key={c.label} className="flex items-center gap-2 text-sm">
                      {c.ok ? (
                        <Check className="size-4 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <X className="size-4 text-red-500" />
                      )}
                      <span className={c.ok ? '' : 'text-muted-foreground'}>{c.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </PopoverContent>
          </Popover>
          {!canPublish && (
            <Badge variant="outline" className="text-muted-foreground">
              {passedCount}/{checks.length}
            </Badge>
          )}
        </>
      )}

      {status === 'ACTIVE' && (
        <>
          <Button variant="outline" onClick={() => runAction('close')} disabled={busy}>
            <Lock /> 마감
          </Button>
          <Button variant="outline" onClick={copyUrl}>
            <Copy /> URL 복사
          </Button>
        </>
      )}

      {status === 'CLOSED' && (
        <Button variant="outline" onClick={() => runAction('reopen')} disabled={busy}>
          <RotateCcw /> 재개
        </Button>
      )}
    </div>
  )
}
