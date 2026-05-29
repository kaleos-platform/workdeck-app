'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { MessageSquareIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import type { ReorderPlanItem } from './reorder-plan-types'

// 시즌 계수 선택지 — 서버 AnswerSchema의 seasonFactor(0.1~5)와 정합
const SEASON_FACTOR_OPTIONS = [
  { value: '0.5', label: '비수기 (×0.5)' },
  { value: '1', label: '평상시 (×1.0)' },
  { value: '1.5', label: '성수기 (×1.5)' },
  { value: '2', label: '강한 성수기 (×2.0)' },
]

type ColdStartItem = Pick<ReorderPlanItem, 'optionId' | 'inputsSnapshot'> & {
  productName: string
  optionName: string
}

type Props = {
  planId: string
  coldStartItems: ColdStartItem[]
  onCompleted: () => void
}

export function ColdStartInterviewDialog({ planId, coldStartItems, onCompleted }: Props) {
  const [open, setOpen] = useState(false)
  // 옵션별 답변: 목표 일판매량(문자열 입력) + 시즌 계수
  const [targetSales, setTargetSales] = useState<Record<string, string>>({})
  const [seasonFactor, setSeasonFactor] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({})

  if (coldStartItems.length === 0) return null

  const handleSubmit = async (optionId: string) => {
    const target = Number(targetSales[optionId])
    if (!Number.isFinite(target) || target < 0) {
      toast.error('목표 일판매량을 0 이상의 숫자로 입력하세요')
      return
    }
    const factor = Number(seasonFactor[optionId] ?? '1')

    setSubmitting((s) => ({ ...s, [optionId]: true }))
    try {
      const res = await fetch(`/api/sh/inventory/reorder/plan/${planId}/cold-start-interview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // 서버 AnswerSchema: answers = [{ optionId, targetDailySales, seasonFactor? }]
        body: JSON.stringify({
          answers: [{ optionId, targetDailySales: target, seasonFactor: factor }],
        }),
      })
      if (!res.ok) throw new Error('저장 실패')
      toast.success('콜드스타트 정보를 저장했습니다')
      onCompleted()
    } catch (err) {
      console.error(err)
      toast.error('콜드스타트 인터뷰 저장에 실패했습니다')
    } finally {
      setSubmitting((s) => ({ ...s, [optionId]: false }))
    }
  }

  const handleClose = () => {
    setOpen(false)
    onCompleted()
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="border-amber-300 text-amber-700 hover:bg-amber-50"
        onClick={() => setOpen(true)}
      >
        <MessageSquareIcon className="mr-1.5 h-3.5 w-3.5" />
        콜드스타트 인터뷰 ({coldStartItems.length}개 옵션)
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquareIcon className="h-4 w-4 text-amber-500" />
              콜드스타트 인터뷰
            </DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            데이터가 부족한 옵션은 과거 이력 없이 예측합니다. 아래 질문에 답하면 초기 예측 정확도를
            높일 수 있습니다.
          </p>

          <div className="max-h-[55vh] space-y-6 overflow-y-auto pr-1">
            {coldStartItems.map((item) => (
              <div key={item.optionId} className="space-y-3 rounded-md border px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{item.productName}</p>
                    <p className="text-xs text-muted-foreground">{item.optionName}</p>
                  </div>
                  <Badge
                    variant="outline"
                    className="shrink-0 border-amber-300 bg-amber-50 text-amber-700"
                  >
                    데이터 부족
                  </Badge>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">
                    목표 일판매량 (개/일)
                  </label>
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    placeholder="예: 10"
                    className="text-sm"
                    value={targetSales[item.optionId] ?? ''}
                    onChange={(e) =>
                      setTargetSales((prev) => ({ ...prev, [item.optionId]: e.target.value }))
                    }
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">시즌 계수</label>
                  <Select
                    value={seasonFactor[item.optionId] ?? '1'}
                    onValueChange={(v) =>
                      setSeasonFactor((prev) => ({ ...prev, [item.optionId]: v }))
                    }
                  >
                    <SelectTrigger className="text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SEASON_FACTOR_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto block"
                  disabled={submitting[item.optionId]}
                  onClick={() => handleSubmit(item.optionId)}
                >
                  {submitting[item.optionId] ? '저장 중...' : '이 옵션 저장'}
                </Button>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>
              닫기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
