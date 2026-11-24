import Link from 'next/link'
import { sanitizeRedirectPath } from '@/lib/auth-redirect'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata = {
  title: 'Workdeck 메일 확인',
  robots: { index: false },
}

const TITLES: Record<string, string> = {
  invite: '작업 공간 초대 확인',
  signup: '이메일 인증',
  email: '이메일 인증',
  recovery: '비밀번호 재설정',
  email_change: '이메일 변경 확인',
  magiclink: '로그인',
}

// 링크가 만료됐거나 이미 쓰인 경우 — type 별로 다음에 할 일을 안내한다.
const EXPIRED: Record<string, { text: string; href: string; label: string }> = {
  email: {
    text: '인증 링크가 만료됐거나 이미 사용됐습니다. 이미 인증했다면 바로 로그인하고, 아니라면 로그인 화면에서 인증 메일을 다시 받을 수 있습니다.',
    href: '/login?verified=pending',
    label: '로그인 화면으로',
  },
  recovery: {
    text: '재설정 링크가 만료됐거나 이미 사용됐습니다. 비밀번호 재설정 메일을 다시 받아 주세요.',
    href: '/forgot-password',
    label: '비밀번호 재설정 메일 다시 받기',
  },
}
const EXPIRED_DEFAULT = {
  text: '링크가 만료됐거나 이미 사용됐습니다. 로그인 화면에서 다시 시도해 주세요.',
  href: '/login',
  label: '로그인 화면으로',
}

export default async function AuthConfirmContinuePage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string; next?: string; error?: string }>
}) {
  const { token_hash, type = '', next, error } = await searchParams
  const title = TITLES[type]

  let body: React.ReactNode
  if (error === 'expired') {
    const e = EXPIRED[type === 'signup' ? 'email' : type] ?? EXPIRED_DEFAULT
    body = (
      <>
        <CardDescription>{e.text}</CardDescription>
        <Button asChild size="lg" className="w-full">
          <Link href={e.href}>{e.label}</Link>
        </Button>
      </>
    )
  } else if (!token_hash || !title) {
    body = (
      <>
        <CardDescription>링크가 올바르지 않습니다. 메일의 버튼을 다시 눌러 주세요.</CardDescription>
        <Button asChild size="lg" className="w-full">
          <Link href="/login">로그인 화면으로</Link>
        </Button>
      </>
    )
  } else {
    // JS 없이 동작하는 일반 form POST — 버튼을 눌러야 일회용 링크가 확인된다.
    body = (
      <form method="post" action="/auth/confirm" className="space-y-4">
        <CardDescription>아래 버튼을 눌러 계속하세요.</CardDescription>
        <input type="hidden" name="token_hash" value={token_hash} />
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="next" value={sanitizeRedirectPath(next) ?? ''} />
        <Button type="submit" size="lg" className="w-full">
          계속하기
        </Button>
      </form>
    )
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center p-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">{title ?? 'Workdeck 메일 확인'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">{body}</CardContent>
      </Card>
    </main>
  )
}
