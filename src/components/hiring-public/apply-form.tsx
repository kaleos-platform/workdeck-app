'use client'

import { useMemo, useState } from 'react'
import { useForm, Controller, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, CheckCircle2, Paperclip, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { HiringFieldDef } from '@/lib/validations/hiring-applicants'

type FieldValue = string | string[] | boolean
type FormValues = Record<string, FieldValue>

type Props = {
  postingUuid: string
  fields: HiringFieldDef[]
  positions: Array<{ id: string; name: string }>
  stores: Array<{ id: string; name: string }>
}

// 파일 타입은 별도 state 로 관리(zod/RHF 직렬화 대상에서 제외)
export function ApplyForm({ postingUuid, fields, positions, stores }: Props) {
  const valueFields = useMemo(() => fields.filter((f) => f.type !== 'file'), [fields])
  const fileFields = useMemo(() => fields.filter((f) => f.type === 'file'), [fields])

  const [files, setFiles] = useState<Record<string, File | null>>({})
  const [fileError, setFileError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [positionId, setPositionId] = useState<string>('')
  const [storeIds, setStoreIds] = useState<Set<string>>(new Set())

  const schema = useMemo(() => buildSchema(valueFields), [valueFields])

  const defaultValues = useMemo<FormValues>(() => {
    const dv: FormValues = { privacyAgreed: false }
    for (const f of valueFields) dv[f.key] = f.type === 'multiselect' ? [] : ''
    return dv
  }, [valueFields])

  const {
    control,
    handleSubmit,
    register,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema) as unknown as Resolver<FormValues>,
    defaultValues,
  })

  async function onSubmit(values: FormValues) {
    setSubmitError(null)
    setFileError(null)

    // 필수 파일 검증
    for (const f of fileFields) {
      if (f.required && !files[f.key]) {
        setFileError(`${f.label} 첨부가 필요합니다`)
        return
      }
    }

    // 제출 엔트리 조립 — 표준 PII key 는 그대로 전달(서버가 pii.ts 로 분리)
    const entries = fields.map((f) => {
      if (f.type === 'file') {
        return { key: f.key, type: f.type, label: f.label, value: files[f.key]?.name ?? null }
      }
      const raw = values[f.key]
      const value = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw : null
      return { key: f.key, type: f.type, label: f.label, value }
    })

    const payload = {
      postingUuid,
      entries,
      postingPositionId: positionId || undefined,
      storeIds: storeIds.size ? Array.from(storeIds) : undefined,
      referrer: typeof document !== 'undefined' ? document.referrer || undefined : undefined,
      privacyAgreed: true as const,
    }

    const form = new FormData()
    form.append('payload', JSON.stringify(payload))
    for (const f of fileFields) {
      const file = files[f.key]
      if (file) form.append('files', file)
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/hiring-public/applications', { method: 'POST', body: form })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.message ?? '지원서 제출에 실패했습니다')
      }
      setDone(true)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '지원서 제출에 실패했습니다')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="space-y-4 rounded-lg border bg-card p-8 text-center shadow-sm">
        <CheckCircle2 className="mx-auto size-12 text-emerald-600 dark:text-emerald-400" />
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">지원이 완료되었습니다</h2>
          <p className="text-sm text-muted-foreground">
            소중한 지원 감사합니다. 검토 후 담당자가 개별적으로 연락드립니다.
            <br />
            전형 결과는 담당자가 보내드리는 안내 링크로 확인하실 수 있습니다.
          </p>
        </div>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-5 rounded-lg border bg-card p-6 shadow-sm"
    >
      {/* 지원 부문 선택(공고에 부문이 여러 개일 때) */}
      {positions.length > 1 && (
        <div className="space-y-1.5">
          <Label className="text-sm">지원 부문</Label>
          <Select value={positionId} onValueChange={setPositionId}>
            <SelectTrigger>
              <SelectValue placeholder="지원할 부문을 선택하세요" />
            </SelectTrigger>
            <SelectContent>
              {positions.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* 희망 매장(복수 선택) */}
      {stores.length > 1 && (
        <div className="space-y-1.5">
          <Label className="text-sm">희망 근무 매장</Label>
          <div className="flex flex-wrap gap-3">
            {stores.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={storeIds.has(s.id)}
                  onCheckedChange={(v) =>
                    setStoreIds((prev) => {
                      const next = new Set(prev)
                      if (v === true) next.add(s.id)
                      else next.delete(s.id)
                      return next
                    })
                  }
                />
                {s.name}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* 동적 값 필드 */}
      {valueFields.map((f) => {
        const err = errors[f.key]?.message as string | undefined
        return (
          <div key={f.key} className="space-y-1.5">
            <Label htmlFor={`field-${f.key}`} className="text-sm">
              {f.label}
              {f.required && <span className="ml-0.5 text-destructive">*</span>}
            </Label>

            {f.type === 'text' ? (
              <Textarea
                id={`field-${f.key}`}
                placeholder={f.placeholder}
                rows={4}
                {...register(f.key)}
              />
            ) : f.type === 'select' ? (
              <Controller
                control={control}
                name={f.key}
                render={({ field }) => (
                  <Select
                    value={typeof field.value === 'string' ? field.value : ''}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger id={`field-${f.key}`}>
                      <SelectValue placeholder="선택하세요" />
                    </SelectTrigger>
                    <SelectContent>
                      {(f.options ?? []).map((opt) => (
                        <SelectItem key={opt} value={opt}>
                          {opt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            ) : f.type === 'multiselect' ? (
              <Controller
                control={control}
                name={f.key}
                render={({ field }) => {
                  const selected = Array.isArray(field.value) ? field.value : []
                  return (
                    <div className="flex flex-wrap gap-3">
                      {(f.options ?? []).map((opt) => (
                        <label key={opt} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={selected.includes(opt)}
                            onCheckedChange={(v) => {
                              const next =
                                v === true ? [...selected, opt] : selected.filter((o) => o !== opt)
                              field.onChange(next)
                            }}
                          />
                          {opt}
                        </label>
                      ))}
                    </div>
                  )
                }}
              />
            ) : (
              <Input
                id={`field-${f.key}`}
                type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                inputMode={f.type === 'phone' ? 'tel' : undefined}
                placeholder={f.placeholder}
                {...register(f.key)}
              />
            )}

            {err && <p className="text-xs text-destructive">{err}</p>}
          </div>
        )
      })}

      {/* 파일 첨부 */}
      {fileFields.map((f) => {
        const selected = files[f.key]
        return (
          <div key={f.key} className="space-y-1.5">
            <Label className="text-sm">
              {f.label}
              {f.required && <span className="ml-0.5 text-destructive">*</span>}
            </Label>
            {selected ? (
              <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs text-muted-foreground">
                <Paperclip className="size-3.5 shrink-0" />
                <span className="flex-1 truncate">{selected.name}</span>
                <button
                  type="button"
                  onClick={() => setFiles((prev) => ({ ...prev, [f.key]: null }))}
                  aria-label="첨부 제거"
                  className="shrink-0"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ) : (
              <label className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed text-sm text-muted-foreground hover:bg-accent">
                <Paperclip className="size-4" />
                파일 선택
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) =>
                    setFiles((prev) => ({ ...prev, [f.key]: e.target.files?.[0] ?? null }))
                  }
                />
              </label>
            )}
          </div>
        )
      })}

      {fileError && <p className="text-xs text-destructive">{fileError}</p>}

      {/* 개인정보 수집·이용 동의 */}
      <Controller
        control={control}
        name="privacyAgreed"
        render={({ field }) => (
          <div className="space-y-1.5">
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={field.value === true}
                onCheckedChange={(v) => field.onChange(v === true)}
              />
              <span>
                개인정보 수집·이용에 동의합니다.
                <span className="ml-0.5 text-destructive">*</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  수집 항목(이름·연락처 등)은 채용 전형 목적에 한해 사용되며, 관련 법령에 따라
                  보관·파기됩니다.
                </span>
              </span>
            </label>
            {errors.privacyAgreed && (
              <p className="text-xs text-destructive">개인정보 수집·이용 동의가 필요합니다</p>
            )}
          </div>
        )}
      />

      {submitError && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {submitError}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting && <Loader2 className="mr-1 size-4 animate-spin" />}
        지원서 제출
      </Button>
    </form>
  )
}

// 값 필드로 동적 zod 스키마 구성(파일 제외)
function buildSchema(valueFields: HiringFieldDef[]) {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const f of valueFields) {
    if (f.type === 'multiselect') {
      shape[f.key] = f.required
        ? z.array(z.string()).min(1, '최소 1개를 선택하세요')
        : z.array(z.string())
      continue
    }
    let s = z.string()
    if (f.type === 'email' && f.required) s = z.string().email('이메일 형식이 올바르지 않습니다')
    if (f.required) {
      shape[f.key] = f.type === 'email' ? s : z.string().min(1, '필수 항목입니다')
    } else {
      shape[f.key] = z.string().optional()
    }
  }
  shape.privacyAgreed = z.literal(true)
  return z.object(shape)
}
