'use client'

import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { FileText, Link2, Loader2, Paperclip, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Progress } from '@/components/ui/progress'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { ExtractJob, UploadedSourceFile } from './types'

const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
const MAX_FILES = 5
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_BYTES = 12 * 1024 * 1024

type PendingFile = {
  id: string
  file: File
  status: 'uploading' | 'done' | 'error'
  error?: string
  uploaded?: UploadedSourceFile
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

type Props = {
  productId: string
  onCreated: (job: ExtractJob) => void
}

/**
 * AI 추출 소재 입력 — URL / 파일(이미지·PDF) / 붙여넣기 텍스트 3종을 모아
 * POST /extract 로 제출한다. 추출은 수초~수십초가 걸릴 수 있어(측정: PDF 1장 ~9초,
 * 여러 소재는 그 이상) 진행 중임을 분명히 보여주고 버튼을 잠근다.
 */
export function ProductExtractSourceForm({ productId, onCreated }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)

  const [url, setUrl] = useState('')
  const [urlLoading, setUrlLoading] = useState(false)
  const [urlError, setUrlError] = useState<string | null>(null)
  const [urlTitle, setUrlTitle] = useState<string | null>(null)
  const [urlText, setUrlText] = useState<string | null>(null)
  const [urlPreviewOpen, setUrlPreviewOpen] = useState(false)

  const [pastedText, setPastedText] = useState('')

  const [files, setFiles] = useState<PendingFile[]>([])

  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)
  // 진행 중 실제 퍼센트를 알 방법이 없어(단일 응답) 정지된 느낌을 주지 않도록
  // 타이머로 서서히 90%까지만 채우는 determinate-feeling progress.
  const [progress, setProgress] = useState(0)
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const totalBytes = files.reduce((sum, f) => sum + f.file.size, 0)

  const startProgress = useCallback(() => {
    setProgress(8)
    if (progressTimerRef.current) clearInterval(progressTimerRef.current)
    progressTimerRef.current = setInterval(() => {
      setProgress((p) => (p >= 90 ? p : p + (90 - p) * 0.08 + 1))
    }, 500)
  }, [])

  const stopProgress = useCallback((final: number) => {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current)
      progressTimerRef.current = null
    }
    setProgress(final)
  }, [])

  const handleFetchUrl = useCallback(async () => {
    if (!url.trim()) {
      setUrlError('URL을 입력하세요')
      return
    }
    setUrlLoading(true)
    setUrlError(null)
    try {
      const res = await fetch(`/api/sh/products/${productId}/extract/url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setUrlError(data?.message ?? 'URL을 불러오지 못했습니다')
        return
      }
      setUrlTitle(data.title ?? null)
      setUrlText(data.text ?? '')
      setUrlPreviewOpen(false)
    } catch {
      setUrlError('URL을 불러오는 중 오류가 발생했습니다')
    } finally {
      setUrlLoading(false)
    }
  }, [productId, url])

  const uploadOneFile = useCallback(
    async (pending: PendingFile) => {
      try {
        const form = new FormData()
        form.append('file', pending.file)
        const res = await fetch(`/api/sh/products/${productId}/extract/files`, {
          method: 'POST',
          body: form,
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setFiles((prev) =>
            prev.map((f) =>
              f.id === pending.id
                ? { ...f, status: 'error', error: data?.message ?? '업로드 실패' }
                : f
            )
          )
          return
        }
        setFiles((prev) =>
          prev.map((f) => (f.id === pending.id ? { ...f, status: 'done', uploaded: data } : f))
        )
      } catch {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === pending.id ? { ...f, status: 'error', error: '업로드 중 오류' } : f
          )
        )
      }
    },
    [productId]
  )

  const addFiles = useCallback(
    (list: FileList | File[]) => {
      const incoming = Array.from(list)
      if (files.length + incoming.length > MAX_FILES) {
        toast.error(`파일은 최대 ${MAX_FILES}개까지 첨부할 수 있습니다`)
        return
      }
      const accepted: PendingFile[] = []
      for (const file of incoming) {
        if (!ALLOWED_MIME.includes(file.type)) {
          toast.error(`${file.name}: 허용되지 않는 파일 형식입니다 (PNG/JPEG/WEBP/PDF만 가능)`)
          continue
        }
        if (file.size > MAX_FILE_BYTES) {
          toast.error(`${file.name}: 파일당 10MB를 초과했습니다`)
          continue
        }
        if (
          totalBytes + accepted.reduce((s, f) => s + f.file.size, 0) + file.size >
          MAX_TOTAL_BYTES
        ) {
          toast.error('첨부 파일 합계가 12MB를 초과합니다 (서버에서도 동일하게 제한됩니다)')
          continue
        }
        accepted.push({ id: crypto.randomUUID(), file, status: 'uploading' })
      }
      if (accepted.length === 0) return
      setFiles((prev) => [...prev, ...accepted])
      for (const p of accepted) void uploadOneFile(p)
    },
    [files.length, totalBytes, uploadOneFile]
  )

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id))
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setDragActive(false)
      if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files)
    },
    [addFiles]
  )

  const canSubmit =
    (urlText?.trim() || pastedText.trim() || files.some((f) => f.status === 'done')) &&
    !files.some((f) => f.status === 'uploading') &&
    !extracting

  const handleExtract = useCallback(async () => {
    setExtractError(null)
    setExtracting(true)
    startProgress()
    try {
      const doneFiles = files.filter((f) => f.status === 'done' && f.uploaded)
      const res = await fetch(`/api/sh/products/${productId}/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url.trim() || undefined,
          urlText: urlText || undefined,
          pastedText: pastedText.trim() || undefined,
          files: doneFiles.map((f) => f.uploaded),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 429 && data?.code === 'TEXT_CREDIT_EXCEEDED') {
          setExtractError('이번 달 AI 추출 한도를 모두 사용했습니다')
        } else if (res.status === 413) {
          setExtractError(data?.message ?? '첨부 용량이 제한을 초과했습니다')
        } else {
          setExtractError(data?.message ?? 'AI 추출에 실패했습니다')
        }
        return
      }
      stopProgress(100)
      toast.success('AI 추출이 완료되었습니다')
      onCreated(data.job)
      // 성공 시 입력을 비워 다음 추출을 깨끗하게 시작
      setUrl('')
      setUrlText(null)
      setUrlTitle(null)
      setPastedText('')
      setFiles([])
    } catch {
      setExtractError('AI 추출 중 오류가 발생했습니다')
    } finally {
      setExtracting(false)
      setTimeout(() => setProgress(0), 400)
    }
  }, [files, onCreated, pastedText, productId, startProgress, stopProgress, url, urlText])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">소재 입력</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* URL */}
        <div className="space-y-2">
          <Label htmlFor="ex-url">상세페이지 URL</Label>
          <div className="flex gap-2">
            <Input
              id="ex-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              disabled={urlLoading || extracting}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={handleFetchUrl}
              disabled={urlLoading || extracting || !url.trim()}
            >
              {urlLoading ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Link2 className="mr-1.5 h-4 w-4" />
              )}
              불러오기
            </Button>
          </div>
          {urlError && <p className="text-xs text-destructive">{urlError}</p>}
          {urlText !== null && (
            <div className="rounded-md border bg-muted/30 p-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{urlTitle || '(제목 없음)'}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => setUrlPreviewOpen((v) => !v)}
                >
                  {urlPreviewOpen ? '접기' : '본문 미리보기'}
                </Button>
              </div>
              <p
                className={cn(
                  'mt-1 whitespace-pre-wrap text-muted-foreground',
                  !urlPreviewOpen && 'line-clamp-2'
                )}
              >
                {urlText || '(추출된 본문 없음)'}
              </p>
            </div>
          )}
        </div>

        {/* 파일 드롭존 */}
        <div className="space-y-2">
          <Label>첨부 파일 (이미지/PDF, 최대 {MAX_FILES}개·개당 10MB·합계 12MB)</Label>
          <div
            className={cn(
              'flex cursor-pointer flex-col items-center gap-1.5 rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground transition-colors',
              dragActive ? 'border-primary bg-primary/5' : 'border-input hover:bg-muted/40'
            )}
            onDragOver={(e) => {
              e.preventDefault()
              setDragActive(true)
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click()
            }}
          >
            <Upload className="h-5 w-5" />
            <p>클릭하거나 파일을 끌어다 놓으세요</p>
            <p className="text-xs">
              PNG · JPEG · WEBP · PDF — 서버에서도 동일하게 용량이 제한됩니다
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ALLOWED_MIME.join(',')}
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          {files.length > 0 && (
            <ul className="space-y-1.5">
              {files.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-xs"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    {f.file.type === 'application/pdf' ? (
                      <FileText className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <Paperclip className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="truncate">{f.file.name}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {formatBytes(f.file.size)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {f.status === 'uploading' && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    )}
                    {f.status === 'done' && <span className="text-emerald-600">업로드됨</span>}
                    {f.status === 'error' && (
                      <span className="text-destructive" title={f.error}>
                        {f.error ?? '실패'}
                      </span>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => removeFile(f.id)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 붙여넣기 텍스트 */}
        <div className="space-y-2">
          <Label htmlFor="ex-paste">붙여넣기 텍스트</Label>
          <Textarea
            id="ex-paste"
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            placeholder="상세페이지 텍스트나 상품 정보를 그대로 붙여넣으세요"
            rows={4}
            maxLength={30000}
            disabled={extracting}
          />
        </div>

        <div className="space-y-2">
          <Button type="button" onClick={handleExtract} disabled={!canSubmit} className="w-full">
            {extracting ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                AI로 추출하는 중... (수십 초가 걸릴 수 있습니다)
              </>
            ) : (
              'AI로 추출'
            )}
          </Button>
          {extracting && <Progress value={progress} />}
          {extractError && <p className="text-xs text-destructive">{extractError}</p>}
        </div>
      </CardContent>
    </Card>
  )
}
