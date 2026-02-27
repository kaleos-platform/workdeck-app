import Link from 'next/link'
import { LoginForm } from '@/components/auth/login-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata = {
  title: '로그인',
  description: '계정으로 로그인하세요',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ verified?: string }>
}) {
  const { verified } = await searchParams
  const isVerifyPending = verified === 'pending'
  const isVerifySuccess = verified === 'success'

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl font-bold">로그인</CardTitle>
        <CardDescription>이메일과 비밀번호를 입력하여 로그인하세요</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <LoginForm isVerifyPending={isVerifyPending} isVerifySuccess={isVerifySuccess} />

        <div className="text-center text-sm">
          <span className="text-muted-foreground">계정이 없으신가요? </span>
          <Link href="/signup" className="font-medium text-primary hover:underline">
            회원가입
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
