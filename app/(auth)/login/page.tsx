import Link from 'next/link'
import { sanitizeRedirectPath } from '@/lib/auth-redirect'
import { LoginForm } from '@/components/auth/login-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata = {
  title: 'Workdeck 로그인',
  description: 'Workdeck 계정으로 로그인하세요',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ verified?: string; redirectTo?: string; reset?: string }>
}) {
  const { verified, redirectTo, reset } = await searchParams
  const isVerifyPending = verified === 'pending'
  const isVerifySuccess = verified === 'success'
  const isResetSuccess = reset === 'success'
  const safeRedirectTo = sanitizeRedirectPath(redirectTo)
  const signupHref = safeRedirectTo
    ? `/signup?redirectTo=${encodeURIComponent(safeRedirectTo)}`
    : '/signup'

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl font-bold">Workdeck 로그인</CardTitle>
        <CardDescription>이메일과 비밀번호를 입력하고 내 Deck으로 바로 이동하세요</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <LoginForm
          isVerifyPending={isVerifyPending}
          isVerifySuccess={isVerifySuccess}
          isResetSuccess={isResetSuccess}
          redirectTo={safeRedirectTo}
        />

        <div className="text-center text-sm">
          <span className="text-muted-foreground">계정이 없으신가요? </span>
          <Link href={signupHref} className="font-medium text-primary hover:underline">
            회원가입
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
