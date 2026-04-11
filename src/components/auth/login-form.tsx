'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import type { AuthError } from '@supabase/supabase-js'
import Link from 'next/link'
import { X, MailCheck, CheckCircle2, AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { resolveRedirectPath } from '@/lib/auth-redirect'
import { loginSchema, type LoginInput } from '@/lib/validations/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'

function getAuthErrorMessage(error: AuthError): string {
  const msg = error.message.toLowerCase()
  if (msg.includes('invalid login credentials')) {
    return '이메일 또는 비밀번호가 올바르지 않습니다.'
  }
  if (msg.includes('email not confirmed')) {
    return '이메일 인증이 완료되지 않았습니다. 가입한 이메일의 인증 링크를 확인해주세요.'
  }
  if (msg.includes('user not found')) {
    return '등록되지 않은 이메일입니다. 회원가입을 진행해주세요.'
  }
  if (msg.includes('too many requests')) {
    return '너무 많은 로그인 시도가 감지되었습니다. 잠시 후 다시 시도해주세요.'
  }
  return '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
}

interface LoginFormProps {
  isVerifyPending?: boolean
  isVerifySuccess?: boolean
  isResetSuccess?: boolean
  redirectTo?: string | null
}

export function LoginForm({
  isVerifyPending = false,
  isVerifySuccess = false,
  isResetSuccess = false,
  redirectTo,
}: LoginFormProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [isGoogleLoading, setIsGoogleLoading] = useState(false)
  const [showBanner, setShowBanner] = useState(isVerifyPending || isVerifySuccess || isResetSuccess)
  const [authError, setAuthError] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()
  const nextPath = resolveRedirectPath(redirectTo)

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  })

  async function onSubmit(data: LoginInput) {
    setIsLoading(true)
    setAuthError(null)

    const { error } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    })

    if (error) {
      setAuthError(getAuthErrorMessage(error))
      setIsLoading(false)
      return
    }

    toast.success('로그인 성공!')
    router.push(nextPath)
    router.refresh()
  }

  async function handleGoogleLogin() {
    setIsGoogleLoading(true)

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
      },
    })

    if (error) {
      toast.error('구글 로그인에 실패했습니다')
      setIsGoogleLoading(false)
    }
    // 성공 시 구글 페이지로 이동하므로 로딩 상태 유지
  }

  const isAnyLoading = isLoading || isGoogleLoading

  return (
    <div className="space-y-4">
      {/* 이메일 인증 관련 배너 */}
      {showBanner && isVerifySuccess && (
        <Alert className="relative border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
          <AlertDescription className="pr-6">
            이메일 인증이 완료되었습니다. 로그인해주세요.
          </AlertDescription>
          <button
            onClick={() => setShowBanner(false)}
            className="absolute top-3 right-3 text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-200"
            aria-label="배너 닫기"
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </Alert>
      )}
      {showBanner && isResetSuccess && (
        <Alert className="relative border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
          <AlertDescription className="pr-6">
            비밀번호가 변경되었습니다. 새 비밀번호로 로그인해주세요.
          </AlertDescription>
          <button
            onClick={() => setShowBanner(false)}
            className="absolute top-3 right-3 text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-200"
            aria-label="배너 닫기"
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </Alert>
      )}
      {showBanner && isVerifyPending && (
        <Alert className="relative">
          <MailCheck className="h-4 w-4" />
          <AlertDescription className="pr-6">
            가입한 이메일을 확인하고 인증을 완료해주세요. 인증 완료 후 로그인이 가능합니다.
          </AlertDescription>
          <button
            onClick={() => setShowBanner(false)}
            className="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
            aria-label="배너 닫기"
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </Alert>
      )}

      {/* 구글 로그인 버튼 */}
      <Button
        variant="outline"
        className="w-full"
        size="lg"
        onClick={handleGoogleLogin}
        disabled={isAnyLoading}
        type="button"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 48 48"
          className="mr-2 h-5 w-5"
          aria-hidden="true"
        >
          <path
            fill="#EA4335"
            d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
          />
          <path
            fill="#4285F4"
            d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
          />
          <path
            fill="#FBBC05"
            d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
          />
          <path
            fill="#34A853"
            d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
          />
          <path fill="none" d="M0 0h48v48H0z" />
        </svg>
        {isGoogleLoading ? '연결 중...' : 'Google로 계속하기'}
      </Button>

      {/* 구분선 */}
      <div className="relative flex items-center">
        <Separator className="flex-1" />
        <span className="mx-3 text-xs text-muted-foreground">또는</span>
        <Separator className="flex-1" />
      </div>

      {/* 이메일/비밀번호 폼 */}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem id="login-email-field">
                <FormLabel>이메일</FormLabel>
                <FormControl>
                  <Input
                    placeholder="name@example.com"
                    type="email"
                    disabled={isAnyLoading}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem id="login-password-field">
                <FormLabel>비밀번호</FormLabel>
                <FormControl>
                  <Input
                    placeholder="••••••••"
                    type="password"
                    disabled={isAnyLoading}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="text-right">
            <Link
              href="/forgot-password"
              className="text-sm text-muted-foreground hover:text-primary hover:underline"
            >
              비밀번호를 잊으셨나요?
            </Link>
          </div>

          {/* 로그인 에러 인라인 Alert */}
          {authError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{authError}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" className="w-full" disabled={isAnyLoading} size="lg">
            {isLoading ? '로그인 중...' : '로그인'}
          </Button>
        </form>
      </Form>
    </div>
  )
}
