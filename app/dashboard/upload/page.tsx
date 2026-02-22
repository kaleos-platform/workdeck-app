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

type UploadStatus = 'idle' | 'saving' | 'success' | 'error'

// 중복 감지 응답 타입
type DuplicateInfo = {
  duplicateCount: number
  newCount: number
  totalCount: number
}

// 컬럼 검증 오류 타입
type ColumnError = {
  missingColumns: string[]
  foundColumns: string[]
}

export default function UploadPage() {
  const [status, setStatus] = useState<UploadStatus>('idle')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [duplicateInfo, setDuplicateInfo] = useState<DuplicateInfo | null>(null)
  const [columnError, setColumnError] = useState<ColumnError | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  // 파일 유효성 검사 (.xlsx, .csv 허용)
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

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
      const file = e.dataTransfer.files?.[0]
      if (file) handleFileSelect(file)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  function clearFile() {
    setSelectedFile(null)
    setStatus('idle')
    setColumnError(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // 실제 업로드 실행 (overwrite: null=첫요청, 'true'=덮어쓰기, 'false'=스킵)
  async function doUpload(file: File, overwrite: 'true' | 'false' | null) {
    setStatus('saving')
    const formData = new FormData()
    formData.append('file', file)

    const url =
      overwrite !== null ? `/api/reports/upload?overwrite=${overwrite}` : '/api/reports/upload'

    const res = await fetch(url, { method: 'POST', body: formData })
    const data = await res.json()

    if (!res.ok) {
      // 컬럼 검증 오류
      if (data.missingColumns) {
        setColumnError({ missingColumns: data.missingColumns, foundColumns: data.foundColumns })
        setStatus('error')
        return
      }
      throw new Error(data.message || '업로드에 실패했습니다')
    }

    // 중복 감지: 사용자 확인 필요
    if (data.requiresConfirmation) {
      setDuplicateInfo({
        duplicateCount: data.duplicateCount,
        newCount: data.newCount,
        totalCount: data.totalCount,
      })
      setStatus('idle')
      return
    }

    // 성공
    setStatus('success')
    toast.success(`${data.inserted}개 행 저장 완료`)
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

  // 중복 확인 다이얼로그 — 사용자가 덮어쓰기 / 스킵 선택
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
    saving: 'DB 저장 중...',
    success: '완료',
    error: '다시 시도',
  }

  return (
    <>
      <div className="mx-auto max-w-2xl space-y-6">
        {/* 페이지 헤더 */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">리포트 업로드</h1>
          <p className="mt-1 text-gray-600 dark:text-gray-400">
            쿠팡 광고 리포트 Excel 파일을 업로드하세요
          </p>
        </div>

        {/* 업로드 카드 */}
        <Card>
          <CardHeader>
            <CardTitle>파일 선택</CardTitle>
            <CardDescription>
              쿠팡 셀러센터에서 다운로드한 광고 리포트를 업로드하세요 (Excel, CSV 모두 지원)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 드래그앤드롭 영역 */}
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

            {/* 선택된 파일 표시 */}
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

            {/* 컬럼 검증 오류 표시 */}
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

            {/* 업로드 버튼 */}
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

        {/* 안내 사항 */}
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

      {/* 중복 확인 다이얼로그 */}
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
            <DialogDescription asChild>
              <div className="space-y-2 pt-2 text-sm">
                <p>
                  전체{' '}
                  <span className="font-semibold text-foreground">
                    {duplicateInfo?.totalCount}개
                  </span>{' '}
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
            </DialogDescription>
          </DialogHeader>
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
