'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { CheckCircle2, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  EMPLOYEE_COUNT_OPTIONS,
  marketingLeadSchema,
  type MarketingLeadInput,
} from '@/lib/validations/marketing-lead'

function collectUtm() {
  const utm: Record<string, string> = {}
  new URLSearchParams(window.location.search).forEach((value, key) => {
    if (key.startsWith('utm_')) utm[key] = value.slice(0, 300)
  })
  return Object.keys(utm).length ? utm : undefined
}

export function LeadForm({ deck }: { deck: string }) {
  const [done, setDone] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<MarketingLeadInput>({
    resolver: zodResolver(marketingLeadSchema) as never,
    defaultValues: {
      name: '',
      phone: '',
      email: '',
      companyName: '',
      position: '',
      employeeCount: undefined,
      consent: undefined,
    },
  })

  async function onSubmit(values: MarketingLeadInput) {
    setSubmitError(null)
    try {
      const form = document.getElementById('lead-form') as HTMLFormElement | null
      const hpExtra = (form?.elements.namedItem('hp_extra') as HTMLInputElement | null)?.value
      const res = await fetch('/api/public/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...values,
          deck,
          hp_extra: hpExtra,
          utm: collectUtm(),
          referrer: document.referrer || undefined,
        }),
      })
      if (res.ok) {
        setDone(true)
        return
      }
      setSubmitError(
        res.status === 400
          ? '입력한 정보를 확인해 주세요.'
          : '신청 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.'
      )
    } catch {
      setSubmitError('신청 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.')
    }
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center" role="status">
        <CheckCircle2 className="h-10 w-10 text-emerald-600" aria-hidden />
        <p className="text-lg font-medium break-keep">
          신청이 완료되었습니다. 담당자가 확인 후 24시간 안에 이메일로 안내드릴게요.
        </p>
      </div>
    )
  }

  const err = (msg?: string) =>
    msg ? (
      <p className="text-sm text-destructive" role="alert">
        {msg}
      </p>
    ) : null

  return (
    <form id="lead-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="lead-name">이름</Label>
          <Input id="lead-name" autoComplete="name" {...register('name')} />
          {err(errors.name?.message)}
        </div>
        <div className="space-y-2">
          <Label htmlFor="lead-phone">휴대폰 번호</Label>
          <Input
            id="lead-phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            placeholder="01012345678"
            maxLength={11}
            {...register('phone', {
              onChange: (e) => setValue('phone', e.target.value.replace(/\D/g, '')),
            })}
          />
          {err(errors.phone?.message)}
        </div>
        <div className="space-y-2">
          <Label htmlFor="lead-email">이메일</Label>
          <Input id="lead-email" type="email" autoComplete="email" {...register('email')} />
          {err(errors.email?.message)}
        </div>
        <div className="space-y-2">
          <Label htmlFor="lead-company">회사명</Label>
          <Input id="lead-company" autoComplete="organization" {...register('companyName')} />
          {err(errors.companyName?.message)}
        </div>
        <div className="space-y-2">
          <Label htmlFor="lead-position">직책</Label>
          <Input id="lead-position" autoComplete="organization-title" {...register('position')} />
          {err(errors.position?.message)}
        </div>
        <div className="space-y-2">
          <Label htmlFor="lead-employees">직원 수</Label>
          <Controller
            control={control}
            name="employeeCount"
            render={({ field }) => (
              <Select value={field.value ?? ''} onValueChange={field.onChange}>
                <SelectTrigger id="lead-employees" className="w-full">
                  <SelectValue placeholder="선택하세요" />
                </SelectTrigger>
                <SelectContent>
                  {EMPLOYEE_COUNT_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {err(errors.employeeCount?.message)}
        </div>
      </div>

      {/* 허니팟 — 사람에겐 보이지 않는다 */}
      <input
        type="text"
        name="hp_extra"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        className="absolute -left-[9999px] h-0 w-0 opacity-0"
      />

      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <Controller
            control={control}
            name="consent"
            render={({ field }) => (
              <Checkbox
                id="lead-consent"
                checked={field.value === true}
                onCheckedChange={(v) => field.onChange(v === true ? true : undefined)}
                className="mt-0.5"
              />
            )}
          />
          <Label htmlFor="lead-consent" className="leading-snug font-normal break-keep">
            서비스 안내를 위한 개인정보(이름·연락처·이메일·회사 정보) 수집·이용에 동의합니다.
            <Link
              href="/privacy"
              target="_blank"
              className="ml-1 text-muted-foreground underline underline-offset-2"
            >
              자세히 보기
            </Link>
          </Label>
        </div>
        {err(errors.consent?.message)}
      </div>

      {submitError ? err(submitError) : null}

      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> 제출 중
          </>
        ) : (
          '신청하기'
        )}
      </Button>
    </form>
  )
}
