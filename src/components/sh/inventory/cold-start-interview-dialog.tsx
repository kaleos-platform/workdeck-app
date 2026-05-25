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
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import type { ReorderPlanItem } from './reorder-plan-types'

// TODO: 번스타인 응답 형식 확인 — 질문 목록 구조
type InterviewQuestion = {
  key: string
  label: string
  placeholder?: string
}

// COLD_START 옵션에 대해 LLM이 생성한 기본 질문 목록
const DEFAULT_QUESTIONS: InterviewQuestion[] = [
  {
    key: 'targetDailySales',
    label: '목표 일판매량을 어느 정도로 예상하시나요? (예: 10개/일)',
    placeholder: '예: 런칭 초기 5개, 3개월 후 15개 목표',
  },
  {
    key: 'plannedPromotion',
    label: '예정된 행사나 프로모션이 있나요?',
    placeholder: '예: 다음 달 쿠팡 행사 참여, 6월 시즌세일 계획',
  },
  {
    key: 'seasonality',
    label: '계절성 또는 주기적인 수요 패턴이 있나요?',
    placeholder: '예: 여름 성수기, 명절 전후 수요 증가',
  },
  {
    key: 'similarProduct',
    label: '유사 상품이나 이전 SKU가 있다면 참고 수량을 알려주세요',
    placeholder: '예: 구 모델 월 300개 판매, 유사 경쟁사 주간 100개 수준',
  },
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
  // 옵션별 × 질문별 답변
  const [answers, setAnswers] = useState<Record<string, Record<string, string>>>({})
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({})

  if (coldStartItems.length === 0) return null

  const handleAnswer = (optionId: string, key: string, value: string) => {
    setAnswers((prev) => ({
      ...prev,
      [optionId]: { ...(prev[optionId] ?? {}), [key]: value },
    }))
  }

  const handleSubmit = async (optionId: string) => {
    setSubmitting((s) => ({ ...s, [optionId]: true }))
    try {
      const res = await fetch(`/api/sh/inventory/reorder/plan/${planId}/cold-start-interview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optionId, answers: answers[optionId] ?? {} }),
      })
      if (!res.ok) throw new Error('저장 실패')
      toast.success('콜드스타트 정보를 저장했습니다')
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
            {coldStartItems.map((item) => {
              // 번스타인 API가 inputsSnapshot.questions 를 채우면 LLM 생성 질문 사용,
              // 그 전까지는 기본 질문 목록으로 폴백
              const questions =
                (item.inputsSnapshot?.questions as InterviewQuestion[] | undefined) ??
                DEFAULT_QUESTIONS
              return (
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

                  {questions.map((q) => (
                    <div key={q.key} className="space-y-1">
                      <label className="text-xs font-medium text-foreground">{q.label}</label>
                      <Textarea
                        rows={2}
                        placeholder={q.placeholder}
                        className="resize-none text-sm"
                        value={answers[item.optionId]?.[q.key] ?? ''}
                        onChange={(e) => handleAnswer(item.optionId, q.key, e.target.value)}
                      />
                    </div>
                  ))}

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
              )
            })}
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
