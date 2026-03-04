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
    .min(1, '사업자명을 입력해주세요')
    .max(100, '사업자명은 100자 이하로 입력해주세요'),
})

type WorkspaceSetupInput = z.infer<typeof workspaceSetupSchema>

export default function WorkspaceSetupPage() {
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

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
      router.push('/my-deck')
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
        <CardDescription>쿠팡 사업자명을 입력하여 워크스페이스를 생성하세요</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>쿠팡 사업자명</FormLabel>
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
      </CardContent>
    </Card>
  )
}
