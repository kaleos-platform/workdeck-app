'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { getRecruitingPostingBuildPath } from '@/lib/deck-routes'
import { copyPosting } from './copy-posting'
import { PostingStatusBadge, type PostingStatus } from './status-badge'

type RecentPosting = {
  id: string
  title: string
  status: PostingStatus
  closingDate: string | null
  createdAt: string
}

type TemplateRef = { id: string; name: string }

// template 를 주면 그 템플릿을 적용한 새 공고를 만든다(이전 공고 복사 모드 없음).
// triggerLabel/triggerProps 로 카드·미리보기 푸터 등 다른 자리의 버튼으로 쓸 수 있다.
export function NewPostingButton({
  template,
  triggerLabel,
  triggerProps,
}: {
  template?: TemplateRef
  triggerLabel?: string
  triggerProps?: React.ComponentProps<typeof Button>
} = {}) {
  const router = useRouter()
  const titleId = useId()
  const submitting = useRef(false)
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [creating, setCreating] = useState(false)
  // 시작 방식: 새로 만들기 / 이전 공고 복사
  const [mode, setMode] = useState<'new' | 'copy'>('new')
  const [recent, setRecent] = useState<RecentPosting[] | null>(null)
  const [recentError, setRecentError] = useState(false)
  const [sourceId, setSourceId] = useState<string | null>(null)

  // 복사 모드에 처음 들어갈 때 최근 공고 10개를 불러온다.
  useEffect(() => {
    if (!open || mode !== 'copy' || recent !== null) return
    let live = true
    fetch('/api/hiring-posts/postings')
      .then(async (res) => {
        if (!res.ok) throw new Error()
        const { postings } = (await res.json()) as { postings: RecentPosting[] }
        if (live) setRecent(postings.slice(0, 10))
      })
      .catch(() => live && setRecentError(true))
    return () => {
      live = false
    }
  }, [open, mode, recent])

  async function createPosting(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = title.trim()
    if (submitting.current || (mode === 'copy' ? !sourceId : !trimmed)) return
    submitting.current = true
    setCreating(true)
    try {
      if (mode === 'copy') {
        const id = await copyPosting(sourceId!)
        router.push(getRecruitingPostingBuildPath(id))
        setOpen(false)
        return
      }
      const res = await fetch('/api/hiring-posts/postings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      })
      if (!res.ok) throw new Error('공고 생성에 실패했습니다')
      const { posting } = await res.json()
      if (template) {
        // 공고는 이미 만들어졌으므로 적용 실패여도 초안으로 이동하고 재시도 방법을 안내한다.
        const applied = await fetch(`/api/hiring-posts/postings/${posting.id}/apply-template`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ templateId: template.id, mode: 'append' }),
        }).catch(() => null)
        if (!applied?.ok) {
          toast.error(
            '공고는 만들었지만 템플릿을 적용하지 못했습니다. 공고 꾸미기에서 다시 불러오세요.'
          )
        }
      }
      router.push(getRecruitingPostingBuildPath(posting.id))
      setOpen(false)
      setTitle('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '공고 생성에 실패했습니다')
    } finally {
      submitting.current = false
      setCreating(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!submitting.current) setOpen(next)
      }}
    >
      <DialogTrigger asChild>
        <Button {...triggerProps}>
          {triggerLabel ?? (
            <>
              <Plus /> 새 공고
            </>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={createPosting} className="min-w-0 space-y-4">
          <DialogHeader>
            <DialogTitle>{template ? '이 템플릿으로 새 공고' : '새 공고 만들기'}</DialogTitle>
            <DialogDescription>
              {template
                ? `‘${template.name}’ 템플릿의 블록을 넣어 초안을 만듭니다.`
                : mode === 'copy'
                  ? '최근 공고를 골라 복사본을 초안으로 만듭니다.'
                  : '제목을 입력하면 초안과 본문 제목을 함께 만듭니다.'}
            </DialogDescription>
          </DialogHeader>
          {!template && (
            <div
              className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
              role="group"
              aria-label="시작 방식"
            >
              {(
                [
                  ['new', '새로 만들기'],
                  ['copy', '이전 공고 복사해서 시작'],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={mode === value ? 'default' : 'ghost'}
                  aria-pressed={mode === value}
                  disabled={creating}
                  onClick={() => setMode(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
          )}
          {mode === 'new' ? (
            <div className="space-y-2">
              <Label htmlFor={titleId}>공고 제목</Label>
              <Input
                id={titleId}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={200}
                required
                disabled={creating}
                placeholder="예: 강남점 주말 아르바이트 모집"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                직무·본문·지원서 설정을 그대로 가져옵니다. 제목 뒤에 “(복사)”가 붙으며 작성 중
                상태로 시작합니다.
              </p>
              {recentError ? (
                <p className="py-4 text-center text-sm text-destructive">
                  공고 목록을 불러오지 못했습니다
                </p>
              ) : recent === null ? (
                <p className="py-4 text-center text-sm text-muted-foreground">불러오는 중…</p>
              ) : recent.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  복사할 이전 공고가 없습니다
                </p>
              ) : (
                <ul
                  className="max-h-64 space-y-1 overflow-y-auto"
                  role="radiogroup"
                  aria-label="복사할 공고"
                >
                  {recent.map((p) => (
                    <li key={p.id}>
                      <label className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 hover:bg-accent/50 has-checked:border-primary has-checked:bg-accent/30">
                        <input
                          type="radio"
                          name="copy-source"
                          checked={sourceId === p.id}
                          disabled={creating}
                          onChange={() => setSourceId(p.id)}
                        />
                        <span
                          className="min-w-0 flex-1 truncate text-sm font-medium"
                          title={p.title}
                        >
                          {p.title}
                        </span>
                        <PostingStatusBadge status={p.status} closingDate={p.closingDate} />
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {new Date(p.createdAt).toLocaleDateString('ko-KR', {
                            dateStyle: 'medium',
                            timeZone: 'Asia/Seoul',
                          })}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={creating}
              onClick={() => setOpen(false)}
            >
              취소
            </Button>
            <Button
              type="submit"
              disabled={creating || (mode === 'copy' ? !sourceId : !title.trim())}
            >
              {creating && <Loader2 className="size-4 animate-spin" />}
              {creating ? '생성 중…' : mode === 'copy' ? '복사해서 시작' : '공고 만들기'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
