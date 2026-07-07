'use client'

import { useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Loader2, Plus, Pencil, X, Key, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { DEFAULT_PROFILES, type FormatProfile } from '@/lib/bo/channel-profiles'

// ─── 타입 ─────────────────────────────────────────────────────────────────────

type BoPlatform = 'NAVER_BLOG' | 'TISTORY' | 'OWN_HOMEPAGE'
type BoPublisherMode = 'MANUAL' | 'BROWSER'
type BoCredentialKind = 'COOKIE' | 'OAUTH' | 'API_KEY'

interface Channel {
  id: string
  platform: BoPlatform
  name: string
  formatProfile: FormatProfile
  publisherMode: BoPublisherMode
  config: Record<string, unknown>
  isActive: boolean
  createdAt: string
  updatedAt: string
}

interface CredentialMeta {
  id: string
  kind: string
  expiresAt: string | null
  lastVerifiedAt: string | null
  lastError: string | null
  updatedAt: string
}

// ─── 플랫폼 배지 ──────────────────────────────────────────────────────────────

const PLATFORM_LABEL: Record<BoPlatform, string> = {
  NAVER_BLOG: '네이버 블로그',
  TISTORY: '티스토리',
  OWN_HOMEPAGE: '자사 홈페이지',
}

const PLATFORM_BADGE_CLASS: Record<BoPlatform, string> = {
  NAVER_BLOG:
    'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  TISTORY:
    'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  OWN_HOMEPAGE:
    'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
}

const CREDENTIAL_KIND_LABEL: Record<BoCredentialKind, string> = {
  COOKIE: '쿠키',
  OAUTH: 'OAuth',
  API_KEY: 'API 키',
}

// ─── 채널 추가 폼 스키마 ──────────────────────────────────────────────────────

const addChannelSchema = z.object({
  platform: z.enum(['NAVER_BLOG', 'TISTORY', 'OWN_HOMEPAGE']),
  name: z.string().min(1, '채널 이름을 입력하세요').max(100),
})

type AddChannelValues = z.infer<typeof addChannelSchema>

// ─── 프로필 편집 폼 스키마 ────────────────────────────────────────────────────

const profileSchema = z.object({
  toneGuide: z.string().min(1, '말투 지침을 입력하세요'),
  structureGuide: z.string().min(1, '구조 지침을 입력하세요'),
  lengthMin: z.number().int().min(0),
  lengthMax: z.number().int().min(0),
  headingStyle: z.string(),
  ctaStyle: z.string(),
  passthrough: z.boolean(),
})

type ProfileValues = z.infer<typeof profileSchema>

// ─── 자격증명 등록 스키마 ─────────────────────────────────────────────────────

const credentialSchema = z.object({
  kind: z.enum(['COOKIE', 'OAUTH', 'API_KEY']),
  rawPayload: z.string().min(1, '자격증명 내용을 입력하세요'),
})

type CredentialValues = z.infer<typeof credentialSchema>

// ─── 채널 추가 다이얼로그 ─────────────────────────────────────────────────────

function AddChannelDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm<AddChannelValues>({
    resolver: zodResolver(addChannelSchema),
    defaultValues: { platform: 'NAVER_BLOG', name: '' },
  })

  async function onSubmit(values: AddChannelValues) {
    setSubmitting(true)
    setServerError(null)
    try {
      const res = await fetch('/api/bo/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      if (!res.ok) {
        const data = (await res.json()) as { message?: string }
        setServerError(data.message ?? '채널 추가에 실패했습니다')
        return
      }
      setOpen(false)
      form.reset()
      onSuccess()
    } catch {
      setServerError('네트워크 오류가 발생했습니다')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1.5 h-4 w-4" />
          채널 추가
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>채널 추가</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="platform"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>플랫폼</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="플랫폼 선택" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="NAVER_BLOG">네이버 블로그</SelectItem>
                      <SelectItem value="TISTORY">티스토리</SelectItem>
                      <SelectItem value="OWN_HOMEPAGE">자사 홈페이지</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>채널 이름</FormLabel>
                  <FormControl>
                    <Input placeholder="예: 공식 네이버 블로그" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {serverError && <p className="text-sm text-destructive">{serverError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={submitting}
              >
                취소
              </Button>
              <Button type="submit" size="sm" disabled={submitting}>
                {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                추가
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// ─── 금지 표현 태그 입력 ──────────────────────────────────────────────────────

function ForbiddenTagInput({
  value,
  onChange,
}: {
  value: string[]
  onChange: (next: string[]) => void
}) {
  const [input, setInput] = useState('')

  function add() {
    const trimmed = input.trim()
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed])
    }
    setInput('')
  }

  function remove(tag: string) {
    onChange(value.filter((v) => v !== tag))
  }

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5">
        <Input
          placeholder="금지 표현 입력 후 Enter"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          className="h-8 text-sm"
        />
        <Button type="button" size="sm" variant="outline" onClick={add} className="h-8">
          추가
        </Button>
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs"
            >
              {tag}
              <button
                type="button"
                onClick={() => remove(tag)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── 프로필 편집 다이얼로그 ───────────────────────────────────────────────────

function EditProfileDialog({ channel, onSuccess }: { channel: Channel; onSuccess: () => void }) {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState<string[]>(
    channel.formatProfile.forbiddenExpressions ?? []
  )

  const profile = channel.formatProfile

  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      toneGuide: profile.toneGuide,
      structureGuide: profile.structureGuide,
      lengthMin: profile.lengthRange.min,
      lengthMax: profile.lengthRange.max,
      headingStyle: profile.headingStyle,
      ctaStyle: profile.ctaStyle,
      passthrough: profile.passthrough ?? false,
    },
  })

  // 다이얼로그 열릴 때마다 최신 프로필로 리셋
  useEffect(() => {
    if (open) {
      const p = channel.formatProfile
      form.reset({
        toneGuide: p.toneGuide,
        structureGuide: p.structureGuide,
        lengthMin: p.lengthRange.min,
        lengthMax: p.lengthRange.max,
        headingStyle: p.headingStyle,
        ctaStyle: p.ctaStyle,
        passthrough: p.passthrough ?? false,
      })
      setForbidden(p.forbiddenExpressions ?? [])
    }
  }, [open, channel.formatProfile, form])

  async function onSubmit(values: ProfileValues) {
    setSubmitting(true)
    setServerError(null)
    const formatProfile: FormatProfile = {
      toneGuide: values.toneGuide,
      structureGuide: values.structureGuide,
      lengthRange: { min: values.lengthMin, max: values.lengthMax },
      headingStyle: values.headingStyle,
      forbiddenExpressions: forbidden,
      ctaStyle: values.ctaStyle,
      passthrough: values.passthrough,
    }
    try {
      const res = await fetch(`/api/bo/channels/${channel.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formatProfile }),
      })
      if (!res.ok) {
        const data = (await res.json()) as { message?: string }
        setServerError(data.message ?? '프로필 수정에 실패했습니다')
        return
      }
      setOpen(false)
      onSuccess()
    } catch {
      setServerError('네트워크 오류가 발생했습니다')
    } finally {
      setSubmitting(false)
    }
  }

  const isPassthrough = form.watch('passthrough')

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
          <Pencil className="h-3 w-3" />
          프로필 편집
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            포맷 프로필 편집
            <span className="ml-2 text-sm font-normal text-muted-foreground">{channel.name}</span>
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* passthrough 스위치 */}
            <FormField
              control={form.control}
              name="passthrough"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-md border px-3 py-2.5">
                  <div>
                    <FormLabel className="text-sm font-medium">마스터 그대로 복사</FormLabel>
                    <p className="text-xs text-muted-foreground">
                      활성화하면 LLM 변형 없이 원문을 그대로 사용합니다
                    </p>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />

            {/* passthrough OFF일 때만 나머지 프로필 표시 */}
            {!isPassthrough && (
              <>
                <FormField
                  control={form.control}
                  name="toneGuide"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>말투 지침</FormLabel>
                      <FormControl>
                        <Textarea
                          rows={3}
                          placeholder="예: 구어체·친근한 말투, 이모지 절제"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="structureGuide"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>구조 지침</FormLabel>
                      <FormControl>
                        <Textarea
                          rows={3}
                          placeholder="예: 짧은 문단(2~3문장), 소제목 자주 사용"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="lengthMin"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>최소 분량 (자)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={0}
                            {...field}
                            onChange={(e) => field.onChange(e.target.valueAsNumber)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="lengthMax"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>최대 분량 (자)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={0}
                            {...field}
                            onChange={(e) => field.onChange(e.target.valueAsNumber)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="headingStyle"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>소제목 스타일</FormLabel>
                      <FormControl>
                        <Input placeholder="예: 질문형 h2 (## 로 시작)" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="ctaStyle"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>CTA 스타일</FormLabel>
                      <FormControl>
                        <Input placeholder="예: 부드러운 권유형 마무리" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">금지 표현</Label>
                  <ForbiddenTagInput value={forbidden} onChange={setForbidden} />
                </div>
              </>
            )}

            {serverError && <p className="text-sm text-destructive">{serverError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={submitting}
              >
                취소
              </Button>
              <Button type="submit" size="sm" disabled={submitting}>
                {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                저장
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// ─── 자격증명 등록 다이얼로그 ─────────────────────────────────────────────────

function CredentialDialog({ channelId, onSuccess }: { channelId: string; onSuccess: () => void }) {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm<CredentialValues>({
    resolver: zodResolver(credentialSchema),
    defaultValues: { kind: 'COOKIE', rawPayload: '' },
  })

  const selectedKind = form.watch('kind')

  async function onSubmit(values: CredentialValues) {
    setSubmitting(true)
    setServerError(null)

    // rawPayload 파싱 — COOKIE/OAUTH 는 JSON, API_KEY 는 문자열로 감싸기
    let payload: Record<string, unknown>
    try {
      if (values.kind === 'API_KEY') {
        payload = { key: values.rawPayload.trim() }
      } else {
        payload = JSON.parse(values.rawPayload) as Record<string, unknown>
      }
    } catch {
      form.setError('rawPayload', { message: '유효한 JSON 형식이어야 합니다' })
      setSubmitting(false)
      return
    }

    try {
      const res = await fetch(`/api/bo/channels/${channelId}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: values.kind, payload }),
      })
      if (!res.ok) {
        const data = (await res.json()) as { message?: string }
        setServerError(data.message ?? '자격증명 등록에 실패했습니다')
        return
      }
      toast.success('자격증명이 등록되었습니다')
      setOpen(false)
      form.reset()
      onSuccess()
    } catch {
      setServerError('네트워크 오류가 발생했습니다')
    } finally {
      setSubmitting(false)
    }
  }

  const placeholderByKind: Record<BoCredentialKind, string> = {
    COOKIE: '{"storageState": "..."}  또는  [{"name":"...", "value":"...", "domain":"..."}]',
    OAUTH: '{"accessToken": "...", "refreshToken": "..."}',
    API_KEY: 'API 키 값을 입력하세요',
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs">
          <Key className="h-3 w-3" />
          자격증명 등록
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>자격증명 등록</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="kind"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>종류</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="COOKIE">
                        쿠키 (Playwright storageState / cookies JSON)
                      </SelectItem>
                      <SelectItem value="OAUTH">OAuth 토큰</SelectItem>
                      <SelectItem value="API_KEY">API 키</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="rawPayload"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {selectedKind === 'API_KEY' ? 'API 키 값' : '페이로드 (JSON)'}
                  </FormLabel>
                  <FormControl>
                    {selectedKind === 'API_KEY' ? (
                      <Input placeholder={placeholderByKind[selectedKind]} {...field} />
                    ) : (
                      <Textarea
                        rows={6}
                        placeholder={placeholderByKind[selectedKind as BoCredentialKind]}
                        className="font-mono text-xs"
                        {...field}
                      />
                    )}
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {serverError && <p className="text-sm text-destructive">{serverError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={submitting}
              >
                취소
              </Button>
              <Button type="submit" size="sm" disabled={submitting}>
                {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                등록
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// ─── 자격증명 섹션 ────────────────────────────────────────────────────────────

function CredentialSection({ channelId }: { channelId: string }) {
  const [credentials, setCredentials] = useState<CredentialMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingKind, setDeletingKind] = useState<string | null>(null)

  const loadCredentials = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/bo/channels/${channelId}/credentials`)
      if (res.ok) {
        const data = (await res.json()) as { credentials: CredentialMeta[] }
        setCredentials(data.credentials)
      }
    } catch {
      // 조용히 무시
    } finally {
      setLoading(false)
    }
  }, [channelId])

  useEffect(() => {
    void loadCredentials()
  }, [loadCredentials])

  async function handleDelete(kind: string) {
    setDeletingKind(kind)
    try {
      const res = await fetch(`/api/bo/channels/${channelId}/credentials`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      })
      if (res.ok) {
        toast.success('자격증명이 삭제되었습니다')
        await loadCredentials()
      } else {
        toast.error('자격증명 삭제에 실패했습니다')
      }
    } catch {
      toast.error('네트워크 오류가 발생했습니다')
    } finally {
      setDeletingKind(null)
    }
  }

  return (
    <div className="mt-2.5 border-t pt-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">자격증명</span>
        <CredentialDialog channelId={channelId} onSuccess={() => void loadCredentials()} />
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">로딩 중…</p>
      ) : credentials.length === 0 ? (
        <p className="text-xs text-muted-foreground">등록된 자격증명이 없습니다.</p>
      ) : (
        <div className="space-y-1">
          {credentials.map((cred) => (
            <div key={cred.id} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium">
                  {CREDENTIAL_KIND_LABEL[cred.kind as BoCredentialKind] ?? cred.kind}
                </span>
                {cred.lastError ? (
                  <span
                    className="inline-flex items-center rounded-full bg-red-100 px-1.5 py-0.5 text-xs text-red-700"
                    title={cred.lastError}
                  >
                    오류
                  </span>
                ) : cred.expiresAt && new Date(cred.expiresAt) < new Date() ? (
                  <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
                    만료
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-700">
                    등록됨
                  </span>
                )}
                {cred.expiresAt && (
                  <span className="text-xs text-muted-foreground">
                    ~{new Date(cred.expiresAt).toLocaleDateString('ko-KR')}
                  </span>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                disabled={deletingKind === cred.kind}
                onClick={() => void handleDelete(cred.kind)}
                title="삭제"
              >
                {deletingKind === cred.kind ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── 발행 모드 셀렉트 ─────────────────────────────────────────────────────────

function PublisherModeSelect({
  channelId,
  current,
  onChanged,
}: {
  channelId: string
  current: BoPublisherMode
  onChanged: () => void
}) {
  const [saving, setSaving] = useState(false)

  async function handleChange(value: string) {
    setSaving(true)
    try {
      await fetch(`/api/bo/channels/${channelId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publisherMode: value }),
      })
      onChanged()
    } catch {
      toast.error('발행 모드 변경에 실패했습니다')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-1.5 flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">발행 모드:</span>
      {saving ? (
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
      ) : (
        <Select value={current} onValueChange={(v) => void handleChange(v)}>
          <SelectTrigger className="h-6 w-auto gap-1 border-0 bg-transparent p-0 text-xs shadow-none hover:bg-muted">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="MANUAL">수동</SelectItem>
            <SelectItem value="BROWSER">브라우저 자동</SelectItem>
          </SelectContent>
        </Select>
      )}
    </div>
  )
}

// ─── NAVER_BLOG 공개 설정 셀렉트 ─────────────────────────────────────────────

function NaverBlogVisibilitySelect({
  channel,
  onChanged,
}: {
  channel: Channel
  onChanged: () => void
}) {
  const [saving, setSaving] = useState(false)
  const current = (channel.config.visibility as string | undefined) ?? 'public'

  async function handleChange(value: string) {
    setSaving(true)
    try {
      await fetch(`/api/bo/channels/${channel.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { ...channel.config, visibility: value } }),
      })
      onChanged()
    } catch {
      toast.error('공개 설정 변경에 실패했습니다')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-1 flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">공개 설정:</span>
      {saving ? (
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
      ) : (
        <Select value={current} onValueChange={(v) => void handleChange(v)}>
          <SelectTrigger className="h-6 w-auto gap-1 border-0 bg-transparent p-0 text-xs shadow-none hover:bg-muted">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="public">전체공개</SelectItem>
            <SelectItem value="private">비공개</SelectItem>
          </SelectContent>
        </Select>
      )}
    </div>
  )
}

// ─── 채널 카드 ────────────────────────────────────────────────────────────────

function ChannelCard({ channel, onRefresh }: { channel: Channel; onRefresh: () => void }) {
  const [deactivating, setDeactivating] = useState(false)

  async function handleDeactivate() {
    if (!confirm(`"${channel.name}" 채널을 비활성화하겠습니까?`)) return
    setDeactivating(true)
    try {
      await fetch(`/api/bo/channels/${channel.id}`, { method: 'DELETE' })
      onRefresh()
    } finally {
      setDeactivating(false)
    }
  }

  const profile = channel.formatProfile ?? DEFAULT_PROFILES[channel.platform]

  return (
    <div className={`rounded-lg border bg-card px-4 py-3 ${!channel.isActive ? 'opacity-50' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={PLATFORM_BADGE_CLASS[channel.platform]}>
              {PLATFORM_LABEL[channel.platform]}
            </span>
            <span className="truncate text-sm font-medium">{channel.name}</span>
            {!channel.isActive && <span className="text-xs text-muted-foreground">(비활성)</span>}
            {profile.passthrough && (
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                패스스루
              </span>
            )}
          </div>
          {!profile.passthrough && (
            <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">{profile.toneGuide}</p>
          )}
          {!profile.passthrough && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              분량 {profile.lengthRange.min}~{profile.lengthRange.max}자
            </p>
          )}
          {/* 발행 모드 셀렉트 */}
          <PublisherModeSelect
            channelId={channel.id}
            current={channel.publisherMode}
            onChanged={onRefresh}
          />
          {/* NAVER_BLOG 전용 공개 설정 */}
          {channel.platform === 'NAVER_BLOG' && (
            <NaverBlogVisibilitySelect channel={channel} onChanged={onRefresh} />
          )}
          {/* 자격증명 섹션 (BROWSER 모드일 때 강조) */}
          <CredentialSection channelId={channel.id} />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <EditProfileDialog channel={channel} onSuccess={onRefresh} />
          {channel.isActive && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
              onClick={() => void handleDeactivate()}
              disabled={deactivating}
            >
              {deactivating ? <Loader2 className="h-3 w-3 animate-spin" /> : '비활성화'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── 메인 클라이언트 컴포넌트 ─────────────────────────────────────────────────

export function ChannelsClient() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/bo/channels')
      if (!res.ok) throw new Error('채널 목록을 불러오지 못했습니다')
      const data = (await res.json()) as { channels: Channel[] }
      setChannels(data.channels)
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류 발생')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = showInactive ? channels : channels.filter((c) => c.isActive)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded"
            />
            비활성 채널 표시
          </label>
        </div>
        <AddChannelDialog onSuccess={load} />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          로딩 중...
        </div>
      ) : error ? (
        <p className="py-4 text-sm text-destructive">{error}</p>
      ) : filtered.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">
          {channels.length === 0
            ? '등록된 채널이 없습니다. 채널을 추가해 주세요.'
            : '활성 채널이 없습니다.'}
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((channel) => (
            <ChannelCard key={channel.id} channel={channel} onRefresh={load} />
          ))}
        </div>
      )}
    </div>
  )
}
