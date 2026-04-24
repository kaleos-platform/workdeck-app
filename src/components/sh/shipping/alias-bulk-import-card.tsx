'use client'

import { useState } from 'react'
import { Upload } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'

/**
 * Alias CSV bulk import 카드.
 * CSV 형식 (TSV·CSV 둘 다 허용):
 *   channelId,aliasName,type,targetId
 * - type: "listing" 또는 "option"
 * - targetId: listing id 또는 option id
 * 최대 5000 행
 *
 * 다중 fulfillment(수동 입력) alias는 지원하지 않음 — ProductMatchDialog 수동 입력에서 개별 생성
 */
export function AliasBulkImportCard() {
  const [open, setOpen] = useState(false)
  const [csvText, setCsvText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{
    created: number
    updated: number
    skipped: number
    errors: { row: number; message: string }[]
  } | null>(null)

  function parseCsv(text: string) {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    const entries: { channelId: string; aliasName: string; type: string; targetId: string }[] = []
    for (const line of lines) {
      const sep = line.includes('\t') ? '\t' : ','
      const cols = line.split(sep).map((c) => c.trim())
      if (cols.length < 4) continue
      // 헤더 행 건너뛰기 (keyword 감지)
      if (cols[0].toLowerCase() === 'channelid' || cols[0] === '채널id' || cols[0] === '판매채널') {
        continue
      }
      entries.push({ channelId: cols[0], aliasName: cols[1], type: cols[2], targetId: cols[3] })
    }
    return entries
  }

  async function handleSubmit() {
    const entries = parseCsv(csvText)
    if (entries.length === 0) {
      toast.error('파싱된 행이 없습니다. 형식을 확인해 주세요.')
      return
    }
    setSubmitting(true)
    setResult(null)
    try {
      const res = await fetch('/api/sh/shipping/aliases/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? '가져오기 실패')
      setResult(data)
      if (data.errors.length === 0) {
        toast.success(`별칭 ${data.created + data.updated}건 처리 완료`)
      } else {
        toast.warning(
          `${data.created + data.updated}건 처리 · ${data.skipped}건 건너뜀 — 아래 오류 확인`
        )
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '가져오기 실패')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>별칭 일괄 가져오기</CardTitle>
          <CardDescription>
            기존 채널의 raw name ↔ 매칭 대상 데이터를 CSV로 일괄 등록합니다
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Upload className="mr-1 h-4 w-4" />
          CSV 업로드
        </Button>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">
          형식: <code className="rounded bg-muted px-1">channelId,aliasName,type,targetId</code> —
          type은 <code className="rounded bg-muted px-1">listing</code> 또는{' '}
          <code className="rounded bg-muted px-1">option</code>
        </p>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>별칭 CSV 업로드</DialogTitle>
            <DialogDescription>
              CSV 또는 TSV로 복사·붙여넣기하거나 직접 입력하세요 (최대 5000행)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Textarea
              placeholder="channelId,aliasName,type,targetId&#10;ch_xxx,머드팬티 2장세트 블랙 L,listing,listing_yyy&#10;ch_xxx,베이직 티셔츠 M,option,opt_zzz"
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              rows={10}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              · 구분자: 탭 또는 쉼표 · 첫 행이 헤더면 자동 건너뜀 · 같은 (channelId, aliasName)은
              덮어쓰기
            </p>
            {result && (
              <div className="mt-3 space-y-2 rounded-md border bg-muted/30 p-3 text-xs">
                <p>
                  신규 <strong>{result.created}</strong> · 갱신 <strong>{result.updated}</strong> ·
                  건너뜀 <strong>{result.skipped}</strong>
                </p>
                {result.errors.length > 0 && (
                  <div className="max-h-40 space-y-1 overflow-y-auto">
                    {result.errors.slice(0, 20).map((e, i) => (
                      <p key={i} className="text-destructive">
                        행 {e.row}: {e.message}
                      </p>
                    ))}
                    {result.errors.length > 20 && (
                      <p className="text-muted-foreground">...외 {result.errors.length - 20}건</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setOpen(false)
                setCsvText('')
                setResult(null)
              }}
            >
              닫기
            </Button>
            <Button onClick={handleSubmit} disabled={submitting || !csvText.trim()}>
              {submitting ? '가져오는 중...' : '가져오기'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
