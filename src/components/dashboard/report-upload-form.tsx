'use client'

import { useState, useRef, useCallback } from 'react'
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
import { UploadCloud, FileSpreadsheet, X, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { UploadResponse, UploadColumnError } from '@/types/api'

type UploadStatus = 'idle' | 'saving' | 'success' | 'error'

type DuplicateInfo = {
  duplicateCount: number
  newCount: number
  totalCount: number
}

type ColumnError = {
  missingColumns: string[]
  foundColumns: string[]
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

  if (contentType.includes('application/json')) {
    return response.json()
  }

  const raw = await response.text()
  if (!raw) return {}

  try {
    return JSON.parse(raw) as unknown
  } catch {
    return { message: raw }
  }
}

export function ReportUploadForm() {
  const [status, setStatus] = useState<UploadStatus>('idle')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [duplicateInfo, setDuplicateInfo] = useState<DuplicateInfo | null>(null)
  const [columnError, setColumnError] = useState<ColumnError | null>(null)
  // 중복 확인 후 덮어쓰기 요청 시 Storage 재업로드 방지용
  const [storagePath, setStoragePath] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  function validateFile(file: File): boolean {
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.csv')) {
      toast.error('.xlsx 또는 .csv 파일만 업로드할 수 있습니다')
      return false
    }
    return true
  }

  function handleFileSelect(file: File) {
    if (validateFile(file)) {
      setSelectedFile(file)
      setStatus('idle')
      setColumnError(null)
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFileSelect(file)
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
    const file = e.dataTransfer.files?.[0]
    if (file) handleFileSelect(file)
  }

  function clearFile() {
    setSelectedFile(null)
    setStatus('idle')
    setColumnError(null)
    setStoragePath(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  async function doUpload(file: File, overwrite: 'true' | 'false' | null) {
    setStatus('saving')

    // Step 1: Storage에 아직 업로드 안 됐으면 1회만 업로드
    let path = storagePath
    if (!path) {
      const urlRes = await fetch(
        `/api/reports/upload-url?fileName=${encodeURIComponent(file.name)}`
      )
      if (!urlRes.ok) {
        throw new Error('업로드 URL 발급에 실패했습니다')
      }
      const { signedUrl, storagePath: newPath } = await urlRes.json()
      // 브라우저에서 Supabase Storage로 직접 PUT (Vercel 4.5MB 제한 우회)
      const putRes = await fetch(signedUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': 'application/octet-stream' },
      })
      if (!putRes.ok) {
        throw new Error('파일 업로드에 실패했습니다')
      }
      path = newPath
      setStoragePath(path)
    }

    // Step 2: 처리 API 호출 (JSON body — 수 바이트)
    const url =
      overwrite !== null ? `/api/reports/upload?overwrite=${overwrite}` : '/api/reports/upload'

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storagePath: path, fileName: file.name }),
    })
    const data = await parseApiBody(res)

    if (!res.ok) {
      if (hasColumnError(data)) {
        setColumnError({
          missingColumns: data.missingColumns,
          foundColumns: data.foundColumns,
        })
        setStatus('error')
        return
      }

      if (res.status === 413) {
        throw new Error(
          '요청 크기가 서버 제한을 초과했습니다. 최신 배포가 반영되었는지 확인 후 다시 시도해주세요.'
        )
      }

      if (hasMessage(data)) {
        throw new Error(data.message)
      }

      throw new Error('업로드에 실패했습니다')
    }

    const okData = data as UploadResponse
    if ('requiresConfirmation' in okData) {
      setDuplicateInfo({
        duplicateCount: okData.duplicateCount,
        newCount: okData.newCount,
        totalCount: okData.totalCount,
      })
      setStatus('idle')
      return
    }

    setStatus('success')
    setStoragePath(null)
    toast.success(`${okData.inserted}개 행 저장 완료`)
    router.push('/dashboard')
    router.refresh()
  }

  async function handleUpload() {
    if (!selectedFile) {
      toast.error('파일을 선택해주세요')
      return
    }
    setColumnError(null)
    try {
      await doUpload(selectedFile, null)
    } catch (error) {
      setStatus('error')
      toast.error(error instanceof Error ? error.message : '업로드 중 오류가 발생했습니다')
    }
  }

  async function handleConfirmUpload(overwrite: 'true' | 'false') {
    if (!selectedFile) return
    setDuplicateInfo(null)
    try {
      await doUpload(selectedFile, overwrite)
    } catch (error) {
      setStatus('error')
      toast.error(error instanceof Error ? error.message : '업로드 중 오류가 발생했습니다')
    }
  }

  const isProcessing = status === 'saving'
  const statusLabel: Record<UploadStatus, string> = {
    idle: '업로드',
    saving: storagePath ? 'DB 저장 중...' : '파일 업로드 중...',
    success: '완료',
    error: '다시 시도',
  }

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
                className="hidden"
                onChange={handleInputChange}
              />
              <UploadCloud className="mx-auto mb-4 h-10 w-10 text-gray-400" />
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                여기에 파일을 드래그하거나 클릭하여 선택하세요
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Excel (.xlsx), CSV (.csv) 파일을 지원합니다
              </p>
            </div>

            {selectedFile && (
              <div className="flex items-center gap-3 rounded-lg border bg-gray-50 p-3 dark:bg-gray-900/50">
                <FileSpreadsheet className="h-5 w-5 flex-shrink-0 text-green-600" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{selectedFile.name}</p>
                  <p className="text-xs text-gray-500">
                    {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    clearFile()
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {columnError && (
              <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 dark:border-orange-800 dark:bg-orange-950/30">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-orange-600" />
                  <div className="space-y-2 text-sm">
                    <p className="font-semibold text-orange-800 dark:text-orange-300">
                      필수 컬럼이 누락되었습니다
                    </p>
                    <p className="text-orange-700 dark:text-orange-400">
                      누락된 컬럼:{' '}
                      <span className="font-medium">{columnError.missingColumns.join(', ')}</span>
                    </p>
                    <p className="text-orange-600 dark:text-orange-500">
                      파일의 컬럼: {columnError.foundColumns.slice(0, 8).join(', ')}
                      {columnError.foundColumns.length > 8 &&
                        ` 외 ${columnError.foundColumns.length - 8}개`}
                    </p>
                    <p className="text-orange-600 dark:text-orange-500">
                      쿠팡 셀러센터에서 다운로드한 광고 리포트 파일인지 확인해주세요
                    </p>
                  </div>
                </div>
              </div>
            )}

            <Button
              className="w-full gap-2"
              size="lg"
              onClick={handleUpload}
              disabled={!selectedFile || isProcessing}
            >
              <UploadCloud className="h-4 w-4" />
              {statusLabel[status]}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <h3 className="mb-3 text-sm font-semibold">업로드 안내</h3>
            <ul className="list-inside list-disc space-y-1 text-sm text-gray-600 dark:text-gray-400">
              <li>쿠팡 셀러센터 광고 관리 메뉴에서 리포트를 다운로드할 수 있습니다</li>
              <li>Excel (.xlsx) 및 CSV (.csv) 형식의 파일을 업로드할 수 있습니다</li>
              <li>
                동일 기간 데이터 재업로드 시 덮어쓰기 또는 중복 제외 저장을 선택할 수 있습니다
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={duplicateInfo !== null}
        onOpenChange={(open) => {
          if (!open) setDuplicateInfo(null)
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
              <span className="font-semibold text-foreground">{duplicateInfo?.totalCount}개</span>{' '}
              행 중{' '}
              <span className="font-semibold text-orange-600">
                {duplicateInfo?.duplicateCount}개
              </span>
              가 이미 저장되어 있습니다.
            </p>
            <p>
              새로운 데이터:{' '}
              <span className="font-semibold text-foreground">{duplicateInfo?.newCount}개</span>
            </p>
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              onClick={() => setDuplicateInfo(null)}
              disabled={isProcessing}
            >
              취소
            </Button>
            <Button
              variant="outline"
              onClick={() => handleConfirmUpload('false')}
              disabled={isProcessing}
            >
              중복 제외 저장
            </Button>
            <Button onClick={() => handleConfirmUpload('true')} disabled={isProcessing}>
              덮어쓰기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
