'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, X, Copy, Send, Lock, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PostingStatusBadge, type PostingStatus } from './status-badge'
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

export function StepPublish({
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

  const checks = useMemo(() => {
    const keys = new Set(formFields.map((f) => f.key))
    return [
      { ok: !!title.trim(), label: '공고 제목 입력' },
      { ok: positionCount >= 1, label: '직무 1개 이상 등록' },
      { ok: keys.has('name') && keys.has('phone'), label: '지원서에 이름·연락처 포함' },
    ]
  }, [title, positionCount, formFields])

  const canPublish = checks.every((c) => c.ok)

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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">현재 상태</span>
        <PostingStatusBadge status={status} />
      </div>

      {/* 발행 요건 체크리스트 */}
      <div className="space-y-2 rounded-lg border p-4">
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

      {/* 공개 URL (발행됨 상태) */}
      {status === 'ACTIVE' && (
        <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-400/30 dark:bg-emerald-900/20">
          <div className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
            공개 지원 페이지가 활성화되었습니다
          </div>
          <div className="flex gap-2">
            <Input readOnly value={publicUrl} className="bg-background" />
            <Button size="sm" variant="outline" onClick={copyUrl}>
              <Copy /> 복사
            </Button>
          </div>
        </div>
      )}

      {/* 액션 */}
      <div className="flex flex-wrap gap-2">
        {status !== 'ACTIVE' && (
          <Button onClick={() => runAction('publish')} disabled={busy || !canPublish}>
            <Send /> {status === 'CLOSED' ? '재발행' : '발행'}
          </Button>
        )}
        {status === 'ACTIVE' && (
          <Button variant="outline" onClick={() => runAction('close')} disabled={busy}>
            <Lock /> 마감
          </Button>
        )}
        {status === 'CLOSED' && (
          <Button variant="outline" onClick={() => runAction('reopen')} disabled={busy}>
            <RotateCcw /> 재개
          </Button>
        )}
      </div>
      {!canPublish && status !== 'ACTIVE' && (
        <p className="text-xs text-muted-foreground">
          발행 요건을 모두 충족해야 발행할 수 있습니다.
        </p>
      )}
    </div>
  )
}
