import Link from 'next/link'
import { ResetPasswordForm } from '@/components/auth/reset-password-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata = {
  title: '비밀번호 재설정 — Workdeck',
  description: '새 비밀번호를 설정하세요',
}

export default function ResetPasswordPage() {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl font-bold">비밀번호 재설정</CardTitle>
        <CardDescription>새로운 비밀번호를 입력해주세요</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <ResetPasswordForm />

        <div className="text-center text-sm">
          <Link href="/login" className="font-medium text-primary hover:underline">
            로그인으로 돌아가기
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
