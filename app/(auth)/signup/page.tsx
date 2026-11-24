import Link from 'next/link'
import { sanitizeRedirectPath } from '@/lib/auth-redirect'
import { buildMarketingUrl } from '@/lib/domain'
import { isLeadGateEnabled, verifyLeadToken } from '@/lib/marketing/lead-signup'
import { Button } from '@/components/ui/button'
import { SignupAccountSwitch, SignupForm } from '@/components/auth/signup-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata = {
  title: 'Workdeck 회원가입',
  description: 'Workdeck 계정을 생성하세요',
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{
    redirectTo?: string
    email?: string | string[]
    lead?: string
    blocked?: string
  }>
}) {
  const { redirectTo, email, lead: token, blocked } = await searchParams
  const gateEnabled = isLeadGateEnabled()
  const lead = gateEnabled && typeof token === 'string' ? await verifyLeadToken(token) : null
  const restricted = gateEnabled && !lead
  const isBlocked = blocked === 'lead'
  const safeRedirectTo =
    sanitizeRedirectPath(redirectTo) ??
    (lead ? `/my-deck?subscribe=${encodeURIComponent(lead.deck)}` : null)
  const loginHref = safeRedirectTo
    ? `/login?redirectTo=${encodeURIComponent(safeRedirectTo)}`
    : '/login'

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl font-bold">Workdeck 회원가입</CardTitle>
        <CardDescription>
          {restricted
            ? '워크덱은 도입 문의 후 가입할 수 있습니다'
            : '가입 후 필요한 업무를 골라 시작하세요'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isBlocked ? (
          <p role="alert" className="text-sm text-destructive">
            도입 문의에 남긴 이메일과 다른 계정입니다. 문의한 이메일로 계속하거나 새 이메일로 도입
            문의를 남겨 주세요.
          </p>
        ) : null}
        {restricted ? (
          <Button className="w-full" size="lg" asChild>
            <Link href={buildMarketingUrl('/recruiting#lead-form')}>도입 문의하기</Link>
          </Button>
        ) : null}
        <SignupForm
          redirectTo={safeRedirectTo}
          email={lead?.email ?? (typeof email === 'string' ? email : '')}
          leadToken={lead ? token : undefined}
          emailLocked={Boolean(lead)}
          showEmailForm={!restricted}
          googleLabel={
            isBlocked
              ? '다른 Google 계정으로 계속'
              : restricted
                ? '이미 문의했다면 Google 계정으로 계속'
                : 'Google로 계속하기'
          }
        />

        <div className="text-center text-sm">
          <span className="text-muted-foreground">이미 계정이 있으신가요? </span>
          {isBlocked ? (
            <SignupAccountSwitch loginHref={loginHref} />
          ) : (
            <Link href={loginHref} className="font-medium text-primary hover:underline">
              로그인
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
