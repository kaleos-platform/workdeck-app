'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Plus } from 'lucide-react'

const formSchema = z.object({
  productId: z.string().min(1, '제품을 선택하세요'),
  title: z.string().min(1, '제목을 입력하세요').max(200),
  appealPoint: z.string().min(1, '소구점을 입력하세요').max(300),
  angle: z.string().min(1, '앵글을 입력하세요').max(400),
  targetKeyword: z.string().max(100).optional(),
})

type FormValues = z.infer<typeof formSchema>

type Product = { id: string; name: string }

interface AddMaterialDialogProps {
  products: Product[]
  onSuccess: () => void
}

export function AddMaterialDialog({ products, onSuccess }: AddMaterialDialogProps) {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      productId: '',
      title: '',
      appealPoint: '',
      angle: '',
      targetKeyword: '',
    },
  })

  async function onSubmit(values: FormValues) {
    setSubmitting(true)
    setServerError(null)
    try {
      const res = await fetch('/api/bo/materials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...values,
          outline: [],
          targetKeyword: values.targetKeyword || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { message?: string }).message ?? '등록에 실패했습니다')
      }
      form.reset()
      setOpen(false)
      onSuccess()
    } catch (err) {
      setServerError(err instanceof Error ? err.message : '알 수 없는 오류')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="mr-1 h-4 w-4" />
          소재 직접 등록
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>소재 직접 등록</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="productId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>제품</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="제품을 선택하세요" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>제목</FormLabel>
                  <FormControl>
                    <Input placeholder="블로그 포스팅 제목" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="appealPoint"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>소구점</FormLabel>
                  <FormControl>
                    <Input placeholder="이 소재가 다루는 핵심 소구점" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="angle"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>앵글</FormLabel>
                  <FormControl>
                    <Textarea placeholder="콘텐츠 접근 관점 · 프레임" rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="targetKeyword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>타겟 키워드 (선택)</FormLabel>
                  <FormControl>
                    <Input placeholder="대표 검색 키워드" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {serverError && <p className="text-sm text-destructive">{serverError}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={submitting}
              >
                취소
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? '등록 중...' : '등록'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
