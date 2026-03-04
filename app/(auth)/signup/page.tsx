import Link from 'next/link'
import { sanitizeRedirectPath } from '@/lib/auth-redirect'
import { SignupForm } from '@/components/auth/signup-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata = {
  title: 'Workdeck 회원가입',
  description: 'Workdeck 계정을 생성하세요',
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string }>
}) {
  const { redirectTo } = await searchParams
  const safeRedirectTo = sanitizeRedirectPath(redirectTo)
  const loginHref = safeRedirectTo
    ? `/login?redirectTo=${encodeURIComponent(safeRedirectTo)}`
    : '/login'

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl font-bold">Workdeck 회원가입</CardTitle>
        <CardDescription>가입 후 필요한 Deck을 추가해서 업무를 시작하세요</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <SignupForm redirectTo={safeRedirectTo} />

        <div className="text-center text-sm">
          <span className="text-muted-foreground">이미 계정이 있으신가요? </span>
          <Link href={loginHref} className="font-medium text-primary hover:underline">
            로그인
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
