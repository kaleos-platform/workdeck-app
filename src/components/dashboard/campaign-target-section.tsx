'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { getTodayStrKst } from '@/lib/date-range'

type CampaignTarget = {
  id: string
  campaignId: string
  effectiveDate: string // YYYY-MM-DD
  dailyBudget: number | null
  targetRoas: number | null
}

type SummaryData = {
  budgetUtilization: number | null
  roasAchievement: number | null
}

type Props = {
  campaignId: string
  from: string
  to: string
  /** "budget": 일 예산/목표 ROAS compact 카드만 | "metrics": 광고 관리 현황 카드만 */
  mode?: 'budget' | 'metrics'
}

export function CampaignTargetSection({ campaignId, from, to, mode }: Props) {
  const today = getTodayStrKst()

  const [targets, setTargets] = useState<CampaignTarget[]>([])
  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  // 설정 Dialog
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<CampaignTarget | null>(null)
  const [formDate, setFormDate] = useState(today)
  const [formBudget, setFormBudget] = useState('')
  const [formRoas, setFormRoas] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  // 메모 팝업 (F032)
  const [memoDialogOpen, setMemoDialogOpen] = useState(false)
  const [memoDate, setMemoDate] = useState(today)
  const [memoContent, setMemoContent] = useState('')
  const [isSavingMemo, setIsSavingMemo] = useState(false)
  const [savedChangeSummary, setSavedChangeSummary] = useState('')

  // 현재 유효한 설정 (가장 최근 effectiveDate ≤ today)
  const currentTarget = targets.find((t) => t.effectiveDate <= today) ?? null

  const fetchTargets = useCallback(async () => {
    const res = await fetch(`/api/campaigns/${campaignId}/targets`)
    if (res.ok) setTargets((await res.json()) as CampaignTarget[])
  }, [campaignId])

  const fetchSummary = useCallback(async () => {
    if (!from || !to) return
    setIsLoading(true)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/targets/summary?from=${from}&to=${to}`)
      if (res.ok) setSummary((await res.json()) as SummaryData)
    } finally {
      setIsLoading(false)
    }
  }, [campaignId, from, to])

  useEffect(() => {
    fetchTargets()
  }, [fetchTargets])

  useEffect(() => {
    // budget 모드에서는 summary 불필요 (기간 독립)
    if (mode === 'budget') return
    fetchSummary()
  }, [fetchSummary, mode])

  function openNewDialog() {
    setEditTarget(null)
    setFormDate(today)
    setFormBudget(
      currentTarget?.dailyBudget !== null && currentTarget?.dailyBudget !== undefined
        ? String(currentTarget.dailyBudget)
        : ''
    )
    setFormRoas(
      currentTarget?.targetRoas !== null && currentTarget?.targetRoas !== undefined
        ? String(currentTarget.targetRoas)
        : ''
    )
    setDialogOpen(true)
  }

  function openEditDialog(t: CampaignTarget) {
    setEditTarget(t)
    setFormDate(t.effectiveDate)
    setFormBudget(t.dailyBudget !== null ? String(t.dailyBudget) : '')
    setFormRoas(t.targetRoas !== null ? String(t.targetRoas) : '')
    setDialogOpen(true)
  }

  async function handleSave() {
    // 빈 값이면 이전 값 유지:
    //   수정 모드(editTarget): editTarget의 기존 값
    //   새 설정 추가: currentTarget의 값 (없으면 null)
    const prevBudget = editTarget ? editTarget.dailyBudget : (currentTarget?.dailyBudget ?? null)
    const prevRoas = editTarget ? editTarget.targetRoas : (currentTarget?.targetRoas ?? null)
    const dailyBudget = formBudget.trim() !== '' ? Number(formBudget) : prevBudget
    const targetRoas = formRoas.trim() !== '' ? Number(formRoas) : prevRoas

    if (!formDate) {
      toast.error('적용 시작일을 입력해주세요.')
      return
    }
    if (dailyBudget !== null && (isNaN(dailyBudget) || dailyBudget < 0)) {
      toast.error('올바른 일 예산을 입력해주세요.')
      return
    }
    if (targetRoas !== null && (isNaN(targetRoas) || targetRoas < 0)) {
      toast.error('올바른 목표 ROAS를 입력해주세요.')
      return
    }

    setIsSaving(true)
    try {
      const lines: string[] = []
      if (editTarget) {
        if (editTarget.dailyBudget !== dailyBudget) {
          const prev =
            editTarget.dailyBudget !== null
              ? `${editTarget.dailyBudget.toLocaleString('ko-KR')}원`
              : '미설정'
          const next = dailyBudget !== null ? `${dailyBudget.toLocaleString('ko-KR')}원` : '미설정'
          lines.push(`일 예산 변경: ${prev} → ${next}`)
        }
        if (editTarget.targetRoas !== targetRoas) {
          const prev = editTarget.targetRoas !== null ? `${editTarget.targetRoas}%` : '미설정'
          const next = targetRoas !== null ? `${targetRoas}%` : '미설정'
          lines.push(`목표 ROAS 변경: ${prev} → ${next}`)
        }
      } else {
        if (dailyBudget !== null)
          lines.push(`일 예산 설정: ${dailyBudget.toLocaleString('ko-KR')}원`)
        if (targetRoas !== null) lines.push(`목표 ROAS 설정: ${targetRoas}%`)
      }

      let res: Response
      if (editTarget) {
        res = await fetch(`/api/campaigns/${campaignId}/targets/${editTarget.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ effectiveDate: formDate, dailyBudget, targetRoas }),
        })
      } else {
        res = await fetch(`/api/campaigns/${campaignId}/targets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ effectiveDate: formDate, dailyBudget, targetRoas }),
        })
      }

      if (!res.ok) {
        const err = await res.json()
        toast.error(err.error ?? '저장에 실패했습니다.')
        return
      }

      await fetchTargets()
      if (mode !== 'budget') await fetchSummary()
      setDialogOpen(false)
      toast.success('설정이 저장되었습니다.')

      if (lines.length > 0) {
        setSavedChangeSummary(lines.join('\n'))
        setMemoDate(today)
        setMemoContent(lines.join('\n'))
        setMemoDialogOpen(true)
      }
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete(targetId: string) {
    const res = await fetch(`/api/campaigns/${campaignId}/targets/${targetId}`, {
      method: 'DELETE',
    })
    if (res.ok) {
      await fetchTargets()
      if (mode !== 'budget') await fetchSummary()
      toast.success('삭제되었습니다.')
    } else {
      toast.error('삭제에 실패했습니다.')
    }
  }

  async function handleSaveMemo() {
    if (!memoContent.trim()) {
      setMemoDialogOpen(false)
      return
    }
    setIsSavingMemo(true)
    try {
      const getRes = await fetch(
        `/api/campaigns/${campaignId}/memos?from=${memoDate}&to=${memoDate}`
      )
      let existingContent = ''
      if (getRes.ok) {
        const data = await getRes.json()
        if (data.items?.length > 0) existingContent = data.items[0].content
      }

      const finalContent = existingContent
        ? `${existingContent}\n${memoContent.trim()}`
        : memoContent.trim()

      const res = await fetch(`/api/campaigns/${campaignId}/memos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: memoDate, content: finalContent }),
      })

      if (res.ok) toast.success('메모가 저장되었습니다.')
      else toast.error('메모 저장에 실패했습니다.')
    } finally {
      setIsSavingMemo(false)
      setMemoDialogOpen(false)
    }
  }

  const pct = (v: number | null) => (v !== null ? `${v.toFixed(2)}%` : null)
  const formatBudget = (value: number | null) =>
    value !== null ? `${value.toLocaleString('ko-KR')}원` : '-'
  const formatRoas = (value: number | null) => (value !== null ? `${value}%` : '-')

  const showBudgetCard = mode !== 'metrics'
  const showMetricsCard = mode !== 'budget'

  return (
    <>
      {/* ── 일 예산 / 목표 ROAS 카드 ── */}
      {showBudgetCard && (
        <Card className="py-0">
          <CardContent className="p-4">
            {/* 행 1: 제목 + 추가 버튼 */}
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-muted-foreground">
                일 예산 / 목표 ROAS 설정
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 shrink-0 gap-1 text-xs"
                onClick={openNewDialog}
              >
                <Plus className="h-3.5 w-3.5" />
                예산/목표 ROAS 추가
              </Button>
            </div>

            {/* 행 2: 적용 시작일 + 이력보기 버튼 */}
            <div className="mt-1 flex items-center justify-between gap-3">
              {currentTarget !== null ? (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  적용 시작일: {currentTarget.effectiveDate}
                  <button
                    className="text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => openEditDialog(currentTarget)}
                    aria-label="설정 수정"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                </p>
              ) : (
                <span />
              )}
              {targets.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setHistoryDialogOpen(true)}
                >
                  변경 이력 {targets.length}건 보기
                </Button>
              )}
            </div>

            {/* 값 표시 영역 */}
            {currentTarget !== null ? (
              <div className="mt-3 grid grid-cols-2 gap-3">
                {/* 일 예산 */}
                <div className="rounded-lg border bg-muted/30 px-4 py-3">
                  <p className="text-xs text-muted-foreground">일 예산</p>
                  <p className="mt-1 text-2xl font-bold tracking-tight">
                    {formatBudget(currentTarget.dailyBudget)}
                  </p>
                </div>

                {/* 목표 ROAS */}
                <div className="rounded-lg border bg-muted/30 px-4 py-3">
                  <p className="text-xs text-muted-foreground">목표 ROAS</p>
                  <p className="mt-1 text-2xl font-bold tracking-tight">
                    {formatRoas(currentTarget.targetRoas)}
                  </p>
                </div>
              </div>
            ) : (
              <div className="mt-3 rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground">
                아직 설정된 예산/목표 ROAS가 없습니다.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── 광고 관리 현황 카드 (기간 종속) ── */}
      {showMetricsCard && (
        <Card className="gap-2">
          <CardHeader className="pb-3">
            <div>
              <CardTitle className="text-base">광고 관리 현황</CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">
                일 예산 소진율 및 목표 ROAS 달성율 (선택 기간 기준)
              </p>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs font-medium text-muted-foreground">일 예산 평균 소진율</p>
                {isLoading ? (
                  <p className="mt-1 text-sm text-muted-foreground">계산 중...</p>
                ) : pct(summary?.budgetUtilization ?? null) !== null ? (
                  <p className="mt-1 text-xl font-bold">{pct(summary!.budgetUtilization)}</p>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">
                    해당 기간에 설정된 일 예산이 없습니다.
                  </p>
                )}
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs font-medium text-muted-foreground">목표 ROAS 평균 달성율</p>
                {isLoading ? (
                  <p className="mt-1 text-sm text-muted-foreground">계산 중...</p>
                ) : pct(summary?.roasAchievement ?? null) !== null ? (
                  <p className="mt-1 text-xl font-bold">{pct(summary!.roasAchievement)}</p>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">
                    해당 기간에 설정된 목표 ROAS가 없습니다.
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── 이력 Dialog ── */}
      <Dialog open={historyDialogOpen} onOpenChange={setHistoryDialogOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>일 예산 / 목표 ROAS 변경 이력</DialogTitle>
            <DialogDescription>
              적용 시작일 기준으로 저장된 설정 이력을 확인하고 수정/삭제할 수 있습니다.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>적용 시작일</TableHead>
                  <TableHead>일 예산</TableHead>
                  <TableHead>목표 ROAS</TableHead>
                  <TableHead className="text-right">수정/삭제</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {targets.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      변경 이력이 없습니다.
                    </TableCell>
                  </TableRow>
                ) : (
                  targets.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>{t.effectiveDate}</TableCell>
                      <TableCell>{formatBudget(t.dailyBudget)}</TableCell>
                      <TableCell>{formatRoas(t.targetRoas)}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => {
                              setHistoryDialogOpen(false)
                              openEditDialog(t)
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => handleDelete(t.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryDialogOpen(false)}>
              닫기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 설정 입력 Dialog (F030) ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editTarget ? '설정 수정' : '일 예산 / 목표 ROAS 설정'}</DialogTitle>
            <DialogDescription>
              적용 시작일부터 다음 설정일 전까지 이 값이 사용됩니다.
              {(editTarget !== null || currentTarget !== null) && ' 비워두면 이전 값을 유지합니다.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="effectiveDate">적용 시작일</Label>
              <Input
                id="effectiveDate"
                type="date"
                value={formDate}
                max={today}
                onChange={(e) => setFormDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dailyBudget">일 예산 (원)</Label>
              <Input
                id="dailyBudget"
                type="number"
                min={0}
                placeholder="비워두면 이전 값 유지"
                value={formBudget}
                onChange={(e) => setFormBudget(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="targetRoas">목표 ROAS (%)</Label>
              <Input
                id="targetRoas"
                type="number"
                min={0}
                step={0.1}
                placeholder="비워두면 이전 값 유지"
                value={formRoas}
                onChange={(e) => setFormRoas(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isSaving}>
              취소
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? '저장 중...' : '저장'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 메모 저장 팝업 (F032) ── */}
      <Dialog open={memoDialogOpen} onOpenChange={setMemoDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>변경 내용을 메모로 남기시겠습니까?</DialogTitle>
            <DialogDescription>
              선택한 날짜의 메모에 변경 내용을 추가합니다. 기존 메모가 있으면 내용이 추가됩니다.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="memoDate">메모 날짜</Label>
              <Input
                id="memoDate"
                type="date"
                value={memoDate}
                max={today}
                onChange={(e) => setMemoDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="memoContent">메모 내용</Label>
              <textarea
                id="memoContent"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                rows={3}
                value={memoContent}
                onChange={(e) => setMemoContent(e.target.value)}
              />
            </div>
            {savedChangeSummary && (
              <p className="text-xs text-muted-foreground">
                자동 생성된 내용 — 직접 수정할 수 있습니다.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMemoDialogOpen(false)}
              disabled={isSavingMemo}
            >
              건너뛰기
            </Button>
            <Button onClick={handleSaveMemo} disabled={isSavingMemo}>
              {isSavingMemo ? '저장 중...' : '메모 저장'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
