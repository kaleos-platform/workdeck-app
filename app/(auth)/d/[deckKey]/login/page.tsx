import Link from 'next/link'
import { notFound } from 'next/navigation'
import { sanitizeRedirectPath } from '@/lib/auth-redirect'
import { LoginForm } from '@/components/auth/login-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const DECK_COPY: Record<string, { title: string; description: string }> = {
  'coupang-ads': {
    title: '쿠팡 광고 관리자 로그인',
    description: '로그인 후 쿠팡 광고 관리자 Deck로 바로 이동합니다',
  },
}

export default async function DeckLoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ deckKey: string }>
  searchParams: Promise<{ verified?: string; redirectTo?: string }>
}) {
  const { deckKey } = await params
  const copy = DECK_COPY[deckKey]
  if (!copy) notFound()

  const { verified, redirectTo } = await searchParams
  const fallbackRedirect = `/d/${deckKey}`
  const safeRedirectTo = sanitizeRedirectPath(redirectTo) ?? fallbackRedirect
  const isVerifyPending = verified === 'pending'
  const isVerifySuccess = verified === 'success'
  const signupHref = `/signup?redirectTo=${encodeURIComponent(safeRedirectTo)}`

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl font-bold">{copy.title}</CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <LoginForm
          isVerifyPending={isVerifyPending}
          isVerifySuccess={isVerifySuccess}
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
