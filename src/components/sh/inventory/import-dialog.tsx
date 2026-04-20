'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Upload, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ImportTemplate } from '@/components/sh/inventory/import-template'

type ImportResult = {
  importHistoryId: string
  totalRows: number
  successRows: number
  errorRows: number
  errors: { row: number; message: string }[]
}

export function ImportDialog({ onImported }: { onImported?: () => void }) {
  const [open, setOpen] = React.useState(false)
  const [file, setFile] = React.useState<File | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [result, setResult] = React.useState<ImportResult | null>(null)

  const reset = () => {
    setFile(null)
    setResult(null)
    setLoading(false)
  }

  const handleClose = (next: boolean) => {
    if (!next) reset()
    setOpen(next)
  }

  const handleSubmit = async () => {
    if (!file) {
      toast.error('파일을 선택해주세요')
      return
    }
    setLoading(true)
    setResult(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/sh/inventory/import', { method: 'POST', body: formData })
      const json = (await res.json()) as ImportResult & {
        message?: string
        missingColumns?: string[]
      }
      if (!res.ok) {
        const missing = json.missingColumns?.length
          ? ` (누락: ${json.missingColumns.join(', ')})`
          : ''
        toast.error(`${json.message ?? '가져오기 실패'}${missing}`)
        return
      }
      setResult(json)
      if (json.errorRows === 0) {
        toast.success(`총 ${json.totalRows}건 중 ${json.successRows}건 성공`)
      } else {
        toast.warning(
          `성공 ${json.successRows}건 / 실패 ${json.errorRows}건 (총 ${json.totalRows}건)`
        )
      }
      onImported?.()
    } catch (err) {
      console.error(err)
      toast.error('업로드 중 오류가 발생했습니다')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger asChild>
        <Button>
          <Upload className="mr-2 h-4 w-4" />
          대량 가져오기
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>재고 이동 대량 가져오기</DialogTitle>
          <DialogDescription>
            Excel(.xlsx) 또는 CSV 파일을 업로드하여 여러 건의 재고 이동을 한 번에 처리합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-sm text-muted-foreground">
              먼저 템플릿을 다운로드 받아 형식에 맞춰 작성해주세요.
            </Label>
            <ImportTemplate />
          </div>

          <div className="space-y-2">
            <Label htmlFor="import-file">파일 선택</Label>
            <Input
              id="import-file"
              type="file"
              accept=".xlsx,.csv"
              disabled={loading}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null
                setFile(f)
                setResult(null)
              }}
            />
            {file && (
              <p className="text-xs text-muted-foreground">
                선택됨: {file.name} ({Math.round(file.size / 1024)} KB)
              </p>
            )}
          </div>

          {result && (
            <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
              <div className="grid grid-cols-3 gap-3 text-center text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">총</div>
                  <div className="text-lg font-semibold">{result.totalRows}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">성공</div>
                  <div className="text-lg font-semibold text-emerald-600">{result.successRows}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">실패</div>
                  <div className="text-lg font-semibold text-red-600">{result.errorRows}</div>
                </div>
              </div>

              {result.errors.length > 0 && (
                <div className="max-h-64 overflow-auto rounded border bg-background">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-20">행</TableHead>
                        <TableHead>오류 메시지</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.errors.map((e, i) => (
                        <TableRow key={`${e.row}-${i}`}>
                          <TableCell className="font-mono">{e.row}</TableCell>
                          <TableCell className="text-sm">{e.message}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={loading}>
            닫기
          </Button>
          <Button onClick={handleSubmit} disabled={loading || !file}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            업로드
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
