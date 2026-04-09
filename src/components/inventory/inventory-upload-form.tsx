'use client'

import { useState, useRef, useCallback } from 'react'
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
import { UploadCloud, FileSpreadsheet, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'

type Props = {
  onUploadComplete?: () => void
}

export function InventoryUploadForm({ onUploadComplete }: Props) {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [snapshotDate, setSnapshotDate] = useState(() => {
    const d = new Date()
    return d.toISOString().split('T')[0]
  })
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback((f: File) => {
    const ext = f.name.split('.').pop()?.toLowerCase()
    if (ext !== 'xlsx' && ext !== 'xls') {
      toast.error('엑셀 파일(.xlsx, .xls)만 지원됩니다')
      return
    }
    if (f.size > 10 * 1024 * 1024) {
      toast.error('파일 크기가 10MB를 초과합니다')
      return
    }
    setFile(f)
  }, [])

  async function handleUpload() {
    if (!file) return
    setUploading(true)

    try {
      // 1. Signed URL 획득
      const urlRes = await fetch(
        `/api/reports/upload-url?fileName=${encodeURIComponent(file.name)}`
      )
      if (!urlRes.ok) throw new Error('업로드 URL 생성 실패')
      const { signedUrl, storagePath } = await urlRes.json()

      // 2. Supabase Storage 업로드
      const uploadRes = await fetch(signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      })
      if (!uploadRes.ok) throw new Error('파일 업로드 실패')

      // 3. 서버에서 처리
      const processRes = await fetch('/api/inventory/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storagePath,
          fileName: file.name,
          snapshotDate,
        }),
      })

      const result = await processRes.json()
      if (!processRes.ok || !result.success) {
        throw new Error(result.error ?? result.message ?? '처리 실패')
      }

      const typeLabel =
        result.fileType === 'INVENTORY_HEALTH' ? '재고 건강성' : '상품 판매 성과'
      toast.success(`${typeLabel} 데이터 ${result.insertedRows}건 저장 완료`)
      setFile(null)
      setOpen(false)
      onUploadComplete?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '업로드 실패')
    } finally {
      setUploading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UploadCloud className="mr-2 h-4 w-4" />
          데이터 업로드
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>재고/상품 데이터 업로드</DialogTitle>
          <DialogDescription>
            Wing에서 다운로드한 재고 건강성 또는 셀러 인사이트 엑셀을 업로드하세요.
            파일 형식을 자동으로 감지합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>데이터 기준일</Label>
            <Input
              type="date"
              value={snapshotDate}
              onChange={(e) => setSnapshotDate(e.target.value)}
            />
          </div>

          {!file ? (
            <div
              className={cn(
                'flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors',
                dragOver
                  ? 'border-primary bg-primary/5'
                  : 'border-muted-foreground/25 hover:border-primary/50'
              )}
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                const f = e.dataTransfer.files[0]
                if (f) handleFile(f)
              }}
            >
              <UploadCloud className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                파일을 드래그하거나 클릭하여 선택
              </p>
              <p className="text-xs text-muted-foreground">.xlsx (최대 10MB)</p>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleFile(f)
                  e.target.value = ''
                }}
              />
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-lg border p-3">
              <FileSpreadsheet className="h-5 w-5 shrink-0 text-emerald-500" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(file.size / 1024).toFixed(0)} KB
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={() => setFile(null)}
                disabled={uploading}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            onClick={handleUpload}
            disabled={!file || uploading}
            className="w-full"
          >
            {uploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                처리 중...
              </>
            ) : (
              '업로드'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
