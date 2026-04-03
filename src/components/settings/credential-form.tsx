'use client'

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Loader2, CheckCircle2, XCircle, Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'

type CredentialFormValues = {
  loginId: string
  password: string
}

type ConnectionStatus = 'connected' | 'disconnected' | 'testing' | 'unknown'

export function CredentialForm() {
  const [status, setStatus] = useState<ConnectionStatus>('unknown')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CredentialFormValues>({
    defaultValues: {
      loginId: '',
      password: '',
    },
  })

  useEffect(() => {
    fetch('/api/collection/credentials')
      .then((res) => {
        if (!res.ok) throw new Error()
        return res.json()
      })
      .then((data: { loginId?: string; isConnected?: boolean }) => {
        if (data.loginId) {
          setValue('loginId', data.loginId)
        }
        setStatus(data.isConnected ? 'connected' : 'disconnected')
      })
      .catch(() => {
        setStatus('unknown')
      })
      .finally(() => setIsLoading(false))
  }, [setValue])

  async function onSubmit(values: CredentialFormValues) {
    if (!values.loginId.trim()) {
      toast.error('쿠팡 로그인 ID를 입력해주세요')
      return
    }
    if (!values.password.trim()) {
      toast.error('비밀번호를 입력해주세요')
      return
    }

    setStatus('testing')
    try {
      const res = await fetch('/api/collection/credentials', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const message = (data as { message?: string }).message ?? '연결 테스트에 실패했습니다'
        toast.error(message)
        setStatus('disconnected')
        return
      }

      const data = await res.json() as { isConnected?: boolean }
      if (data.isConnected) {
        setStatus('connected')
        toast.success('쿠팡 계정이 연결되었습니다')
      } else {
        setStatus('disconnected')
        toast.error('로그인 정보가 올바르지 않습니다')
      }
    } catch {
      setStatus('disconnected')
      toast.error('연결 테스트 중 오류가 발생했습니다')
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>쿠팡 계정 연동</CardTitle>
            <CardDescription>
              쿠팡 셀러센터 로그인 정보를 입력하여 자동 수집 기능을 사용할 수 있습니다.
            </CardDescription>
          </div>
          <StatusBadge status={status} />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="loginId">쿠팡 로그인 ID</Label>
              <Input
                id="loginId"
                placeholder="쿠팡 셀러센터 아이디를 입력하세요"
                {...register('loginId', { required: '쿠팡 로그인 ID를 입력해주세요' })}
              />
              {errors.loginId && (
                <p className="text-sm text-destructive">{errors.loginId.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">비밀번호</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="비밀번호를 입력하세요"
                  {...register('password', { required: '비밀번호를 입력해주세요' })}
                />
                <button
                  type="button"
                  className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword((prev) => !prev)}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password.message}</p>
              )}
            </div>

            <Button type="submit" disabled={isSubmitting || status === 'testing'}>
              {status === 'testing' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  연결 테스트 중...
                </>
              ) : (
                '연결 테스트'
              )}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

function StatusBadge({ status }: { status: ConnectionStatus }) {
  switch (status) {
    case 'connected':
      return (
        <Badge className={cn('bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400')}>
          <CheckCircle2 className="mr-1 h-3 w-3" />
          연결됨
        </Badge>
      )
    case 'disconnected':
      return (
        <Badge className={cn('bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400')}>
          <XCircle className="mr-1 h-3 w-3" />
          미연결
        </Badge>
      )
    case 'testing':
      return (
        <Badge className={cn('bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400')}>
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          테스트 중
        </Badge>
      )
    default:
      return (
        <Badge variant="secondary">
          상태 확인 중
        </Badge>
      )
  }
}
