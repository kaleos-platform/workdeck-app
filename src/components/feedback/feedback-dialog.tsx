'use client'

import { useRef, useState } from 'react'
import { ImagePlus, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import {
  FEEDBACK_TYPES,
  FEEDBACK_TYPE_LABEL,
  MAX_FILES,
  MAX_FILE_BYTES,
} from '@/lib/feedback/policy'
import { compressImage } from './compress-image'

type FeedbackType = (typeof FEEDBACK_TYPES)[number]
type Attachment = { id: number; blob: Blob; url: string; error: string | null }

const GENERIC_ERROR = '의견을 보내지 못했어요. 잠시 후 다시 시도해 주세요.'
const TOO_BIG = '압축해도 1MB를 넘어 첨부할 수 없어요. 제거해 주세요.'

export function FeedbackDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [type, setType] = useState<FeedbackType | null>(null)
  const [body, setBody] = useState('')
  const [files, setFiles] = useState<Attachment[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [skipped, setSkipped] = useState(false)
  const seq = useRef(0)
  const submitting = useRef(false)
  const input = useRef<HTMLInputElement>(null)

  const reset = (list: Attachment[]) => {
    list.forEach((f) => URL.revokeObjectURL(f.url))
    setType(null)
    setBody('')
    setFiles([])
    setError(null)
    setSkipped(false)
  }

  const close = (next: boolean) => {
    if (busy) return
    if (!next) reset(files)
    onOpenChange(next)
  }

  async function addFiles(list: FileList | null) {
    const picked = Array.from(list ?? []).slice(0, MAX_FILES - files.length)
    if (input.current) input.current.value = ''
    const added: Attachment[] = []
    for (const f of picked) {
      try {
        const blob = await compressImage(f)
        added.push({
          id: ++seq.current,
          blob,
          url: URL.createObjectURL(blob),
          error: blob.size > MAX_FILE_BYTES ? TOO_BIG : null,
        })
      } catch {
        setError('이미지를 처리하지 못했어요. 다른 이미지로 시도해 주세요.')
      }
    }
    setFiles((cur) => {
      const room = MAX_FILES - cur.length
      added.slice(room).forEach((a) => URL.revokeObjectURL(a.url))
      return [...cur, ...added.slice(0, room)]
    })
  }

  function removeFile(id: number) {
    const f = files.find((x) => x.id === id)
    if (f) URL.revokeObjectURL(f.url)
    setFiles((cur) => cur.filter((x) => x.id !== id))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting.current || busy || !type || !body.trim()) return
    submitting.current = true
    setBusy(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.set('type', type)
      fd.set('body', body)
      fd.set('pagePath', window.location.pathname)
      files
        .filter((f) => !f.error)
        .forEach((f, i) =>
          fd.append('files', f.blob, `image-${i}.${f.blob.type.split('/')[1] ?? 'jpg'}`)
        )
      const res = await fetch('/api/feedback', { method: 'POST', body: fd })
      const json = (await res.json().catch(() => null)) as {
        attachmentsAccepted?: boolean
        error?: string
        message?: string
      } | null
      if (res.status === 201) {
        const dropped = json?.attachmentsAccepted === false
        reset(files)
        if (dropped) {
          setSkipped(true)
        } else {
          toast.success('의견이 접수됐어요. 확인 후 조치할게요.')
          onOpenChange(false)
        }
      } else if (res.status === 429) {
        setError('잠시 후 다시 보내 주세요.')
      } else {
        setError(json?.error ?? json?.message ?? GENERIC_ERROR)
      }
    } catch {
      setError(GENERIC_ERROR)
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  const full = files.length >= MAX_FILES

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        {skipped ? (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle>의견이 접수됐어요</DialogTitle>
              <DialogDescription>
                의견은 접수됐지만 이미지는 저장되지 않았어요. 필요하면 내용에 상황을 글로 적어 다시
                보내 주세요.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" onClick={() => close(false)}>
                닫기
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>의견 남기기</DialogTitle>
              <DialogDescription>
                불편한 점, 제안하고 싶은 기능, 오류를 남겨주시면 확인 후 조치할게요. 자세히 적을수록
                빨라요.
              </DialogDescription>
            </DialogHeader>

            <div role="radiogroup" aria-label="의견 유형" className="flex flex-wrap gap-2">
              {FEEDBACK_TYPES.map((t) => (
                <label
                  key={t}
                  className="flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/10"
                >
                  <input
                    type="radio"
                    name="feedback-type"
                    className="accent-primary"
                    checked={type === t}
                    onChange={() => setType(t)}
                  />
                  {FEEDBACK_TYPE_LABEL[t]}
                </label>
              ))}
            </div>

            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={5000}
              rows={6}
              aria-label="의견 내용"
              placeholder="어떤 화면에서 무엇이 불편했는지 적어 주세요."
            />

            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {files.map((f) => (
                  <div key={f.id} className="w-24 space-y-1">
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={f.url}
                        alt="첨부 이미지 미리보기"
                        className="h-24 w-24 rounded-md border object-cover"
                      />
                      <button
                        type="button"
                        aria-label="이미지 제거"
                        onClick={() => removeFile(f.id)}
                        className="absolute -top-2 -right-2 rounded-full border bg-background p-0.5"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {f.error && <p className="text-xs text-destructive">{f.error}</p>}
                  </div>
                ))}
              </div>
              <input
                ref={input}
                type="file"
                multiple
                hidden
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(e) => void addFiles(e.target.files)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={full}
                onClick={() => input.current?.click()}
              >
                <ImagePlus className="mr-1.5 h-4 w-4" />
                이미지 추가
              </Button>
              <p className="text-xs text-muted-foreground">
                최대 {MAX_FILES}장, 장당 1MB 이하로 줄여 보내요. GIF는 정지 이미지로 저장돼요.
              </p>
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button type="submit" disabled={busy || !type || !body.trim()}>
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    보내는 중
                  </>
                ) : (
                  '보내기'
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
