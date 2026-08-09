'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/client'
import { resetPasswordSchema, type ResetPasswordInput } from '@/lib/validations/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import type { Factor } from '@supabase/supabase-js'

type AuditAction = 'account.password.change' | 'account.mfa.enroll' | 'account.mfa.unenroll'

// 감사 로그는 최선 노력 — 실패해도 사용자 흐름(비번/MFA 변경 자체)을 막지 않는다.
function logAuditAction(action: AuditAction) {
  fetch('/api/admin/account/audit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  }).catch(() => {})
}

export function AccountSettings({ email }: { email: string }) {
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">계정 설정</h1>
        <p className="text-sm text-muted-foreground">{email}</p>
      </div>
      <PasswordSection />
      <EmailSection currentEmail={email} />
      <MfaSection />
    </div>
  )
}

function PasswordSection() {
  const [isLoading, setIsLoading] = useState(false)
  const supabase = createClient()

  const form = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  })

  async function onSubmit(data: ResetPasswordInput) {
    setIsLoading(true)
    const { error } = await supabase.auth.updateUser({ password: data.password })
    setIsLoading(false)

    if (error) {
      toast.error('비밀번호 변경에 실패했습니다.')
      return
    }

    toast.success('비밀번호가 변경되었습니다.')
    form.reset()
    logAuditAction('account.password.change')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>비밀번호</CardTitle>
        <CardDescription>로그인에 사용할 비밀번호를 변경합니다.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>새 비밀번호</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="••••••••"
                      type="password"
                      disabled={isLoading}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>비밀번호 확인</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="••••••••"
                      type="password"
                      disabled={isLoading}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={isLoading}>
              {isLoading ? '변경 중...' : '비밀번호 변경'}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}

const emailSchema = z.string().email()

function EmailSection({ currentEmail }: { currentEmail: string }) {
  const [newEmail, setNewEmail] = useState('')
  const [newEmailConfirm, setNewEmailConfirm] = useState('')
  const [currentEmailConfirm, setCurrentEmailConfirm] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const supabase = createClient()

  const canOpenDialog =
    emailSchema.safeParse(newEmail).success &&
    newEmail === newEmailConfirm &&
    newEmail !== currentEmail

  function openConfirm() {
    if (!canOpenDialog) {
      toast.error('새 이메일 주소를 정확히 두 번 입력해주세요.')
      return
    }
    setCurrentEmailConfirm('')
    setDialogOpen(true)
  }

  async function handleConfirm() {
    setIsLoading(true)
    const { error } = await supabase.auth.updateUser(
      { email: newEmail },
      { emailRedirectTo: `${window.location.origin}/auth/confirm?next=/admin/account` }
    )
    setIsLoading(false)

    if (error) {
      toast.error('이메일 변경 요청에 실패했습니다.')
      return
    }

    toast.success('새 주소로 확인 메일을 보냈습니다. 확인 전까지 기존 주소로 로그인됩니다.')
    setDialogOpen(false)
    setNewEmail('')
    setNewEmailConfirm('')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>이메일</CardTitle>
        <CardDescription>현재 주소: {currentEmail}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="new-email">새 이메일 주소</Label>
          <Input
            id="new-email"
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-email-confirm">새 이메일 주소 확인</Label>
          <Input
            id="new-email-confirm"
            type="email"
            value={newEmailConfirm}
            onChange={(e) => setNewEmailConfirm(e.target.value)}
          />
        </div>
        <Button type="button" onClick={openConfirm} disabled={!canOpenDialog}>
          이메일 변경
        </Button>
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>이메일 변경 확인</DialogTitle>
            <DialogDescription>
              <strong>{newEmail}</strong> 주소로 확인 메일이 발송됩니다. 확인 전까지는 기존
              주소({currentEmail})로 로그인됩니다. 계속하려면 현재 이메일 주소를 입력하세요.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="email"
            placeholder={currentEmail}
            value={currentEmailConfirm}
            onChange={(e) => setCurrentEmailConfirm(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isLoading}>
              취소
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={isLoading || currentEmailConfirm !== currentEmail}
            >
              {isLoading ? '전송 중...' : '확인 메일 보내기'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function MfaSection() {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [verifiedFactor, setVerifiedFactor] = useState<Factor | null>(null)
  const [enrollment, setEnrollment] = useState<{
    factorId: string
    qrCode: string
    secret: string
  } | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [unenrollTarget, setUnenrollTarget] = useState<Factor | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.auth.mfa.listFactors()
    if (error) {
      toast.error('MFA 상태를 불러오지 못했습니다.')
      setLoading(false)
      return
    }

    const totpFactors = data.all.filter((f) => f.factor_type === 'totp')
    // enroll 후 verify 실패/이탈로 남은 unverified factor는 다음 enroll을 막으므로 진입 시 정리한다.
    const unverified = totpFactors.filter((f) => f.status !== 'verified')
    for (const f of unverified) {
      await supabase.auth.mfa.unenroll({ factorId: f.id })
    }

    setVerifiedFactor(totpFactors.find((f) => f.status === 'verified') ?? null)
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    // refresh 첫 줄의 setLoading(true)가 동기 실행이라 규칙에 걸리지만, 마운트 직후 1회
    // 로딩 표시를 켜는 의도된 동작이다(초기 state도 true라 실제 추가 렌더는 없음).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])

  async function startEnroll() {
    setBusy(true)
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `admin-${Date.now()}`,
    })
    setBusy(false)

    if (error || !data) {
      toast.error('MFA 등록을 시작하지 못했습니다.')
      return
    }

    setEnrollment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret })
  }

  async function verifyEnroll() {
    if (!enrollment) return
    setBusy(true)
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: enrollment.factorId,
      code,
    })
    setBusy(false)

    if (error) {
      toast.error('인증 코드가 올바르지 않습니다.')
      return
    }

    toast.success('2단계 인증이 등록되었습니다.')
    setEnrollment(null)
    setCode('')
    logAuditAction('account.mfa.enroll')
    await refresh()
    router.refresh()
  }

  async function cancelEnroll() {
    if (enrollment) {
      await supabase.auth.mfa.unenroll({ factorId: enrollment.factorId })
    }
    setEnrollment(null)
    setCode('')
  }

  async function handleUnenroll() {
    if (!unenrollTarget) return
    setBusy(true)
    const { error } = await supabase.auth.mfa.unenroll({ factorId: unenrollTarget.id })
    setBusy(false)

    if (error) {
      toast.error('2단계 인증 해제에 실패했습니다.')
      return
    }

    toast.success('2단계 인증이 해제되었습니다.')
    setUnenrollTarget(null)
    logAuditAction('account.mfa.unenroll')
    await refresh()
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>2단계 인증 (MFA)</CardTitle>
        <CardDescription>
          로그인 시 인증 앱(Google Authenticator 등)의 6자리 코드를 추가로 요구합니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">불러오는 중...</p>
        ) : verifiedFactor ? (
          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="flex items-center gap-2 text-sm">
              <ShieldCheck className="size-4 text-emerald-600" />
              등록됨 ({verifiedFactor.friendly_name ?? verifiedFactor.id.slice(0, 8)})
            </div>
            <Button variant="outline" size="sm" onClick={() => setUnenrollTarget(verifiedFactor)}>
              해제
            </Button>
          </div>
        ) : enrollment ? (
          <div className="flex flex-col gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:image/svg+xml;utf-8,${encodeURIComponent(enrollment.qrCode)}`}
              alt="TOTP QR 코드"
              className="size-40 self-start rounded border bg-white p-2"
            />
            <div className="space-y-1">
              <Label>수동 입력용 비밀 키</Label>
              <Input readOnly value={enrollment.secret} className="font-mono text-xs" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mfa-code">인증 앱의 6자리 코드</Label>
              <Input
                id="mfa-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="000000"
                maxLength={6}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={verifyEnroll} disabled={busy || code.length !== 6}>
                확인
              </Button>
              <Button variant="outline" onClick={cancelEnroll} disabled={busy}>
                취소
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ShieldAlert className="size-4" />
              미등록
            </div>
            <Button size="sm" onClick={startEnroll} disabled={busy}>
              등록하기
            </Button>
          </div>
        )}
      </CardContent>

      <Dialog open={!!unenrollTarget} onOpenChange={(open) => !open && setUnenrollTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>2단계 인증 해제</DialogTitle>
            <DialogDescription>
              해제하면 ADMIN_REQUIRE_MFA가 켜져 있을 때 어드민 접근이 차단됩니다. 계속하시겠습니까?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnenrollTarget(null)} disabled={busy}>
              취소
            </Button>
            <Button variant="destructive" onClick={handleUnenroll} disabled={busy}>
              해제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
