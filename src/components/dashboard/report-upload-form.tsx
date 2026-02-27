'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  UploadCloud,
  FileSpreadsheet,
  X,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  XCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { UploadResponse, UploadColumnError } from '@/types/api'

type FileStatus = 'pending' | 'uploading' | 'saving' | 'done' | 'error'

type DuplicateInfo = {
  duplicateCount: number
  newCount: number
  totalCount: number
}

type ColumnError = {
  missingColumns: string[]
  foundColumns: string[]
}

type FileEntry = {
  id: string
  file: File
  status: FileStatus
  errorMessage?: string
  insertedRows?: number
  storagePath?: string
  columnError?: ColumnError
}

type ApiMessage = {
  message: string
}

function hasMessage(value: unknown): value is ApiMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof (value as ApiMessage).message === 'string'
  )
}

function hasColumnError(value: unknown): value is UploadColumnError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'missingColumns' in value &&
    'foundColumns' in value
  )
}

async function parseApiBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) return response.json()
  const raw = await response.text()
  if (!raw) return {}
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return { message: raw }
  }
}

const STATUS_LABEL: Record<FileStatus, string> = {
  pending: '대기 중',
  uploading: '파일 업로드 중...',
  saving: 'DB 저장 중...',
  done: '완료',
  error: '오류',
}

export function ReportUploadForm() {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)

  // 다중 파일 진행률 모달
  const [isProgressModalOpen, setIsProgressModalOpen] = useState(false)
  const [progressDone, setProgressDone] = useState(false)

  // 단일 파일 중복 확인 다이얼로그
  const [singleDuplicate, setSingleDuplicate] = useState<{
    entryId: string
    info: DuplicateInfo
  } | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const filesRef = useRef<FileEntry[]>(files)
  filesRef.current = files
  const router = useRouter()

  // 처리 중 페이지 이탈 방지
  useEffect(() => {
    if (!isProcessing) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isProcessing])

  const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

  function addFiles(fileList: FileList | File[]) {
    const entries: FileEntry[] = []
    for (const file of Array.from(fileList)) {
      const isValidFormat = file.name.endsWith('.xlsx') || file.name.endsWith('.csv')
      if (!isValidFormat) {
        entries.push({
          id: `${file.name}-${Date.now()}-${Math.random()}`,
          file,
          status: 'error',
          errorMessage: '.xlsx 또는 .csv 파일만 업로드할 수 있습니다',
        })
        continue
      }
      if (file.size > MAX_FILE_SIZE) {
        entries.push({
          id: `${file.name}-${Date.now()}-${Math.random()}`,
          file,
          status: 'error',
          errorMessage:
            '파일 크기가 10MB를 초과합니다. 파일을 분할하거나 용량을 줄인 후 다시 업로드해주세요',
        })
        continue
      }
      entries.push({ id: `${file.name}-${Date.now()}-${Math.random()}`, file, status: 'pending' })
    }
    if (entries.length > 0) setFiles((prev) => [...prev, ...entries])
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) addFiles(e.target.files)
    e.target.value = ''
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragOver(false)
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files)
  }

  function removeFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id))
  }

  function updateFile(id: string, patch: Partial<FileEntry>) {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  }

  // 파일 1개 처리: Storage 업로드 → API 호출
  // 반환값: 성공 시 inserted 수, 중복 확인 필요 시 requiresConfirmation
  async function processOneFile(
    entryId: string,
    overwrite: 'true' | 'false' | null
  ): Promise<{ inserted?: number; requiresConfirmation?: DuplicateInfo }> {
    // filesRef로 최신 상태 참조 (stale closure 방지)
    const entry = filesRef.current.find((f) => f.id === entryId)
    if (!entry) throw new Error('파일을 찾을 수 없습니다')

    // Storage 업로드 (storagePath 없는 경우만)
    let path = entry.storagePath
    if (!path) {
      updateFile(entryId, { status: 'uploading' })
      const urlRes = await fetch(
        `/api/reports/upload-url?fileName=${encodeURIComponent(entry.file.name)}`
      )
      if (!urlRes.ok) throw new Error('업로드 URL 발급에 실패했습니다')
      const { signedUrl, storagePath: newPath } = (await urlRes.json()) as {
        signedUrl: string
        storagePath: string
      }
      const putRes = await fetch(signedUrl, {
        method: 'PUT',
        body: entry.file,
        headers: { 'Content-Type': 'application/octet-stream' },
      })
      if (!putRes.ok) throw new Error('파일 업로드에 실패했습니다')
      path = newPath
      updateFile(entryId, { storagePath: path })
    }

    // DB 처리 API 호출
    updateFile(entryId, { status: 'saving' })
    const url =
      overwrite !== null ? `/api/reports/upload?overwrite=${overwrite}` : '/api/reports/upload'

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storagePath: path, fileName: entry.file.name }),
    })
    const data = await parseApiBody(res)

    if (!res.ok) {
      if (hasColumnError(data)) {
        updateFile(entryId, {
          status: 'error',
          errorMessage: '필수 컬럼 누락',
          columnError: { missingColumns: data.missingColumns, foundColumns: data.foundColumns },
        })
        return {}
      }
      const msg = hasMessage(data) ? data.message : '업로드에 실패했습니다'
      updateFile(entryId, { status: 'error', errorMessage: msg })
      throw new Error(msg)
    }

    const okData = data as UploadResponse
    if ('requiresConfirmation' in okData) {
      updateFile(entryId, { status: 'pending' })
      return {
        requiresConfirmation: {
          duplicateCount: okData.duplicateCount,
          newCount: okData.newCount,
          totalCount: okData.totalCount,
        },
      }
    }

    updateFile(entryId, { status: 'done', insertedRows: okData.inserted })
    return { inserted: okData.inserted }
  }

  // 단일 파일 업로드 (중복 확인 포함)
  async function handleSingleUpload() {
    const pending = files.filter((f) => f.status === 'pending')
    if (pending.length === 0) return
    const entry = pending[0]

    setIsProcessing(true)
    try {
      const result = await processOneFile(entry.id, null)
      if (result.requiresConfirmation) {
        setSingleDuplicate({ entryId: entry.id, info: result.requiresConfirmation })
      } else if (result.inserted !== undefined) {
        toast.success(`${result.inserted}개 행 저장 완료`)
        router.refresh()
      }
    } catch {
      // 오류는 updateFile로 이미 처리됨
    } finally {
      setIsProcessing(false)
    }
  }

  // 단일 파일 중복 확인 후 재업로드
  async function handleConfirmSingle(overwrite: 'true' | 'false') {
    if (!singleDuplicate) return
    const { entryId } = singleDuplicate
    setSingleDuplicate(null)
    setIsProcessing(true)
    try {
      const result = await processOneFile(entryId, overwrite)
      if (result.inserted !== undefined) {
        toast.success(`${result.inserted}개 행 저장 완료`)
        router.refresh()
      }
    } catch {
      // 오류는 updateFile로 이미 처리됨
    } finally {
      setIsProcessing(false)
    }
  }

  // 다중 파일 업로드 (진행률 모달)
  async function handleMultiUpload() {
    const pending = files.filter((f) => f.status === 'pending')
    if (pending.length === 0) return

    setIsProgressModalOpen(true)
    setProgressDone(false)
    setIsProcessing(true)

    for (const entry of pending) {
      try {
        // 다중 파일: 중복 시 자동으로 overwrite=false 적용
        await processOneFile(entry.id, 'false')
      } catch {
        // 파일별 오류는 updateFile로 이미 처리됨
      }
    }

    setIsProcessing(false)
    setProgressDone(true)
    router.refresh()
  }

  async function handleUpload() {
    const pending = files.filter((f) => f.status === 'pending')
    if (pending.length === 0) {
      toast.error('업로드할 파일을 선택해주세요')
      return
    }
    if (pending.length === 1) {
      await handleSingleUpload()
    } else {
      await handleMultiUpload()
    }
  }

  function handleProgressModalClose() {
    if (isProcessing) return
    setIsProgressModalOpen(false)
    setProgressDone(false)
    setFiles((prev) => prev.filter((f) => f.status !== 'done'))
  }

  const pendingCount = files.filter((f) => f.status === 'pending').length
  const doneFiles = files.filter((f) => f.status === 'done')
  const totalInserted = doneFiles.reduce((sum, f) => sum + (f.insertedRows ?? 0), 0)
  const isMultiple = files.filter((f) => f.status !== 'done').length > 1

  return (
    <>
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>파일 선택</CardTitle>
            <CardDescription>
              쿠팡 셀러센터에서 다운로드한 광고 리포트를 업로드하세요 (Excel, CSV 모두 지원)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              className={cn(
                'cursor-pointer rounded-lg border-2 border-dashed p-10 text-center transition-colors',
                isDragOver
                  ? 'border-orange-400 bg-orange-50 dark:bg-orange-950/20'
                  : 'border-gray-300 hover:border-orange-400 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900/50'
              )}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.csv"
                multiple
                className="hidden"
                onChange={handleInputChange}
              />
              <UploadCloud className="mx-auto mb-4 h-10 w-10 text-gray-400" />
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                여기에 파일을 드래그하거나 클릭하여 선택하세요
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Excel (.xlsx), CSV (.csv) · 여러 파일 동시 선택 가능
              </p>
            </div>

            {files.length > 0 && (
              <div className="space-y-1.5">
                {files.map((entry) => (
                  <div key={entry.id}>
                    <div className="flex items-center gap-3 rounded-lg border bg-gray-50 p-3 dark:bg-gray-900/50">
                      <FileSpreadsheet className="h-5 w-5 flex-shrink-0 text-green-600" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{entry.file.name}</p>
                        <p className="text-xs text-gray-500">
                          {(entry.file.size / 1024 / 1024).toFixed(2)} MB
                          {' · '}
                          <span
                            className={cn(
                              entry.status === 'done' && 'text-green-600',
                              entry.status === 'error' && 'text-red-500',
                              (entry.status === 'uploading' || entry.status === 'saving') &&
                                'text-orange-500'
                            )}
                          >
                            {STATUS_LABEL[entry.status]}
                            {entry.status === 'done' &&
                              entry.insertedRows != null &&
                              ` (저장 ${entry.insertedRows.toLocaleString()}건)`}
                            {entry.status === 'error' &&
                              entry.errorMessage &&
                              ` · ${entry.errorMessage}`}
                          </span>
                        </p>
                      </div>
                      {(entry.status === 'pending' || entry.status === 'error') && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            removeFile(entry.id)
                          }}
                          className="text-gray-400 hover:text-gray-600"
                          aria-label="파일 제거"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    {entry.columnError && (
                      <div className="mt-1 rounded-lg border border-orange-200 bg-orange-50 p-3 dark:border-orange-800 dark:bg-orange-950/30">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-orange-600" />
                          <div className="space-y-1 text-xs">
                            <p className="font-semibold text-orange-800 dark:text-orange-300">
                              필수 컬럼이 누락되었습니다
                            </p>
                            <p className="text-orange-700 dark:text-orange-400">
                              누락:{' '}
                              <span className="font-medium">
                                {entry.columnError.missingColumns.join(', ')}
                              </span>
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <Button
              className="w-full gap-2"
              size="lg"
              onClick={handleUpload}
              disabled={pendingCount === 0 || isProcessing}
            >
              <UploadCloud className="h-4 w-4" />
              {isProcessing
                ? '업로드 중...'
                : isMultiple
                  ? `${pendingCount}개 파일 업로드`
                  : '업로드'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <h3 className="mb-3 text-sm font-semibold">업로드 안내</h3>
            <ul className="list-inside list-disc space-y-1 text-sm text-gray-600 dark:text-gray-400">
              <li>쿠팡 셀러센터 광고 관리 메뉴에서 리포트를 다운로드할 수 있습니다</li>
              <li>Excel (.xlsx) 및 CSV (.csv) 형식의 파일을 업로드할 수 있습니다</li>
              <li>여러 파일을 동시에 선택하여 일괄 업로드할 수 있습니다</li>
              <li>
                동일 기간 데이터 재업로드 시 덮어쓰기 또는 중복 제외 저장을 선택할 수 있습니다
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* 다중 파일 진행률 모달 */}
      <Dialog
        open={isProgressModalOpen}
        onOpenChange={(open) => {
          if (!open && isProcessing) return
          if (!open) handleProgressModalClose()
        }}
      >
        <DialogContent
          className="sm:max-w-md"
          onEscapeKeyDown={(e) => {
            if (isProcessing) e.preventDefault()
          }}
          onInteractOutside={(e) => {
            if (isProcessing) e.preventDefault()
          }}
        >
          <DialogHeader>
            <DialogTitle>파일 업로드 중</DialogTitle>
            <DialogDescription>
              {isProcessing
                ? `${files.filter((f) => f.status === 'done' || f.status === 'error').length + 1}번째 / 전체 ${files.length}개 처리 중`
                : `완료: 성공 ${doneFiles.length}개, 실패 ${files.filter((f) => f.status === 'error').length}개`}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-64 space-y-2 overflow-y-auto">
            {files.map((entry) => (
              <div key={entry.id} className="flex items-center gap-3 rounded-md border p-2.5">
                {entry.status === 'done' && (
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-500" />
                )}
                {entry.status === 'error' && (
                  <XCircle className="h-4 w-4 flex-shrink-0 text-red-500" />
                )}
                {(entry.status === 'uploading' || entry.status === 'saving') && (
                  <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-orange-500" />
                )}
                {entry.status === 'pending' && (
                  <div className="h-4 w-4 flex-shrink-0 rounded-full border-2 border-gray-300" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{entry.file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {STATUS_LABEL[entry.status]}
                    {entry.status === 'done' &&
                      entry.insertedRows != null &&
                      ` · 저장 ${entry.insertedRows.toLocaleString()}건`}
                    {entry.status === 'error' && entry.errorMessage && ` · ${entry.errorMessage}`}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {progressDone && (
            <div className="rounded-md bg-muted px-4 py-3 text-sm">
              <p className="font-medium">
                전체 완료: {files.length}개 파일 · 총 저장 {totalInserted.toLocaleString()}건
              </p>
            </div>
          )}

          {isProcessing && (
            <p className="text-center text-xs text-muted-foreground">
              ⚠ 업로드 중에는 페이지를 이동하지 마세요
            </p>
          )}

          {progressDone && (
            <DialogFooter>
              <Button onClick={handleProgressModalClose} className="w-full">
                닫기
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* 단일 파일 중복 확인 다이얼로그 */}
      <Dialog
        open={singleDuplicate !== null}
        onOpenChange={(open) => {
          if (!open) setSingleDuplicate(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              중복 데이터 발견
            </DialogTitle>
            <DialogDescription className="pt-2">
              중복 행이 발견되었습니다. 덮어쓰기 또는 중복 제외 저장 중 하나를 선택하세요.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>
              전체{' '}
              <span className="font-semibold text-foreground">
                {singleDuplicate?.info.totalCount}개
              </span>{' '}
              행 중{' '}
              <span className="font-semibold text-orange-600">
                {singleDuplicate?.info.duplicateCount}개
              </span>
              가 이미 저장되어 있습니다.
            </p>
            <p>
              새로운 데이터:{' '}
              <span className="font-semibold text-foreground">
                {singleDuplicate?.info.newCount}개
              </span>
            </p>
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => setSingleDuplicate(null)}>
              취소
            </Button>
            <Button variant="outline" onClick={() => handleConfirmSingle('false')}>
              중복 제외 저장
            </Button>
            <Button onClick={() => handleConfirmSingle('true')}>덮어쓰기</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
