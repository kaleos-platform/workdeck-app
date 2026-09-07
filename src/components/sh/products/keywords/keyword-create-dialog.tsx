'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { KeywordEditor } from '@/components/sh/products/listings/keyword-editor'
import {
  KEYWORD_SOURCE_LABELS,
  KEYWORD_STATUS_LABELS,
  KEYWORD_TYPE_LABELS,
} from '@/lib/sh/keyword-labels'
import type {
  KeywordMasterSource,
  KeywordMasterStatus,
  KeywordMasterType,
} from '@/generated/prisma/enums'

import { createKeywords, summarizeKeywordCreate } from './create-keywords'

const STATUS_KEYS = Object.keys(KEYWORD_STATUS_LABELS) as KeywordMasterStatus[]
const TYPE_KEYS = Object.keys(KEYWORD_TYPE_LABELS) as KeywordMasterType[]
const SOURCE_KEYS = Object.keys(KEYWORD_SOURCE_LABELS) as KeywordMasterSource[]

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 한 건이라도 처리(추가/이미 있음)됐을 때 호출 — 목록·중복 패널 갱신용 */
  onCreated: () => void
}

/**
 * 키워드 마스터 일괄 추가 (§24).
 *
 * 가이드 §14 Step 3 은 쿠팡 검색창에서 후보를 직접 조사하는 흐름이라, 사용자는
 * 자동완성 목록을 통째로 복사해 온다. 그래서 단건 입력이 아니라 붙여넣기(쉼표·개행
 * 분리)를 그대로 받아주는 KeywordEditor 를 입력부로 재사용한다.
 * 공통 속성(유형·출처·카테고리·상태)은 한 번만 고르고 전체에 같이 적용한다.
 */
export function KeywordCreateDialog({ open, onOpenChange, onCreated }: Props) {
  const [keywords, setKeywords] = useState<string[]>([])
  const [category, setCategory] = useState('')
  const [type, setType] = useState<KeywordMasterType>('UNCLASSIFIED')
  const [source, setSource] = useState<KeywordMasterSource>('COUPANG_AUTOCOMPLETE')
  const [status, setStatus] = useState<KeywordMasterStatus>('CANDIDATE')
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [failures, setFailures] = useState<Array<{ keyword: string; message: string }>>([])

  function reset() {
    setKeywords([])
    setCategory('')
    setType('UNCLASSIFIED')
    setSource('COUPANG_AUTOCOMPLETE')
    setStatus('CANDIDATE')
    setProgress(null)
    setFailures([])
  }

  function handleOpenChange(next: boolean) {
    if (saving) return // 진행 중 닫기 금지 — 절반만 반영된 채로 사라지면 결과를 알 수 없다
    if (!next) reset()
    onOpenChange(next)
  }

  async function handleSubmit() {
    const targets = keywords.map((k) => k.trim()).filter(Boolean)
    if (targets.length === 0) return

    setSaving(true)
    setFailures([])
    setProgress({ done: 0, total: targets.length })
    try {
      const result = await createKeywords(
        targets,
        {
          category: category.trim() || null,
          type,
          source,
          status,
        },
        (done, total) => setProgress({ done, total })
      )

      if (result.added + result.existed > 0) onCreated()

      if (result.failed.length === 0) {
        toast.success(summarizeKeywordCreate(result))
        reset()
        onOpenChange(false)
        return
      }

      // 실패가 남으면 다이얼로그를 닫지 않는다. 성공분은 입력에서 걷어내
      // 다시 누르면 실패분만 재시도된다.
      toast.warning(summarizeKeywordCreate(result))
      const settled = new Set(result.settled)
      setKeywords(targets.filter((k) => !settled.has(k)))
      setFailures(result.failed)
    } finally {
      setSaving(false)
      setProgress(null)
    }
  }

  const count = keywords.filter((k) => k.trim().length > 0).length

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>키워드 추가</DialogTitle>
          <DialogDescription>
            쉼표 또는 줄바꿈으로 구분된 목록을 그대로 붙여넣을 수 있습니다. 아래 속성은 입력한 모든
            키워드에 같이 적용됩니다. 한 번에 최대 30개까지 담기며, 그보다 많이 붙여넣으면 앞의
            30개만 남습니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>키워드</Label>
            {/* productName 을 넘기지 않아 상품명 기준 검증(§10)은 건너뛴다 — 마스터는
                특정 상품에 매인 목록이 아니다. */}
            <KeywordEditor
              value={keywords}
              onChange={setKeywords}
              placeholder="키워드 입력 후 Enter (붙여넣기 지원)"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="keyword-create-type">유형</Label>
              <Select value={type} onValueChange={(v) => setType(v as KeywordMasterType)}>
                <SelectTrigger id="keyword-create-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_KEYS.map((key) => (
                    <SelectItem key={key} value={key}>
                      {KEYWORD_TYPE_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="keyword-create-source">출처</Label>
              <Select value={source} onValueChange={(v) => setSource(v as KeywordMasterSource)}>
                <SelectTrigger id="keyword-create-source" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCE_KEYS.map((key) => (
                    <SelectItem key={key} value={key}>
                      {KEYWORD_SOURCE_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="keyword-create-status">상태</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as KeywordMasterStatus)}>
                <SelectTrigger id="keyword-create-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_KEYS.map((key) => (
                    <SelectItem key={key} value={key}>
                      {KEYWORD_STATUS_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="keyword-create-category">카테고리 (선택)</Label>
              <Input
                id="keyword-create-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="예: 주방용품"
                maxLength={100}
              />
            </div>
          </div>

          {failures.length > 0 && (
            <div
              role="alert"
              className="space-y-1 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <p className="font-medium">{failures.length}건을 등록하지 못했습니다</p>
              <ul className="space-y-0.5 text-xs">
                {failures.map((f) => (
                  <li key={f.keyword}>
                    {f.keyword} — {f.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={saving}
          >
            취소
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={saving || count === 0}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />}
            {saving && progress ? `등록 중 ${progress.done}/${progress.total}` : `${count}개 등록`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
