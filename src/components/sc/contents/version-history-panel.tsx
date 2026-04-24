'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { History, RotateCcw, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Editor } from '@/components/sc/editor/editor'

// 버전 목록 항목 타입 (doc 제외)
type VersionItem = {
  id: string
  versionNumber: number
  title: string
  createdAt: string
  note: string | null
  createdByUserId: string | null
}

// 버전 상세 (doc 포함)
type VersionDetail = VersionItem & {
  doc: unknown
}

type Props = {
  contentId: string
  currentVersionNumber?: number
}

const dateFormatter = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

export function VersionHistoryPanel({ contentId, currentVersionNumber }: Props) {
  const router = useRouter()
  const [versions, setVersions] = useState<VersionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 미리보기 상태
  const [previewVersion, setPreviewVersion] = useState<VersionDetail | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)

  // 롤백 상태
  const [rollbackTargetId, setRollbackTargetId] = useState<string | null>(null)
  const [rollbackTargetNumber, setRollbackTargetNumber] = useState<number | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [rollbackLoading, setRollbackLoading] = useState(false)
  const [rollbackMessage, setRollbackMessage] = useState<string | null>(null)
  const [rollbackError, setRollbackError] = useState<string | null>(null)

  // 버전 목록 1회 로드
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/sc/contents/${contentId}/versions`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          setError(data?.message ?? '버전 목록을 불러오지 못했습니다.')
          return
        }
        setVersions(data.versions ?? [])
      })
      .catch(() => {
        if (!cancelled) setError('네트워크 오류가 발생했습니다.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [contentId])

  // 미리보기 열기
  async function openPreview(versionId: string) {
    setPreviewLoading(true)
    setPreviewVersion(null)
    setPreviewOpen(true)
    try {
      const res = await fetch(`/api/sc/contents/${contentId}/versions/${versionId}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setPreviewOpen(false)
        setError(data?.message ?? '버전을 불러오지 못했습니다.')
        return
      }
      setPreviewVersion(data)
    } catch {
      setPreviewOpen(false)
      setError('미리보기를 불러오는 중 오류가 발생했습니다.')
    } finally {
      setPreviewLoading(false)
    }
  }

  // 롤백 확인 다이얼로그 열기
  function openConfirm(versionId: string, versionNumber: number) {
    setRollbackTargetId(versionId)
    setRollbackTargetNumber(versionNumber)
    setRollbackMessage(null)
    setRollbackError(null)
    setConfirmOpen(true)
  }

  // 롤백 실행
  async function doRollback() {
    if (!rollbackTargetId || rollbackTargetNumber === null) return
    setRollbackLoading(true)
    setRollbackError(null)
    try {
      const res = await fetch(
        `/api/sc/contents/${contentId}/versions/${rollbackTargetId}/rollback`,
        { method: 'POST' }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setRollbackError(data?.message ?? '롤백에 실패했습니다.')
        return
      }
      const newNum: number = data.newVersionNumber ?? rollbackTargetNumber
      setRollbackMessage(
        `v${rollbackTargetNumber}(으)로 롤백했습니다. 이전 본문은 v${newNum}으로 자동 저장됨.`
      )
      setConfirmOpen(false)
      // 목록 새로고침 + 페이지 갱신
      router.refresh()
      // 버전 목록도 다시 로드
      const listRes = await fetch(`/api/sc/contents/${contentId}/versions`)
      const listData = await listRes.json().catch(() => ({}))
      if (listRes.ok) setVersions(listData.versions ?? [])
    } catch {
      setRollbackError('롤백 중 오류가 발생했습니다.')
    } finally {
      setRollbackLoading(false)
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <History className="h-4 w-4 text-muted-foreground" />
            버전 히스토리
            {versions.length > 0 && (
              <Badge variant="secondary" className="ml-auto text-xs font-normal">
                {versions.length}개
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {/* 롤백 성공/실패 인라인 메시지 */}
          {rollbackMessage && !rollbackError && (
            <p className="mb-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
              {rollbackMessage}
            </p>
          )}
          {rollbackError && (
            <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {rollbackError}
            </p>
          )}

          {/* 로딩 */}
          {loading && (
            <p className="py-4 text-center text-xs text-muted-foreground">버전 로딩 중…</p>
          )}

          {/* 에러 */}
          {!loading && error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          {/* 빈 상태 */}
          {!loading && !error && versions.length === 0 && (
            <p className="py-4 text-center text-xs text-muted-foreground">
              저장된 버전이 없습니다.
            </p>
          )}

          {/* 버전 목록 */}
          {!loading && !error && versions.length > 0 && (
            <div className="space-y-2">
              {versions.map((v, idx) => {
                const isCurrent =
                  currentVersionNumber !== undefined
                    ? v.versionNumber === currentVersionNumber
                    : idx === 0
                return (
                  <div key={v.id}>
                    <div className="rounded-md border bg-card px-3 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge
                              variant={isCurrent ? 'default' : 'outline'}
                              className="shrink-0 text-xs"
                            >
                              v{v.versionNumber}
                            </Badge>
                            {isCurrent && (
                              <span className="text-xs text-muted-foreground">(현재)</span>
                            )}
                          </div>
                          <p className="mt-1 truncate text-xs font-medium">{v.title}</p>
                          {v.note && (
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">
                              {v.note}
                            </p>
                          )}
                          <p className="mt-1 text-xs text-muted-foreground">
                            {dateFormatter.format(new Date(v.createdAt))}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => openPreview(v.id)}
                            aria-label={`v${v.versionNumber} 미리보기`}
                          >
                            <Eye className="mr-1 h-3 w-3" />
                            미리보기
                          </Button>
                          {!isCurrent && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                              onClick={() => openConfirm(v.id, v.versionNumber)}
                              aria-label={`v${v.versionNumber}으로 복구`}
                            >
                              <RotateCcw className="mr-1 h-3 w-3" />
                              복구
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                    {idx < versions.length - 1 && <Separator className="my-1" />}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 미리보기 다이얼로그 */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {previewVersion ? `v${previewVersion.versionNumber} 미리보기` : '버전 미리보기'}
            </DialogTitle>
            {previewVersion?.title && (
              <DialogDescription className="text-xs">{previewVersion.title}</DialogDescription>
            )}
          </DialogHeader>
          {previewLoading && (
            <p className="py-8 text-center text-sm text-muted-foreground">로딩 중…</p>
          )}
          {!previewLoading && previewVersion && (
            <div className="mt-2">
              <Editor initialDoc={previewVersion.doc} editable={false} />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 롤백 확인 다이얼로그 */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">v{rollbackTargetNumber}(으)로 복구할까요?</DialogTitle>
            <DialogDescription className="text-xs">
              현재 본문은 새 버전으로 자동 저장됩니다. 이 작업은 취소할 수 없습니다.
            </DialogDescription>
          </DialogHeader>
          {rollbackError && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {rollbackError}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmOpen(false)}
              disabled={rollbackLoading}
            >
              취소
            </Button>
            <Button variant="destructive" size="sm" onClick={doRollback} disabled={rollbackLoading}>
              {rollbackLoading ? '복구 중…' : '복구'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
