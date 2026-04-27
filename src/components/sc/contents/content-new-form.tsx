'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SALES_CONTENT_CONTENTS_PATH } from '@/lib/deck-routes'

type Option = { id: string; name: string; kind?: string }
type IdeaOption = { ideationId: string; ideaIndex: number; title: string }

type Props = {
  templates: Option[]
  products: Option[]
  personas: Option[]
  channels: Option[]
  ideas: IdeaOption[]
}

const NONE = '__none'

export function ContentNewForm({ templates, products, personas, channels, ideas }: Props) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [templateId, setTemplateId] = useState<string>(NONE)
  const [productId, setProductId] = useState<string>(NONE)
  const [personaId, setPersonaId] = useState<string>(NONE)
  const [channelId, setChannelId] = useState<string>(NONE)
  const [ideaCompoundId, setIdeaCompoundId] = useState<string>(NONE)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const [ideationId, ideaIndexStr] =
        ideaCompoundId === NONE ? [null, null] : ideaCompoundId.split('::')
      const res = await fetch('/api/sc/contents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim() || '제목 없음',
          templateId: templateId === NONE ? null : templateId,
          productId: productId === NONE ? null : productId,
          personaId: personaId === NONE ? null : personaId,
          channelId: channelId === NONE ? null : channelId,
          ideationId,
          ideaIndex: ideaIndexStr != null ? Number(ideaIndexStr) : null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.message ?? '생성에 실패했습니다')
        return
      }
      router.push(`${SALES_CONTENT_CONTENTS_PATH}/${data.content.id}/edit`)
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">새 콘텐츠</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="title">제목</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="콘텐츠 제목 (글감 선택 시 자동 채움)"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>글감 (선택)</Label>
              <Select value={ideaCompoundId} onValueChange={setIdeaCompoundId}>
                <SelectTrigger>
                  <SelectValue placeholder="글감 선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>선택 안 함</SelectItem>
                  {ideas.map((i) => (
                    <SelectItem
                      key={`${i.ideationId}::${i.ideaIndex}`}
                      value={`${i.ideationId}::${i.ideaIndex}`}
                    >
                      {i.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>템플릿</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger>
                  <SelectValue placeholder="템플릿 선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>빈 문서</SelectItem>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>상품</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger>
                  <SelectValue placeholder="상품" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>선택 안 함</SelectItem>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>페르소나</Label>
              <Select value={personaId} onValueChange={setPersonaId}>
                <SelectTrigger>
                  <SelectValue placeholder="페르소나" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>선택 안 함</SelectItem>
                  {personas.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>배포 채널 (선택)</Label>
            <Select value={channelId} onValueChange={setChannelId}>
              <SelectTrigger>
                <SelectValue placeholder="채널" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>선택 안 함</SelectItem>
                {channels.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex justify-end">
            <Button type="submit" disabled={submitting}>
              {submitting ? '생성 중…' : '콘텐츠 생성'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
