'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

const DUPLICATE_MESSAGE = '이미 같은 이름의 작업 공간이 있습니다'
const LIMIT_MESSAGE = '소유한 작업 공간은 5개까지입니다. 더 필요하면 문의해 주세요.'
const GENERIC_MESSAGE = '작업 공간을 만들지 못했습니다. 다시 시도하세요.'

/** 새 작업 공간 이름 입력 Dialog. 만들기에 성공하면 onCreated(새 공간 id) — 호출자가 그 공간으로 전환한다. */
export function CreateSpaceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (spaceId: string) => void | Promise<void>
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = (next: boolean) => {
    if (busy) return
    if (!next) {
      setName('')
      setError(null)
    }
    onOpenChange(next)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy || !name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/spaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (res.status === 201) {
        const json = (await res.json().catch(() => null)) as { space?: { id?: string } } | null
        if (json?.space?.id) {
          await onCreated(json.space.id)
          return
        }
        setError(GENERIC_MESSAGE)
      } else if (res.status === 409) {
        const json = (await res.json().catch(() => null)) as { code?: string } | null
        setError(json?.code === 'SPACE_LIMIT' ? LIMIT_MESSAGE : DUPLICATE_MESSAGE)
      } else {
        setError(GENERIC_MESSAGE)
      }
    } catch {
      setError('네트워크 오류로 만들지 못했습니다. 다시 시도하세요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>새 작업 공간 만들기</DialogTitle>
            <DialogDescription>
              회사나 브랜드처럼 따로 관리할 단위마다 작업 공간을 만들 수 있습니다.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              placeholder="예: 대성산업"
              aria-label="작업 공간 이름"
              aria-invalid={error ? true : undefined}
              disabled={busy}
              autoFocus
            />
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>

          <ul className="space-y-1 rounded-md border bg-muted/30 p-3 text-xs break-keep text-muted-foreground">
            <li>· 만든 사람이 소유자가 됩니다.</li>
            <li>· 구독·결제는 작업 공간마다 따로입니다.</li>
            <li>· 이미 체험한 업무는 새 공간에서 체험 없이 구독으로 시작합니다.</li>
          </ul>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => close(false)} disabled={busy}>
              취소
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              만들기
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
