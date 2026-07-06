'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  JOB_TYPE_LABELS,
  PAY_FREQUENCY_LABELS,
  WEEKDAYS,
  type WizardPositionData,
  type WizardPosition,
} from './build-types'

type Props = {
  postingId: string
  initialPositions: WizardPositionData[]
  spacePositions: WizardPosition[]
  onCountChange: (count: number) => void
}

type FormState = {
  name: string
  positionId: string
  jobType: string
  payFrequency: string
  payAmount: string
  workDays: number[]
  workStartAt: string
  workEndAt: string
  headcount: string
  jobDescription: string
  requiredQualifications: string
  preferredQualifications: string
}

const EMPTY_FORM: FormState = {
  name: '',
  positionId: '',
  jobType: '',
  payFrequency: '',
  payAmount: '',
  workDays: [],
  workStartAt: '',
  workEndAt: '',
  headcount: '',
  jobDescription: '',
  requiredQualifications: '',
  preferredQualifications: '',
}

function toForm(p: WizardPositionData): FormState {
  return {
    name: p.name,
    positionId: p.positionId ?? '',
    jobType: p.jobType ?? '',
    payFrequency: p.payFrequency ?? '',
    payAmount: p.payAmount != null ? String(p.payAmount) : '',
    workDays: p.workDays ?? [],
    workStartAt: p.workStartAt ?? '',
    workEndAt: p.workEndAt ?? '',
    headcount: p.headcount != null ? String(p.headcount) : '',
    jobDescription: p.jobDescription ?? '',
    requiredQualifications: p.requiredQualifications ?? '',
    preferredQualifications: p.preferredQualifications ?? '',
  }
}

const NONE = '__none__'

export function StepPositions({
  postingId,
  initialPositions,
  spacePositions,
  onCountChange,
}: Props) {
  const router = useRouter()
  const [positions, setPositions] = useState(initialPositions)
  const [editingId, setEditingId] = useState<string | null>(null) // null=닫힘, 'new'=신규
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  function openNew() {
    setForm(EMPTY_FORM)
    setEditingId('new')
  }
  function openEdit(p: WizardPositionData) {
    setForm(toForm(p))
    setEditingId(p.id)
  }
  function close() {
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  function toggleDay(day: number) {
    setForm((f) => ({
      ...f,
      workDays: f.workDays.includes(day)
        ? f.workDays.filter((d) => d !== day)
        : [...f.workDays, day].sort((a, b) => a - b),
    }))
  }

  function buildBody() {
    return {
      name: form.name.trim(),
      positionId: form.positionId || undefined,
      jobType: form.jobType || undefined,
      payFrequency: form.payFrequency || undefined,
      payAmount: form.payAmount || undefined,
      workDays: form.workDays,
      workStartAt: form.workStartAt || undefined,
      workEndAt: form.workEndAt || undefined,
      headcount: form.headcount || undefined,
      jobDescription: form.jobDescription || undefined,
      requiredQualifications: form.requiredQualifications || undefined,
      preferredQualifications: form.preferredQualifications || undefined,
    }
  }

  async function refresh() {
    const res = await fetch(`/api/hiring-posts/postings/${postingId}/positions`)
    if (res.ok) {
      const { positions: next } = await res.json()
      setPositions(next)
      onCountChange(next.length)
      // 스텝 이동 시 언마운트되므로 서버 props 를 최신화해 재마운트 재시딩 대비
      router.refresh()
    }
  }

  async function handleSubmit() {
    if (!form.name.trim()) {
      toast.error('직무명을 입력하세요')
      return
    }
    setSaving(true)
    try {
      const isNew = editingId === 'new'
      const url = isNew
        ? `/api/hiring-posts/postings/${postingId}/positions`
        : `/api/hiring-posts/postings/${postingId}/positions/${editingId}`
      const res = await fetch(url, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody()),
      })
      if (!res.ok) throw new Error('직무 저장에 실패했습니다')
      await refresh()
      toast.success('직무를 저장했습니다')
      close()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '직무 저장에 실패했습니다')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('이 직무를 삭제할까요?')) return
    try {
      const res = await fetch(`/api/hiring-posts/postings/${postingId}/positions/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('삭제에 실패했습니다')
      await refresh()
      toast.success('직무를 삭제했습니다')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제에 실패했습니다')
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">모집 직무와 근무 조건을 등록합니다.</p>
        {editingId === null && (
          <Button size="sm" onClick={openNew}>
            <Plus /> 직무 추가
          </Button>
        )}
      </div>

      {/* 등록된 직무 목록 */}
      <div className="space-y-2">
        {positions.length === 0 && editingId === null && (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            등록된 직무가 없습니다.
          </div>
        )}
        {positions.map((p) => (
          <div
            key={p.id}
            className="flex items-start justify-between gap-4 rounded-lg border px-4 py-3"
          >
            <div className="min-w-0 space-y-1">
              <div className="font-medium">{p.name}</div>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                {p.jobType && <span>{JOB_TYPE_LABELS[p.jobType]}</span>}
                {p.payFrequency && (
                  <span>
                    {PAY_FREQUENCY_LABELS[p.payFrequency]}
                    {p.payAmount != null && ` ${p.payAmount.toLocaleString('ko-KR')}원`}
                  </span>
                )}
                {p.headcount != null && <span>{p.headcount}명</span>}
                {p.workDays && p.workDays.length > 0 && (
                  <span>{p.workDays.map((d) => WEEKDAYS[d]).join('·')}</span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button size="icon-sm" variant="ghost" onClick={() => openEdit(p)}>
                <Pencil />
              </Button>
              <Button size="icon-sm" variant="ghost" onClick={() => handleDelete(p.id)}>
                <Trash2 />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* 추가/편집 폼 */}
      {editingId !== null && (
        <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>직무명</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="예: 홀 서빙"
              />
            </div>
            <div className="space-y-2">
              <Label>기준정보 직무 연결 (선택)</Label>
              <Select
                value={form.positionId || NONE}
                onValueChange={(v) => setForm((f) => ({ ...f, positionId: v === NONE ? '' : v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="연결 안 함" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>연결 안 함</SelectItem>
                  {spacePositions.map((sp) => (
                    <SelectItem key={sp.id} value={sp.id}>
                      {sp.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>고용 형태</Label>
              <Select
                value={form.jobType || NONE}
                onValueChange={(v) => setForm((f) => ({ ...f, jobType: v === NONE ? '' : v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>선택 안 함</SelectItem>
                  {Object.entries(JOB_TYPE_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>모집 인원</Label>
              <Input
                type="number"
                min={0}
                value={form.headcount}
                onChange={(e) => setForm((f) => ({ ...f, headcount: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>급여 형태</Label>
              <Select
                value={form.payFrequency || NONE}
                onValueChange={(v) => setForm((f) => ({ ...f, payFrequency: v === NONE ? '' : v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>선택 안 함</SelectItem>
                  {Object.entries(PAY_FREQUENCY_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>급여액 (원)</Label>
              <Input
                type="number"
                min={0}
                value={form.payAmount}
                onChange={(e) => setForm((f) => ({ ...f, payAmount: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>근무 시작</Label>
              <Input
                type="time"
                value={form.workStartAt}
                onChange={(e) => setForm((f) => ({ ...f, workStartAt: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>근무 종료</Label>
              <Input
                type="time"
                value={form.workEndAt}
                onChange={(e) => setForm((f) => ({ ...f, workEndAt: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>근무 요일</Label>
            <div className="flex gap-1">
              {WEEKDAYS.map((label, day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-md border text-xs font-medium transition',
                    form.workDays.includes(day)
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>담당 업무</Label>
            <Textarea
              value={form.jobDescription}
              onChange={(e) => setForm((f) => ({ ...f, jobDescription: e.target.value }))}
              rows={3}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>자격 요건</Label>
              <Textarea
                value={form.requiredQualifications}
                onChange={(e) => setForm((f) => ({ ...f, requiredQualifications: e.target.value }))}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label>우대 사항</Label>
              <Textarea
                value={form.preferredQualifications}
                onChange={(e) =>
                  setForm((f) => ({ ...f, preferredQualifications: e.target.value }))
                }
                rows={3}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={close} disabled={saving}>
              취소
            </Button>
            <Button size="sm" onClick={handleSubmit} disabled={saving}>
              저장
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
