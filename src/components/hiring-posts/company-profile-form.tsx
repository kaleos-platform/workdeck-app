'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { companyProfileSchema } from '@/lib/validations/hiring-posts'

export type CompanyProfileValues = {
  companyName: string
  intro: string | null
  homepageUrl: string | null
  blogUrl: string | null
  instagramUrl: string | null
  youtubeUrl: string | null
  showIntro: boolean
}

type FormValues = {
  companyName: string
  intro: string
  homepageUrl: string
  blogUrl: string
  instagramUrl: string
  youtubeUrl: string
  showIntro: boolean
}

const URL_FIELDS = [
  { name: 'homepageUrl', label: '홈페이지' },
  { name: 'blogUrl', label: '블로그' },
  { name: 'instagramUrl', label: '인스타그램' },
  { name: 'youtubeUrl', label: '유튜브' },
] as const

const INTRO_MAX = 1000

// 모집 관리 기업 정보 — 저장해야 공개 공고에 반영된다.
export function CompanyProfileForm({
  initialProfile,
  defaultCompanyName,
  postingUuid,
}: {
  initialProfile: CompanyProfileValues | null
  defaultCompanyName: string
  postingUuid: string | null
}) {
  const [saved, setSaved] = useState(initialProfile !== null)
  const [saving, setSaving] = useState(false)
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(companyProfileSchema) as unknown as Resolver<FormValues>,
    defaultValues: {
      companyName: initialProfile?.companyName ?? defaultCompanyName,
      intro: initialProfile?.intro ?? '',
      homepageUrl: initialProfile?.homepageUrl ?? '',
      blogUrl: initialProfile?.blogUrl ?? '',
      instagramUrl: initialProfile?.instagramUrl ?? '',
      youtubeUrl: initialProfile?.youtubeUrl ?? '',
      showIntro: initialProfile?.showIntro ?? true,
    },
  })
  const introLength = watch('intro').length
  const showIntro = watch('showIntro')

  async function onSubmit(values: FormValues) {
    setSaving(true)
    try {
      const res = await fetch('/api/hiring-posts/company-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        toast.error(
          res.status === 402
            ? '구독이 만료되어 저장할 수 없습니다. 구독을 갱신한 뒤 다시 저장해 주세요.'
            : (data?.message ?? '저장하지 못했습니다. 입력값을 확인하고 다시 시도해 주세요.')
        )
        return
      }
      setSaved(true)
      toast.success('기업 정보를 저장했습니다')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="max-w-2xl space-y-6" noValidate>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">
          공개 공고 상단과 하단에 표시되는 기업 정보입니다.
        </p>
        {saved ? (
          <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
            공고에 표시 중
          </Badge>
        ) : (
          <Badge variant="secondary">아직 저장 안 됨</Badge>
        )}
        {saved && postingUuid && (
          <Link
            href={`/p/${postingUuid}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline"
          >
            공고에서 보기
          </Link>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="companyName">기업명</Label>
        <Input id="companyName" maxLength={50} {...register('companyName')} />
        {!saved && (
          <p className="text-xs text-muted-foreground">
            작업 공간 이름을 기본값으로 채웠습니다. 저장해야 공고에 표시됩니다.
          </p>
        )}
        {errors.companyName && (
          <p className="text-xs text-destructive">{errors.companyName.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="intro">기업 소개</Label>
        <Textarea id="intro" rows={5} {...register('intro')} />
        <p className="text-right text-xs text-muted-foreground">
          {introLength.toLocaleString()} / {INTRO_MAX.toLocaleString()}자
        </p>
        {errors.intro && <p className="text-xs text-destructive">{errors.intro.message}</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {URL_FIELDS.map(({ name, label }) => (
          <div key={name} className="space-y-2">
            <Label htmlFor={name}>{label}</Label>
            <Input id={name} placeholder="https://" inputMode="url" {...register(name)} />
            {errors[name] && <p className="text-xs text-destructive">{errors[name]?.message}</p>}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <Switch
          id="showIntro"
          checked={showIntro}
          onCheckedChange={(v) => setValue('showIntro', v, { shouldDirty: true })}
        />
        <Label htmlFor="showIntro">공고에 기업 소개 표시</Label>
      </div>
      <p className="-mt-4 text-xs text-muted-foreground">
        끄면 소개와 링크는 숨기고, 기업명과 근무 장소는 계속 표시됩니다.
      </p>

      <Button type="submit" disabled={saving}>
        {saving ? '저장 중…' : '저장'}
      </Button>
    </form>
  )
}
