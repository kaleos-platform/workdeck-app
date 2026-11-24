'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createClient } from '@/lib/supabase/client'
import { AUTH_TIMEOUT_MESSAGE, withAuthTimeout } from '@/lib/auth/auth-timeout'
import { signupSchema } from '@/lib/validations/auth'

type View = 'anonymous' | 'wrong_account' | 'needs_password' | 'ready'

export function InviteAccept({
  token,
  view,
  invitePath,
}: {
  token: string
  view: View
  invitePath: string
}) {
  const router = useRouter()
  const supabase = createClient()
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [alreadyUsed, setAlreadyUsed] = useState(false)
  const [passwordDone, setPasswordDone] = useState(false)
  const next = encodeURIComponent(invitePath)
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [registered, setRegistered] = useState(false)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  // 초대 이메일로 인증 메일을 받는다. 비밀번호는 받지 않는다 — 인증 뒤 초대 화면에서 정한다.
  async function sendVerification() {
    if (!email.trim()) return setError('초대받은 이메일을 입력하세요')
    setPending(true)
    setError(null)
    setRegistered(false)
    const res = await fetch(`/api/invitations/${encodeURIComponent(token)}/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }).catch(() => null)
    const body = await res?.json().catch(() => null)
    setPending(false)
    if (res?.ok) {
      setSent(true)
      setCooldown(60)
      return
    }
    const reason = body?.reason
    if (reason === 'registered') setRegistered(true)
    setError(
      reason === 'email_mismatch'
        ? '초대받은 이메일과 다릅니다. 초대를 받은 이메일 주소를 정확히 입력하세요'
        : reason === 'registered'
          ? '이미 워크덱 계정이 있습니다. 로그인해서 참여하세요'
          : reason === 'stale'
            ? '초대가 새로 발급되었습니다. 초대한 분께 새 링크를 받으세요'
            : res?.status === 429
              ? '잠시 후 다시 시도하세요. 너무 자주 요청하면 제한됩니다'
              : (body?.message ?? '인증 메일을 보내지 못했습니다. 잠시 후 다시 시도하세요')
    )
  }

  async function accept() {
    setPending(true)
    setError(null)
    const res = await fetch(`/api/invitations/${encodeURIComponent(token)}/accept`, {
      method: 'POST',
    })
    const body = await res.json().catch(() => null)
    setPending(false)
    if (!res.ok) {
      setAlreadyUsed(body?.reason === 'accepted')
      return setError(body?.message ?? '초대를 수락하지 못했습니다')
    }
    // 수락 응답이 현재 작업 공간 쿠키를 설정한다 — 홈·사이드바가 같은 공간을 그린다.
    router.replace('/my-deck')
  }

  async function setPasswordAndAccept() {
    // 가입 폼과 같은 비밀번호 규칙을 쓴다.
    const parsed = signupSchema.shape.password.safeParse(password)
    if (!parsed.success) return setError(parsed.error.issues[0].message)
    setPending(true)
    setError(null)
    const result = await withAuthTimeout(
      supabase.auth.updateUser({ password, data: { password_set: true } })
    )
    if (!result) {
      setPending(false)
      return setError(AUTH_TIMEOUT_MESSAGE)
    }
    const e = result.error
    if (e?.code === 'same_password') {
      // 이미 같은 비밀번호가 설정돼 있다 — 설정된 것으로 보고 표시만 남긴다.
      await withAuthTimeout(supabase.auth.updateUser({ data: { password_set: true } }))
    } else if (e) {
      setPending(false)
      return setError('비밀번호를 설정하지 못했습니다. 다시 시도하세요')
    }
    setPasswordDone(true)
    await accept()
  }

  // 비밀번호 없이 Google 계정으로 들어온다 — 같은 이메일이면 기존 계정에 연결되고 초대 화면으로 돌아온다.
  async function continueWithGoogle() {
    setPending(true)
    const { error: e } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${next}` },
    })
    if (e) {
      setPending(false)
      setError('구글 로그인에 실패했습니다')
    }
  }
  const googleButton = (
    <Button variant="outline" disabled={pending} onClick={continueWithGoogle}>
      Google 계정으로 참여하기
    </Button>
  )

  if (view === 'anonymous') {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <p className="text-sm font-medium">처음이신가요? 이메일 인증하고 참여하기</p>
          {sent ? (
            <div className="space-y-2">
              <p className="text-sm">
                인증 메일을 보냈습니다. 메일의 버튼을 누르면 이 화면으로 돌아와 비밀번호를 정하고
                참여할 수 있습니다.
              </p>
              <p className="text-xs text-muted-foreground">
                메일이 보이지 않으면 스팸함이나 회사 메일 격리함을 확인하세요.
              </p>
              <Button
                variant="outline"
                disabled={pending || cooldown > 0}
                onClick={sendVerification}
              >
                {cooldown > 0 ? `다시 보내기 (${cooldown}초)` : '다시 보내기'}
              </Button>
            </div>
          ) : (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault()
                void sendVerification()
              }}
            >
              <Input
                type="email"
                autoComplete="email"
                aria-label="초대받은 이메일"
                placeholder="초대받은 이메일을 입력하세요"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Button type="submit" disabled={pending}>
                인증 메일 받기
              </Button>
            </form>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {registered && (
            <p className="text-xs text-muted-foreground">
              <Link className="underline" href={`/login?redirectTo=${next}`}>
                로그인
              </Link>
              하거나 비밀번호를 잊었다면{' '}
              <Link className="underline" href={`/forgot-password?redirectTo=${next}`}>
                비밀번호 찾기
              </Link>
              를 이용하세요.
            </p>
          )}
        </div>
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">또는</p>
          {googleButton}
        </div>
        <p className="text-sm">
          이미 계정이 있나요?{' '}
          <Link className="underline" href={`/login?redirectTo=${next}`}>
            로그인
          </Link>
        </p>
      </div>
    )
  }
  if (view === 'wrong_account') {
    return (
      <div className="space-y-3">
        <p className="text-sm">초대받은 이메일 계정으로 로그인해야 합니다.</p>
        <Button
          variant="outline"
          onClick={async () => {
            await supabase.auth.signOut()
            router.replace(`/login?redirectTo=${next}`)
          }}
        >
          로그아웃하고 다시 로그인
        </Button>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {view === 'needs_password' && !passwordDone && (
        <Input
          type="password"
          autoComplete="new-password"
          placeholder="사용할 비밀번호(8자 이상)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {alreadyUsed && (
        <Link className="text-sm underline" href="/my-deck">
          내 업무로 이동
        </Link>
      )}
      <Button
        disabled={pending}
        onClick={view === 'needs_password' && !passwordDone ? setPasswordAndAccept : accept}
      >
        {view === 'needs_password' ? '비밀번호 정하고 참여하기' : '참여하기'}
      </Button>
      {view === 'needs_password' && !passwordDone && googleButton}
    </div>
  )
}
