'use client'

import { useRef, useState } from 'react'
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

type AspectRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9'

type Asset = {
  id: string
  url: string
  alt: string | null
  slotKey: string | null
}

type Props = {
  contentId: string
  slotKey?: string
  onCreated?: (asset: Asset) => void
}

export function ImagePicker({ contentId, slotKey, onCreated }: Props) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1')
  const [alt, setAlt] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [lastUrl, setLastUrl] = useState<string | null>(null)

  async function onUpload(file: File) {
    setError(null)
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      if (slotKey) form.append('slotKey', slotKey)
      if (alt) form.append('alt', alt)
      const res = await fetch(`/api/sc/contents/${contentId}/assets`, {
        method: 'POST',
        body: form,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.message ?? '업로드 실패')
        return
      }
      setLastUrl(data.asset.url)
      onCreated?.(data.asset)
    } finally {
      setUploading(false)
    }
  }

  async function onGenerate() {
    if (!prompt.trim()) {
      setError('프롬프트를 입력하세요')
      return
    }
    setError(null)
    setGenerating(true)
    try {
      const res = await fetch(`/api/sc/contents/${contentId}/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'ai',
          prompt: prompt.trim(),
          aspectRatio,
          slotKey: slotKey ?? undefined,
          alt: alt || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.message ?? 'AI 이미지 생성 실패')
        return
      }
      setLastUrl(data.asset.url)
      onCreated?.(data.asset)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">이미지 {slotKey ? `(${slotKey})` : ''}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>파일 업로드 (최대 20MB)</Label>
          <Input
            ref={fileInput}
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onUpload(f)
            }}
            disabled={uploading || generating}
          />
        </div>

        <div className="space-y-2 rounded-md border p-3">
          <p className="text-xs font-semibold text-muted-foreground">또는 AI 생성</p>
          <div className="space-y-1.5">
            <Label htmlFor="prompt">프롬프트</Label>
            <Textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="A futuristic office workspace, minimalist, warm light"
              maxLength={4000}
            />
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <Label>비율</Label>
              <Select value={aspectRatio} onValueChange={(v) => setAspectRatio(v as AspectRatio)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1:1">1:1</SelectItem>
                  <SelectItem value="3:4">3:4</SelectItem>
                  <SelectItem value="4:3">4:3</SelectItem>
                  <SelectItem value="9:16">9:16 세로</SelectItem>
                  <SelectItem value="16:9">16:9 가로</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={onGenerate} disabled={uploading || generating}>
              {generating ? '생성 중…' : 'AI 생성'}
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="alt">대체 텍스트 (선택)</Label>
          <Input id="alt" value={alt} onChange={(e) => setAlt(e.target.value)} />
        </div>

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {lastUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={lastUrl}
            alt="preview"
            className="mt-2 max-h-48 rounded border object-contain"
          />
        )}
      </CardContent>
    </Card>
  )
}
