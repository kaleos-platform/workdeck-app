import Link from 'next/link'
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata = {
  title: '비밀번호 찾기 — Workdeck',
  description: '비밀번호 재설정 링크를 이메일로 받으세요',
}

export default function ForgotPasswordPage() {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl font-bold">비밀번호 찾기</CardTitle>
        <CardDescription>
          가입한 이메일을 입력하면 비밀번호 재설정 링크를 보내드립니다
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <ForgotPasswordForm />

        <div className="text-center text-sm">
          <Link href="/login" className="font-medium text-primary hover:underline">
            로그인으로 돌아가기
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
