'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, Download, Clipboard, Check } from 'lucide-react'
import { toast } from 'sonner'

// ─── 타입 ─────────────────────────────────────────────────────────────────────

type Channel = {
  id: string
  name: string
  platform: string
  isActive: boolean
}

type Variant = {
  id: string
  channelId: string
  channel: { name: string; platform: string }
  title: string
  status: 'GENERATING' | 'READY' | 'EDITED' | 'FAILED'
  updatedAt: string
  doc: unknown
}

type Props = {
  postId: string
  postStatus: string
}

// ─── 플랫폼 라벨 ───────────────────────────────────────────────────────────────

function platformLabel(platform: string): string {
  switch (platform) {
    case 'NAVER_BLOG':
      return '네이버 블로그'
    case 'TISTORY':
      return '티스토리'
    case 'OWN_HOMEPAGE':
      return '자사 홈페이지'
    default:
      return platform
  }
}

// ─── 상태 배지 ─────────────────────────────────────────────────────────────────

function VariantStatusBadge({ status }: { status: string | null }) {
  if (!status) {
    return (
      <Badge variant="secondary" className="text-xs">
        미생성
      </Badge>
    )
  }
  switch (status) {
    case 'GENERATING':
      return <Badge className="bg-blue-100 text-xs text-blue-700 hover:bg-blue-100">생성 중</Badge>
    case 'READY':
      return (
        <Badge className="bg-emerald-100 text-xs text-emerald-700 hover:bg-emerald-100">
          준비 완료
        </Badge>
      )
    case 'EDITED':
      return (
        <Badge className="bg-amber-100 text-xs text-amber-700 hover:bg-amber-100">편집됨</Badge>
      )
    case 'FAILED':
      return <Badge className="bg-red-100 text-xs text-red-700 hover:bg-red-100">실패</Badge>
    default:
      return (
        <Badge variant="secondary" className="text-xs">
          {status}
        </Badge>
      )
  }
}

// ─── 변형 미리보기 ─────────────────────────────────────────────────────────────

// 제목 + 상태만 표시 (doc 렌더링은 서버 전용)
function VariantPreview({ variant }: { variant: Variant }) {
  return (
    <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
      <p className="mb-1 font-medium text-foreground">{variant.title}</p>
      <p className="text-xs">
        상태: {variant.status} · 수정:{' '}
        {new Date(variant.updatedAt).toLocaleString('ko-KR', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </p>
    </div>
  )
}

// ─── 내보내기 버튼 그룹 ────────────────────────────────────────────────────────

function ExportButtons({ variantId }: { variantId: string }) {
  const [exporting, setExporting] = useState<'markdown' | 'html' | 'clipboard' | null>(null)
  const [copied, setCopied] = useState(false)

  async function fetchContent(format: 'markdown' | 'html'): Promise<string | null> {
    try {
      const res = await fetch(`/api/bo/variants/${variantId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string }
        throw new Error(data.message ?? '내보내기 실패')
      }
      const data = (await res.json()) as { content: string }
      return data.content
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '내보내기 실패')
      return null
    }
  }

  function downloadBlob(content: string, filename: string, mimeType: string) {
    const blob = new Blob([content], { type: `${mimeType}; charset=utf-8` })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleMarkdownDownload() {
    setExporting('markdown')
    const content = await fetchContent('markdown')
    if (content) {
      downloadBlob(content, 'variant.md', 'text/markdown')
      toast.success('마크다운 다운로드 완료')
    }
    setExporting(null)
  }

  async function handleHtmlDownload() {
    setExporting('html')
    const content = await fetchContent('html')
    if (content) {
      downloadBlob(content, 'variant.html', 'text/html')
      toast.success('HTML 다운로드 완료')
    }
    setExporting(null)
  }

  async function handleClipboard() {
    setExporting('clipboard')
    const content = await fetchContent('markdown')
    if (content) {
      try {
        await navigator.clipboard.writeText(content)
        setCopied(true)
        toast.success('클립보드에 복사되었습니다')
        setTimeout(() => setCopied(false), 2000)
      } catch {
        toast.error('클립보드 복사 실패')
      }
    }
    setExporting(null)
  }

  const isLoading = exporting !== null

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button
        size="sm"
        variant="outline"
        className="h-7 gap-1 px-2 text-xs"
        disabled={isLoading}
        onClick={() => void handleMarkdownDownload()}
      >
        {exporting === 'markdown' ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Download className="h-3 w-3" />
        )}
        MD 다운로드
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-7 gap-1 px-2 text-xs"
        disabled={isLoading}
        onClick={() => void handleHtmlDownload()}
      >
        {exporting === 'html' ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Download className="h-3 w-3" />
        )}
        HTML 다운로드
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-7 gap-1 px-2 text-xs"
        disabled={isLoading}
        onClick={() => void handleClipboard()}
      >
        {exporting === 'clipboard' ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : copied ? (
          <Check className="h-3 w-3 text-emerald-600" />
        ) : (
          <Clipboard className="h-3 w-3" />
        )}
        복사
      </Button>
    </div>
  )
}

// ─── 채널 행 ───────────────────────────────────────────────────────────────────

function ChannelRow({
  channel,
  variant,
  postId,
  canGenerate,
  onVariantCreated,
}: {
  channel: Channel
  variant: Variant | null
  postId: string
  canGenerate: boolean
  onVariantCreated: () => void
}) {
  const [generating, setGenerating] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  const isGenerating = variant?.status === 'GENERATING'
  const canExport = variant?.status === 'READY' || variant?.status === 'EDITED'

  async function handleGenerate() {
    setGenerating(true)
    try {
      const res = await fetch(`/api/bo/posts/${postId}/variants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: channel.id }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string }
        throw new Error(data.message ?? '변형 생성 실패')
      }
      toast.success('변형 생성을 시작했습니다')
      onVariantCreated()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '변형 생성 실패')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="space-y-2 rounded-md border px-3 py-2.5">
      {/* 채널 정보 행 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{channel.name}</span>
          <Badge variant="outline" className="text-xs">
            {platformLabel(channel.platform)}
          </Badge>
          <VariantStatusBadge status={variant?.status ?? null} />
        </div>

        {/* 액션 버튼 */}
        <div className="flex items-center gap-1.5">
          {/* 변형이 있으면 미리보기 토글 */}
          {variant && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setShowPreview((v) => !v)}
            >
              {showPreview ? '숨기기' : '미리보기'}
            </button>
          )}

          {/* 생성 버튼 — PUBLISH_APPROVED이고 이미 GENERATING 중이 아닐 때만 활성 */}
          {!variant || variant.status === 'FAILED' ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              disabled={!canGenerate || generating || isGenerating}
              onClick={() => void handleGenerate()}
              title={!canGenerate ? 'PUBLISH_APPROVED 상태에서만 생성 가능합니다' : undefined}
            >
              {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : '변형 생성'}
            </Button>
          ) : null}
        </div>
      </div>

      {/* 미리보기 */}
      {showPreview && variant && <VariantPreview variant={variant} />}

      {/* 내보내기 버튼 */}
      {canExport && variant && <ExportButtons variantId={variant.id} />}

      {/* 생성 중 안내 */}
      {isGenerating && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          AI가 채널에 맞는 변형을 생성하고 있습니다…
        </p>
      )}
    </div>
  )
}

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export function VariantsTabPanel({ postId, postStatus }: Props) {
  const [channels, setChannels] = useState<Channel[]>([])
  const [variants, setVariants] = useState<Variant[]>([])
  const [loading, setLoading] = useState(true)

  // PUBLISH_APPROVED 상태에서만 변형 생성 가능
  const canGenerate = postStatus === 'PUBLISH_APPROVED'

  const fetchData = useCallback(async () => {
    try {
      const [chRes, varRes] = await Promise.all([
        fetch('/api/bo/channels'),
        fetch(`/api/bo/posts/${postId}/variants`),
      ])
      if (chRes.ok) {
        const data = (await chRes.json()) as { channels: Channel[] }
        setChannels(data.channels.filter((c) => c.isActive))
      }
      if (varRes.ok) {
        const data = (await varRes.json()) as { variants: Variant[] }
        setVariants(data.variants)
      }
    } catch {
      // 무시
    } finally {
      setLoading(false)
    }
  }, [postId])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  // GENERATING 중인 변형이 있으면 폴링
  useEffect(() => {
    const hasGenerating = variants.some((v) => v.status === 'GENERATING')
    if (!hasGenerating) return

    const timer = setTimeout(() => void fetchData(), 5000)
    return () => clearTimeout(timer)
  }, [variants, fetchData])

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        불러오는 중…
      </div>
    )
  }

  if (channels.length === 0) {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        활성 채널이 없습니다. 채널을 먼저 추가해 주세요.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {!canGenerate && (
        <p className="text-xs text-muted-foreground">
          포스트가 <strong>PUBLISH_APPROVED</strong> 상태일 때 변형을 생성할 수 있습니다.
        </p>
      )}
      {channels.map((ch) => {
        const variant = variants.find((v) => v.channelId === ch.id) ?? null
        return (
          <ChannelRow
            key={ch.id}
            channel={ch}
            variant={variant}
            postId={postId}
            canGenerate={canGenerate}
            onVariantCreated={() => void fetchData()}
          />
        )
      })}
    </div>
  )
}
