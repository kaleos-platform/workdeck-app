'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, ShieldAlert, Download } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

// ─── 블랙리스트 등록 버튼(지원자 연락처 기준 — 평문은 서버에서만 복호화) ──────
export function BlacklistButton({
  applicationId,
  blacklisted,
}: {
  applicationId: string
  blacklisted: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)

  if (blacklisted) {
    return (
      <Button size="sm" variant="outline" disabled className="text-red-600 dark:text-red-400">
        <ShieldAlert className="mr-1 size-3.5" />
        블랙리스트 등록됨
      </Button>
    )
  }

  async function submit() {
    setLoading(true)
    try {
      const res = await fetch(`/api/hiring-applicants/applications/${applicationId}/blacklist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason || undefined }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.message ?? '등록 실패')
      }
      toast.success('블랙리스트에 등록했습니다')
      setOpen(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '등록 실패')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="text-red-600 dark:text-red-400">
          <ShieldAlert className="mr-1 size-3.5" />
          블랙리스트 추가
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>블랙리스트 추가</DialogTitle>
          <DialogDescription>
            이 지원자의 연락처를 블랙리스트에 등록합니다. 이후 같은 번호의 지원을 목록에서
            표시합니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">사유 (선택)</label>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="등록 사유"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
            취소
          </Button>
          <Button variant="destructive" onClick={submit} disabled={loading}>
            {loading && <Loader2 className="mr-1 size-4 animate-spin" />}
            등록
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── 첨부 파일 다운로드(서명 URL 클릭 시 발급) ────────────────────────────────
type FileItem = { id: string; fileName: string; sizeBytes: number }

export function FileDownloadList({
  applicationId,
  files,
}: {
  applicationId: string
  files: FileItem[]
}) {
  const [loadingId, setLoadingId] = useState<string | null>(null)

  async function download(fileId: string) {
    setLoadingId(fileId)
    try {
      const res = await fetch(
        `/api/hiring-applicants/applications/${applicationId}/files/${fileId}`
      )
      if (!res.ok) throw new Error('다운로드 실패')
      const { url } = (await res.json()) as { url: string }
      window.open(url, '_blank', 'noopener')
    } catch {
      toast.error('다운로드 링크 생성에 실패했습니다')
    } finally {
      setLoadingId(null)
    }
  }

  if (files.length === 0) {
    return <p className="text-xs text-muted-foreground">첨부 파일이 없습니다.</p>
  }

  return (
    <ul className="space-y-1.5">
      {files.map((f) => (
        <li key={f.id} className="flex items-center justify-between gap-2 text-sm">
          <span className="truncate">{f.fileName}</span>
          <Button
            size="xs"
            variant="outline"
            onClick={() => download(f.id)}
            disabled={loadingId === f.id}
          >
            {loadingId === f.id ? (
              <Loader2 className="mr-1 size-3.5 animate-spin" />
            ) : (
              <Download className="mr-1 size-3.5" />
            )}
            다운로드
          </Button>
        </li>
      ))}
    </ul>
  )
}
