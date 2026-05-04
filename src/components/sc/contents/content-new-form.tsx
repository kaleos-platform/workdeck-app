'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
  channels: Option[]
  ideas: IdeaOption[]
}

const NONE = '__none'

export function ContentNewForm({ channels, ideas }: Props) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [channelId, setChannelId] = useState<string>(NONE)
  const [ideaCompoundId, setIdeaCompoundId] = useState<string>(NONE)
  const [targetKeyword, setTargetKeyword] = useState('')
  const [urlSlug, setUrlSlug] = useState('')
  const [body, setBody] = useState('')
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
          channelId: channelId === NONE ? null : channelId,
          ideationId,
          ideaIndex: ideaIndexStr != null ? Number(ideaIndexStr) : null,
          targetKeyword: targetKeyword.trim() || undefined,
          urlSlug: urlSlug.trim() || undefined,
          body: body.trim() || undefined,
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

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="targetKeyword">타겟 키워드</Label>
              <Input
                id="targetKeyword"
                value={targetKeyword}
                onChange={(e) => setTargetKeyword(e.target.value)}
                placeholder="예: B2B SaaS 마케팅"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="urlSlug">URL 슬러그</Label>
              <Input
                id="urlSlug"
                value={urlSlug}
                onChange={(e) => setUrlSlug(e.target.value)}
                placeholder="예: b2b-saas-marketing"
              />
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

          <div className="space-y-1.5">
            <Label htmlFor="body">초안 본문 (선택)</Label>
            <Textarea
              id="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="직접 초안을 입력하거나 비워두면 에디터에서 작성합니다"
              rows={5}
            />
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
