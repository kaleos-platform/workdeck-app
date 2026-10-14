'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createClient } from '@/lib/supabase/client'
import { signupSchema } from '@/lib/validations/auth'

type View = 'anonymous' | 'wrong_account' | 'needs_password' | 'ready'

export function InviteAccept({
  token,
  view,
  invitePath,
  inviteEmail,
}: {
  token: string
  view: View
  invitePath: string
  inviteEmail: string
}) {
  const router = useRouter()
  const supabase = createClient()
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [alreadyUsed, setAlreadyUsed] = useState(false)
  const [passwordDone, setPasswordDone] = useState(false)
  const next = encodeURIComponent(invitePath)

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
    router.replace(`/my-deck?spaceId=${encodeURIComponent(body.spaceId)}`)
  }

  async function setPasswordAndAccept() {
    // 가입 폼과 같은 비밀번호 규칙을 쓴다.
    const parsed = signupSchema.shape.password.safeParse(password)
    if (!parsed.success) return setError(parsed.error.issues[0].message)
    setPending(true)
    setError(null)
    const { error: e } = await supabase.auth.updateUser({ password, data: { password_set: true } })
    if (e?.code === 'same_password') {
      // 이미 같은 비밀번호가 설정돼 있다 — 설정된 것으로 보고 표시만 남긴다.
      await supabase.auth.updateUser({ data: { password_set: true } })
    } else if (e) {
      setPending(false)
      return setError('비밀번호를 설정하지 못했습니다. 다시 시도하세요')
    }
    setPasswordDone(true)
    await accept()
  }

  if (view === 'anonymous') {
    return (
      <div className="space-y-3">
        <div className="flex gap-2">
          <Button asChild>
            <Link href={`/signup?redirectTo=${next}&email=${encodeURIComponent(inviteEmail)}`}>
              가입하기
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/login?redirectTo=${next}`}>로그인</Link>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          초대 메일을 받았다면 메일의 링크로 들어오세요. 링크를 잃었으면{' '}
          <Link className="underline" href="/forgot-password">
            비밀번호 찾기
          </Link>
          로 비밀번호를 정한 뒤 로그인하세요.
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
    </div>
  )
}
