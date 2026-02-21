'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { UploadCloud, FileSpreadsheet, X } from 'lucide-react'
import { cn } from '@/lib/utils'

type UploadStatus = 'idle' | 'parsing' | 'saving' | 'success' | 'error'

export default function UploadPage() {
  const [status, setStatus] = useState<UploadStatus>('idle')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
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
    // handleFileSelect는 상태 setter만 사용하므로 렌더마다 재생성되나 로직은 안정적
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  function clearFile() {
    setSelectedFile(null)
    setStatus('idle')
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  async function handleUpload() {
    if (!selectedFile) {
      toast.error('파일을 선택해주세요')
      return
    }

    try {
      // 서버가 파싱하므로 직접 multipart/form-data 전송
      setStatus('saving')
      const formData = new FormData()
      formData.append('file', selectedFile)

      const res = await fetch('/api/reports/upload', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        let message = '업로드에 실패했습니다'
        try {
          const err = await res.json()
          message = err.message || message
        } catch {
          // HTML 응답 등 JSON 파싱 실패 시 기본 메시지 사용
        }
        throw new Error(message)
      }

      const { inserted } = await res.json()
      setStatus('success')
      toast.success(`${inserted}개 행 저장 완료`)
      router.push('/dashboard')
      router.refresh()
    } catch (error) {
      setStatus('error')
      toast.error(error instanceof Error ? error.message : '업로드 중 오류가 발생했습니다')
    }
  }

  const isProcessing = status === 'parsing' || status === 'saving'

  const statusLabel: Record<UploadStatus, string> = {
    idle: '업로드',
    parsing: '파일 파싱 중...',
    saving: 'DB 저장 중...',
    success: '완료',
    error: '다시 시도',
  }

  return (
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
            <li>동일 기간의 데이터를 재업로드하면 기존 데이터와 병합됩니다</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
