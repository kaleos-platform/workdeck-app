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
import { SALES_CONTENT_TEMPLATES_PATH } from '@/lib/deck-routes'

type Kind = 'BLOG' | 'SOCIAL' | 'CARDNEWS'
type Mode = 'create' | 'edit'

type Props = {
  mode: Mode
  templateId?: string
  initial?: {
    name?: string
    slug?: string
    kind?: Kind
    sections?: unknown
    isActive?: boolean
  }
}

// 템플릿 sections 는 복잡한 구조라 JSON textarea 로 입력받는다.
// 추후 섹션별 CRUD UI 가 필요해지면 이 폼을 쪼개서 대체.
export function TemplateForm({ mode, templateId, initial }: Props) {
  const router = useRouter()
  const [name, setName] = useState(initial?.name ?? '')
  const [slug, setSlug] = useState(initial?.slug ?? '')
  const [kind, setKind] = useState<Kind>(initial?.kind ?? 'BLOG')
  const [isActive, setIsActive] = useState(initial?.isActive ?? true)
  const [sectionsJson, setSectionsJson] = useState(() =>
    JSON.stringify(initial?.sections ?? { sections: [] }, null, 2)
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    let sections: unknown
    try {
      sections = JSON.parse(sectionsJson)
    } catch (err) {
      setError(`sections JSON 파싱 실패: ${err instanceof Error ? err.message : ''}`)
      return
    }

    setSubmitting(true)
    try {
      const url = mode === 'create' ? '/api/sc/templates' : `/api/sc/templates/${templateId}`
      const res = await fetch(url, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, slug, kind, sections, isActive }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.message ?? '저장에 실패했습니다')
        return
      }
      router.push(`${SALES_CONTENT_TEMPLATES_PATH}/${data.template.id}`)
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {mode === 'create' ? '새 템플릿' : '템플릿 편집'}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">이름</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="slug">슬러그</Label>
              <Input
                id="slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                required
                placeholder="my-custom-blog"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>유형</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
              <SelectTrigger className="w-full sm:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BLOG">블로그 장문</SelectItem>
                <SelectItem value="SOCIAL">소셜 텍스트</SelectItem>
                <SelectItem value="CARDNEWS">카드뉴스</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sections">sections (JSON)</Label>
            <Textarea
              id="sections"
              value={sectionsJson}
              onChange={(e) => setSectionsJson(e.target.value)}
              rows={14}
              className="font-mono text-xs"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">
              BLOG/SOCIAL: {'{ "sections": [...] }'} · CARDNEWS:{' '}
              {'{ "slides": [{"index":0,"sections":[...]}] }'}
            </p>
          </div>

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              활성
            </label>
            <Button type="submit" disabled={submitting}>
              {submitting ? '저장 중…' : mode === 'create' ? '생성' : '저장'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
