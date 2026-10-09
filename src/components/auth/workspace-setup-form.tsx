'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { resolveRedirectPath } from '@/lib/auth-redirect'
import { useAuth } from '@/hooks/use-auth'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'

// 워크스페이스 생성 스키마
const workspaceSetupSchema = z.object({
  name: z
    .string()
    .min(1, '워크스페이스 이름을 입력해주세요')
    .max(100, '워크스페이스 이름은 100자 이하로 입력해주세요'),
})

type WorkspaceSetupInput = z.infer<typeof workspaceSetupSchema>

export function WorkspaceSetupForm({ redirectTo }: { redirectTo: string | null }) {
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()
  const { user, signOut } = useAuth()
  // 마케팅 랜딩에서 특정 업무를 보고 가입한 경우 워크스페이스 생성 후 그 업무로 이어진다.
  const nextPath = resolveRedirectPath(redirectTo)

  const form = useForm<WorkspaceSetupInput>({
    resolver: zodResolver(workspaceSetupSchema),
    defaultValues: {
      name: '',
    },
  })

  async function onSubmit(data: WorkspaceSetupInput) {
    setIsLoading(true)

    try {
      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: data.name }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || '워크스페이스 생성에 실패했습니다')
      }

      toast.success('워크스페이스가 생성되었습니다!')
      router.push(nextPath)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '워크스페이스 생성에 실패했습니다')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl font-bold">워크스페이스 설정</CardTitle>
        <CardDescription>사업자명(상호)을 워크스페이스 이름으로 입력하세요</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>워크스페이스 이름</FormLabel>
                  <FormControl>
                    <Input placeholder="예: 홍길동 스토어" disabled={isLoading} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" className="w-full" disabled={isLoading} size="lg">
              {isLoading ? '생성 중...' : '워크스페이스 생성'}
            </Button>
          </form>
        </Form>
        <div className="mt-6 border-t pt-4 text-center text-sm text-muted-foreground">
          {user?.email && (
            <p className="mb-2">
              로그인 계정: <span className="break-all text-foreground">{user.email}</span>
            </p>
          )}
          <button
            type="button"
            onClick={signOut}
            disabled={isLoading}
            className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
          >
            로그아웃하고 다른 계정으로 로그인
          </button>
        </div>
      </CardContent>
    </Card>
  )
}
