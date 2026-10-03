'use client'

import { useMemo, useRef, useState } from 'react'
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
import { fileFieldError, fileLimitText } from '@/lib/hiring/file-fields'
import { scalarFieldError } from '@/lib/hiring/form-values'
import type { HiringFieldDef } from '@/lib/validations/hiring-applicants'

type FieldValue = string | string[] | boolean
type FormValues = Record<string, FieldValue>

type Props = {
  postingUuid: string
  fields: HiringFieldDef[]
  positions: Array<{ id: string; name: string }>
  stores: Array<{ id: string; name: string }>
  preview?: boolean
}

// 파일 타입은 별도 state 로 관리(zod/RHF 직렬화 대상에서 제외)
export function ApplyForm({ postingUuid, fields, positions, stores, preview = false }: Props) {
  const valueFields = useMemo(() => fields.filter((f) => f.type !== 'file'), [fields])
  const fileFields = useMemo(() => fields.filter((f) => f.type === 'file'), [fields])

  const [files, setFiles] = useState<Record<string, File[]>>({})
  const [fileError, setFileError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<string | null>(null)
  const uploadBatch = useRef<{
    files: Array<{ fieldKey: string; file: File }>
    uploadSessionId: string
    uploadToken: string
    expiresAt: number
    uploads: Array<{ url: string }>
    completed: boolean[]
    lastAttemptedPayload?: string
  } | null>(null)
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
    if (preview) return
    setSubmitError(null)
    setFileError(null)

    // 필수 파일 검증
    for (const f of fileFields) {
      if (!uploadBatch.current?.lastAttemptedPayload && f.required && !files[f.key]?.length) {
        setFileError(`${f.label} 첨부가 필요합니다`)
        return
      }
    }

    // 제출 엔트리 조립 — 표준 PII key 는 그대로 전달(서버가 pii.ts 로 분리)
    const entries = fields.map((f) => {
      if (f.type === 'file') {
        return {
          key: f.key,
          type: f.type,
          label: f.label,
          value: files[f.key]?.map((file) => file.name) ?? [],
        }
      }
      const raw = values[f.key]
      const value = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw : null
      return { key: f.key, type: f.type, label: f.label, value }
    })

    const payload = {
      postingUuid,
      fileFieldKeys: fileFields.flatMap((f) => (files[f.key] ?? []).map(() => f.key)),
      entries,
      postingPositionId: positionId || undefined,
      storeIds: storeIds.size ? Array.from(storeIds) : undefined,
      referrer: typeof document !== 'undefined' ? document.referrer || undefined : undefined,
      privacyAgreed: true as const,
    }

    const form = new FormData()
    form.append('payload', JSON.stringify(payload))
    for (const f of fileFields) {
      for (const file of files[f.key] ?? []) form.append('files', file)
    }

    setSubmitting(true)
    try {
      const selected = fileFields.flatMap((field) =>
        (files[field.key] ?? []).map((file) => ({ fieldKey: field.key, file }))
      )
      let res: Response
      if (uploadBatch.current?.lastAttemptedPayload) {
        // 완료 응답이 유실됐을 수 있으므로 수정된 값보다 이전 요청의 결과를 먼저 확인한다.
        setUploadProgress('이전 지원서 제출 결과 확인 중')
        res = await fetch('/api/hiring-public/upload-sessions/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: uploadBatch.current.lastAttemptedPayload,
        })
        if (res.status === 400 || res.status === 422) {
          uploadBatch.current.lastAttemptedPayload = undefined
        }
        if (res.status === 410) uploadBatch.current = null
      } else if (selected.length) {
        const previous = uploadBatch.current
        if (
          !previous ||
          previous.files.length !== selected.length ||
          previous.files.some(
            (item, index) =>
              item.fieldKey !== selected[index].fieldKey || item.file !== selected[index].file
          )
        ) {
          setUploadProgress('첨부 업로드 준비 중')
          const intentResponse = await fetch('/api/hiring-public/upload-sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              postingUuid,
              files: selected.map(({ fieldKey, file }) => ({
                fieldKey,
                fileName: file.name,
                mimeType: file.type,
                sizeBytes: file.size,
              })),
            }),
          })
          const intent = await intentResponse.json().catch(() => ({}))
          if (!intentResponse.ok)
            throw new Error(intent.message ?? '첨부 업로드를 준비하지 못했습니다')
          uploadBatch.current = {
            files: selected,
            uploadSessionId: intent.uploadSessionId,
            uploadToken: intent.uploadToken,
            expiresAt: Date.parse(intent.expiresAt),
            uploads: intent.uploads,
            completed: selected.map(() => false),
          }
        }
        const batch = uploadBatch.current!
        for (const [index, item] of batch.files.entries()) {
          if (batch.completed[index] || batch.expiresAt <= Date.now()) continue
          setUploadProgress(`첨부 업로드 중 (${index + 1}/${batch.files.length})`)
          const uploaded = await fetch(batch.uploads[index].url, {
            method: 'PUT',
            headers: { 'Content-Type': item.file.type, 'x-upsert': 'false' },
            body: item.file,
          })
          // 응답 유실 뒤 같은 경로가 이미 존재하면 완료 API에서 실제 객체를 다시 검증한다.
          if (!uploaded.ok && uploaded.status !== 409) {
            const error = uploaded.status === 400 ? await uploaded.json().catch(() => ({})) : {}
            const duplicate = [error.code, error.error, error.message].some(
              (value) =>
                value === 'Duplicate' ||
                value === 'Asset Already Exists' ||
                value === 'The resource already exists'
            )
            if (!duplicate)
              throw new Error('첨부 업로드에 실패했습니다. 다시 제출하면 이어서 진행합니다')
          }
          batch.completed[index] = true
        }
        setUploadProgress('업로드 확인 및 지원서 저장 중')
        batch.lastAttemptedPayload = JSON.stringify({
          ...payload,
          uploadSessionId: batch.uploadSessionId,
          uploadToken: batch.uploadToken,
        })
        res = await fetch('/api/hiring-public/upload-sessions/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: batch.lastAttemptedPayload,
        })
        // 최초 요청이 검증 오류로 거절된 경우에만 입력을 수정해 다시 제출할 수 있다.
        if (res.status === 400 || res.status === 422) batch.lastAttemptedPayload = undefined
        if (res.status === 410) uploadBatch.current = null
      } else {
        res = await fetch('/api/hiring-public/applications', { method: 'POST', body: form })
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.message ?? '지원서 제출에 실패했습니다')
      }
      setDone(true)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '지원서 제출에 실패했습니다')
    } finally {
      setSubmitting(false)
      setUploadProgress(null)
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
                step={f.type === 'number' ? 'any' : undefined}
                inputMode={f.type === 'phone' ? 'tel' : undefined}
                placeholder={f.placeholder}
                {...register(f.key)}
              />
            )}

            {(!!f.minLength || !!f.maxLength) && (
              <p className="text-xs text-muted-foreground">
                {f.minLength ? `최소 ${f.minLength}자` : ''}
                {f.minLength && f.maxLength ? ' · ' : ''}
                {f.maxLength ? `최대 ${f.maxLength}자` : ''}
              </p>
            )}
            {f.description && (
              <p className="text-xs whitespace-pre-wrap text-muted-foreground">{f.description}</p>
            )}
            {err && <p className="text-xs text-destructive">{err}</p>}
          </div>
        )
      })}

      {/* 파일 첨부 */}
      {fileFields.map((f) => {
        const selected = files[f.key] ?? []
        return (
          <div key={f.key} className="space-y-1.5">
            <Label className="text-sm" htmlFor={`file-${f.key}`}>
              {f.label}
              {f.required && <span className="ml-0.5 text-destructive">*</span>}
            </Label>
            <p className="text-xs text-muted-foreground">{fileLimitText(f)}</p>
            {selected.map((file, index) => (
              <div
                key={index}
                className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs text-muted-foreground"
              >
                <Paperclip className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate" title={file.name}>
                  {file.name}
                </span>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() =>
                    setFiles((prev) => ({
                      ...prev,
                      [f.key]: selected.filter((_, i) => i !== index),
                    }))
                  }
                  aria-label={`${f.label} ${file.name} 첨부 제거`}
                  className="shrink-0"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
            <input
              id={`file-${f.key}`}
              type="file"
              multiple={(f.maxFileCount ?? 1) > 1}
              className="block w-full text-sm"
              disabled={selected.length >= (f.maxFileCount ?? 1) || submitting}
              onChange={(e) => {
                const next = {
                  ...files,
                  [f.key]: [...selected, ...Array.from(e.target.files ?? [])],
                }
                const all = fileFields.flatMap((field) =>
                  (next[field.key] ?? []).map((file) => ({ key: field.key, size: file.size }))
                )
                const error = fileFieldError(
                  fileFields.map((field) => ({ ...field, required: false })),
                  all.map((file) => file.key),
                  all.length,
                  all.map((file) => file.size)
                )
                setFileError(error)
                if (!error) setFiles(next)
                e.target.value = ''
              }}
            />
          </div>
        )
      })}

      {uploadProgress && (
        <p role="status" className="text-xs text-muted-foreground">
          {uploadProgress}
        </p>
      )}
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

      <Button type="submit" className="w-full" disabled={submitting || preview}>
        {submitting && <Loader2 className="mr-1 size-4 animate-spin" />}
        지원서 제출
      </Button>
      {preview && (
        <p className="text-center text-xs text-muted-foreground">
          미리보기에서는 제출할 수 없습니다
        </p>
      )}
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
    if (
      f.type === 'number' ||
      f.type === 'date' ||
      f.type === 'phone' ||
      f.type === 'email' ||
      f.minLength ||
      f.maxLength
    ) {
      shape[f.key] = z.string().superRefine((value, ctx) => {
        const error =
          f.required && !value.trim() ? '필수 항목입니다' : scalarFieldError(f.type, value, f)
        if (error) ctx.addIssue({ code: 'custom', message: error })
      })
      continue
    }
    shape[f.key] = f.required
      ? z.string().refine((value) => !!value.trim(), '필수 항목입니다')
      : z.string().optional()
  }
  shape.privacyAgreed = z.literal(true)
  return z.object(shape)
}
