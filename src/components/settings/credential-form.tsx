'use client'

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Loader2, CheckCircle2, XCircle, Eye, EyeOff, Pencil, X } from 'lucide-react'
import { cn } from '@/lib/utils'

type CredentialFormValues = {
  loginId: string
  password: string
}

type ConnectionStatus = 'connected' | 'disconnected' | 'testing' | 'unknown'

export function CredentialForm() {
  const [status, setStatus] = useState<ConnectionStatus>('unknown')
  const [savedLoginId, setSavedLoginId] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  const {
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { isSubmitting },
  } = useForm<CredentialFormValues>({
    defaultValues: { loginId: '', password: '' },
  })

  useEffect(() => {
    fetch('/api/collection/credentials')
      .then((res) => {
        if (!res.ok) throw new Error()
        return res.json()
      })
      .then((data: { credential?: { loginId?: string }; isConnected?: boolean }) => {
        const loginId = data.credential?.loginId
        if (loginId) {
          setSavedLoginId(loginId)
          setValue('loginId', loginId)
        }
        setStatus(data.isConnected ? 'connected' : 'disconnected')
      })
      .catch(() => setStatus('unknown'))
      .finally(() => setIsLoading(false))
  }, [setValue])

  // 연결 테스트 (저장된 계정)
  async function handleTest() {
    setStatus('testing')
    try {
      const res = await fetch('/api/collection/credentials')
      if (res.ok) {
        const data = await res.json()
        setStatus(data.isConnected ? 'connected' : 'disconnected')
        toast.success(data.isConnected ? '연결이 정상입니다' : '연결 상태를 확인해주세요')
      }
    } catch {
      setStatus('disconnected')
      toast.error('연결 테스트 실패')
    }
  }

  // 계정 정보 저장 (수정 모드)
  async function onSubmit(values: CredentialFormValues) {
    if (!values.loginId.trim() || !values.password.trim()) {
      toast.error('ID와 비밀번호를 모두 입력해주세요')
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
        toast.error((data as { message?: string }).message ?? '저장에 실패했습니다')
        setStatus('disconnected')
        return
      }

      const data = await res.json() as { isConnected?: boolean }
      setSavedLoginId(values.loginId)
      setIsEditing(false)
      setStatus(data.isConnected ? 'connected' : 'disconnected')
      reset({ loginId: values.loginId, password: '' })
      toast.success('계정 정보가 저장되었습니다')
    } catch {
      setStatus('disconnected')
      toast.error('저장 중 오류가 발생했습니다')
    }
  }

  function handleCancelEdit() {
    setIsEditing(false)
    if (savedLoginId) setValue('loginId', savedLoginId)
    reset({ loginId: savedLoginId ?? '', password: '' })
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
        ) : savedLoginId && !isEditing ? (
          /* ─── 연결된 계정 보기 모드 ─── */
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <p className="text-xs text-muted-foreground">연결된 계정</p>
                <p className="mt-1 text-sm font-medium">{savedLoginId}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTest}
                  disabled={status === 'testing'}
                >
                  {status === 'testing' ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                  )}
                  연결 테스트
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsEditing(true)}
                >
                  <Pencil className="mr-1 h-3.5 w-3.5" />
                  수정
                </Button>
              </div>
            </div>
          </div>
        ) : (
          /* ─── 수정/신규 입력 모드 ─── */
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {savedLoginId && (
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">계정 정보 수정</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleCancelEdit}
                >
                  <X className="mr-1 h-3.5 w-3.5" />
                  취소
                </Button>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="loginId">쿠팡 로그인 ID</Label>
              <Input
                id="loginId"
                placeholder="쿠팡 셀러센터 아이디"
                {...register('loginId', { required: true })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">비밀번호</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="비밀번호"
                  {...register('password', { required: true })}
                />
                <button
                  type="button"
                  className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword((p) => !p)}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button type="submit" disabled={isSubmitting || status === 'testing'}>
              {status === 'testing' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  저장 중...
                </>
              ) : (
                '저장'
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
          <CheckCircle2 className="mr-1 h-3 w-3" /> 연결됨
        </Badge>
      )
    case 'disconnected':
      return (
        <Badge className={cn('bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400')}>
          <XCircle className="mr-1 h-3 w-3" /> 미연결
        </Badge>
      )
    case 'testing':
      return (
        <Badge className={cn('bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400')}>
          <Loader2 className="mr-1 h-3 w-3 animate-spin" /> 테스트 중
        </Badge>
      )
    default:
      return <Badge variant="secondary">상태 확인 중</Badge>
  }
}
