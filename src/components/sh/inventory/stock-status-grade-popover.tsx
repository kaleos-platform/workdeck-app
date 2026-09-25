'use client'

import { useState } from 'react'
import { InfoIcon, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  DEFAULT_STOCK_GRADE_SETTINGS,
  type StockAvgWindow,
  type StockGradeSettings,
} from '@/lib/sh/stock-grade-settings'
import { STOCK_GRADE_LABEL } from './stock-status-view-model'

type Props = {
  settings: StockGradeSettings
  onSaved: () => void
}

// '30' 은 폴백 동작이 auto 와 같아 선택지에서 뺐다(고르면 아무 변화가 없어 오해를 준다).
// 과거에 저장된 30 값은 readStockGradeSettings 가 그대로 읽고 auto 와 동일하게 동작한다.
const AVG_WINDOW_LABEL: Record<string, string> = {
  auto: '30일 우선 (없으면 90일)',
  '90': '90일 기준',
}

/** 등급 기준 안내 + 편집. 값이 바뀌면 화면 등급이 즉시 다시 계산된다. */
export function StockStatusGradePopover({ settings, onSaved }: Props) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<StockGradeSettings>(settings)
  const [saving, setSaving] = useState(false)

  // 팝오버를 열 때마다 서버 값으로 초기화 — 저장 안 하고 닫은 편집이 남지 않게.
  function handleOpenChange(next: boolean) {
    if (next) setDraft(settings)
    setOpen(next)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch('/api/sh/inventory/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gradeSettings: draft }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? '저장에 실패했습니다')
      toast.success('등급 기준을 저장했습니다')
      setOpen(false)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장에 실패했습니다')
    } finally {
      setSaving(false)
    }
  }

  const leadLabel = `리드타임 ${draft.defaultLeadTimeDays}일 기준`

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <InfoIcon className="h-3.5 w-3.5" />
          등급 기준
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 space-y-4" side="bottom" align="end">
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">등급이 정해지는 방식</p>
          <p className="text-sm leading-relaxed">
            커버 일수 = 재고 ÷ 일평균 출고. 이 일수를 상품별 리드타임과 비교해 등급을 매깁니다.
          </p>
          <ul className="space-y-1 text-xs">
            <GradeLine grade="NO_STOCK" desc="출고는 있는데 재고가 0 이하" />
            <GradeLine
              grade="RISK"
              desc={`커버 일수 < 리드타임 × ${draft.riskMultiplier} (지금 발주해도 늦음)`}
            />
            <GradeLine grade="REORDER" desc={`커버 일수 < 리드타임 × ${draft.reorderMultiplier}`} />
            <GradeLine grade="HEALTHY" desc="그 이상" />
            <GradeLine grade="NO_OUTBOUND" desc="판매채널 출고 이력이 없음 (부자재·미입고)" />
          </ul>
        </div>

        <div className="space-y-3 border-t pt-3">
          <p className="text-xs font-semibold text-muted-foreground">기준 조정</p>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="grade-risk" className="text-xs">
                위험 배수
              </Label>
              <Input
                id="grade-risk"
                type="number"
                step="0.1"
                min="0.1"
                className="h-8"
                value={draft.riskMultiplier}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, riskMultiplier: Number(e.target.value) }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="grade-reorder" className="text-xs">
                발주시기 배수
              </Label>
              <Input
                id="grade-reorder"
                type="number"
                step="0.1"
                min="0.1"
                className="h-8"
                value={draft.reorderMultiplier}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, reorderMultiplier: Number(e.target.value) }))
                }
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="grade-lead" className="text-xs">
              기본 리드타임 (일)
            </Label>
            <Input
              id="grade-lead"
              type="number"
              min="0"
              className="h-8"
              value={draft.defaultLeadTimeDays}
              onChange={(e) =>
                setDraft((d) => ({ ...d, defaultLeadTimeDays: Number(e.target.value) }))
              }
            />
            <p className="text-[11px] text-muted-foreground">
              발주 설정이 아예 없는 상품에만 적용됩니다. 발주 계획에서 리드타임을 한 번이라도 저장한
              상품은 그 값을 씁니다.
            </p>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">일평균 기준 기간</Label>
            <Select
              value={draft.avgWindow === 90 ? '90' : 'auto'}
              onValueChange={(v) =>
                setDraft((d) => ({
                  ...d,
                  avgWindow: (v === 'auto' ? 'auto' : Number(v)) as StockAvgWindow,
                }))
              }
            >
              <SelectTrigger className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(AVG_WINDOW_LABEL).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              고른 기간에 출고가 없으면 더 긴 기간으로 대체합니다. 비수기 상품이 갑자기
              &lsquo;출고없음&rsquo;으로 빠지지 않게 하기 위함입니다.
            </p>
          </div>

          <div className="flex items-start justify-between gap-3">
            <div className="space-y-0.5">
              <Label htmlFor="grade-safety" className="text-xs">
                안전재고 반영
              </Label>
              <p className="text-[11px] text-muted-foreground">
                커버 일수를 (재고 − 안전재고) 기준으로 계산합니다.
              </p>
            </div>
            <Switch
              id="grade-safety"
              checked={draft.applySafetyStock}
              onCheckedChange={(v) => setDraft((d) => ({ ...d, applySafetyStock: v }))}
            />
          </div>

          <p className="rounded-md bg-muted/50 px-2.5 py-2 text-[11px] text-muted-foreground">
            {leadLabel} · 이 설정은 재고 현황 화면에만 적용되며 발주 계획 계산에는 반영되지
            않습니다.
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 border-t pt-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDraft(DEFAULT_STOCK_GRADE_SETTINGS)}
            disabled={saving}
          >
            기본값
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={saving}>
              취소
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              저장
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function GradeLine({ grade, desc }: { grade: keyof typeof STOCK_GRADE_LABEL; desc: string }) {
  return (
    <li className="flex items-baseline gap-2">
      <span className="w-14 shrink-0 font-medium">{STOCK_GRADE_LABEL[grade]}</span>
      <span className="text-muted-foreground">{desc}</span>
    </li>
  )
}
