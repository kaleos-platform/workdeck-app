'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, Download, Clipboard, Check, ExternalLink, Send, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'

// ─── 타입 ─────────────────────────────────────────────────────────────────────

type Channel = {
  id: string
  name: string
  platform: string
  publisherMode: 'MANUAL' | 'BROWSER'
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

type BoDeploymentInfo = {
  id: string
  variantId: string
  channelId: string
  status: 'PENDING' | 'PUBLISHING' | 'PUBLISHED' | 'FAILED' | 'CANCELED' | 'EXPORTED'
  platformUrl: string | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
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

// ─── 배포 상태 배지 ────────────────────────────────────────────────────────────

function DeploymentStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'PENDING':
      return (
        <Badge className="bg-slate-100 text-xs text-slate-600 hover:bg-slate-100">
          <Loader2 className="mr-1 h-2.5 w-2.5 animate-spin" />
          대기 중
        </Badge>
      )
    case 'PUBLISHING':
      return (
        <Badge className="bg-yellow-100 text-xs text-yellow-700 hover:bg-yellow-100">
          <Loader2 className="mr-1 h-2.5 w-2.5 animate-spin" />
          게시 중
        </Badge>
      )
    case 'PUBLISHED':
      return (
        <Badge className="bg-emerald-100 text-xs text-emerald-700 hover:bg-emerald-100">
          게시됨
        </Badge>
      )
    case 'FAILED':
      return <Badge className="bg-red-100 text-xs text-red-700 hover:bg-red-100">실패</Badge>
    case 'CANCELED':
      return (
        <Badge variant="secondary" className="text-xs">
          취소됨
        </Badge>
      )
    default:
      return (
        <Badge variant="secondary" className="text-xs">
          {status}
        </Badge>
      )
  }
}

// ─── 변형 미리보기 ─────────────────────────────────────────────────────────────

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

// ─── 인라인 배포 상태 표시 ────────────────────────────────────────────────────

function DeploymentStatusRow({
  deployment,
  onRetry,
}: {
  deployment: BoDeploymentInfo
  onRetry: () => void
}) {
  const [retrying, setRetrying] = useState(false)

  async function handleRetry() {
    setRetrying(true)
    try {
      const res = await fetch(`/api/bo/deployments/${deployment.id}/retry`, { method: 'POST' })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string }
        throw new Error(data.message ?? '재시도 실패')
      }
      toast.success('재시도를 시작했습니다')
      onRetry()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '재시도 실패')
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1.5">
      <DeploymentStatusBadge status={deployment.status} />

      {deployment.status === 'PUBLISHED' && deployment.platformUrl && (
        <a
          href={deployment.platformUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 text-xs text-blue-600 hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
          게시글 보기
        </a>
      )}

      {deployment.status === 'FAILED' && (
        <>
          {deployment.errorMessage && (
            <span
              className="max-w-[200px] truncate text-xs text-destructive"
              title={deployment.errorMessage}
            >
              {deployment.errorMessage}
            </span>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-6 gap-0.5 px-1.5 text-xs"
            disabled={retrying}
            onClick={() => void handleRetry()}
          >
            {retrying ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RotateCcw className="h-3 w-3" />
            )}
            재시도
          </Button>
        </>
      )}
    </div>
  )
}

// ─── 채널 행 ───────────────────────────────────────────────────────────────────

function ChannelRow({
  channel,
  variant,
  postId,
  canGenerate,
  deployment,
  hasCredential,
  onVariantCreated,
  onPublished,
}: {
  channel: Channel
  variant: Variant | null
  postId: string
  canGenerate: boolean
  deployment: BoDeploymentInfo | null
  hasCredential: boolean
  onVariantCreated: () => void
  onPublished: () => void
}) {
  const [generating, setGenerating] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  const isGenerating = variant?.status === 'GENERATING'
  const canExport = variant?.status === 'READY' || variant?.status === 'EDITED'
  const canPublish =
    canExport &&
    channel.publisherMode === 'BROWSER' &&
    hasCredential &&
    (!deployment || deployment.status === 'FAILED' || deployment.status === 'CANCELED')

  // 발행 버튼 비활성 이유 안내 tooltip 텍스트
  function publishDisabledTitle(): string | undefined {
    if (!canExport) return 'READY 또는 EDITED 상태의 변형만 발행할 수 있습니다'
    if (channel.publisherMode !== 'BROWSER') return 'BROWSER 모드 채널에서만 자동 발행이 가능합니다'
    if (!hasCredential) return '채널에 자격증명을 등록해 주세요 (채널 설정)'
    if (deployment && (deployment.status === 'PENDING' || deployment.status === 'PUBLISHING'))
      return '현재 게시 중입니다'
    return undefined
  }

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

  async function handlePublish() {
    if (!variant) return
    setPublishing(true)
    try {
      const res = await fetch(`/api/bo/variants/${variant.id}/publish`, { method: 'POST' })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string }
        throw new Error(data.message ?? '발행 요청 실패')
      }
      toast.success('발행을 시작했습니다')
      onPublished()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '발행 요청 실패')
    } finally {
      setPublishing(false)
    }
  }

  const isDeployingActive = deployment?.status === 'PENDING' || deployment?.status === 'PUBLISHING'

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
          {channel.publisherMode === 'BROWSER' && (
            <span className="text-xs text-muted-foreground">브라우저 자동</span>
          )}
        </div>

        {/* 액션 버튼 */}
        <div className="flex items-center gap-1.5">
          {/* 변형 미리보기 토글 */}
          {variant && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setShowPreview((v) => !v)}
            >
              {showPreview ? '숨기기' : '미리보기'}
            </button>
          )}

          {/* 변형 생성 버튼 */}
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

          {/* 발행 버튼 — BROWSER 모드 채널 + 자격증명 있을 때 활성 */}
          {channel.publisherMode === 'BROWSER' && variant && (
            <Button
              size="sm"
              variant={canPublish ? 'default' : 'outline'}
              className="h-7 gap-1 px-2 text-xs"
              disabled={!canPublish || publishing || isDeployingActive}
              onClick={() => void handlePublish()}
              title={publishDisabledTitle()}
            >
              {publishing || isDeployingActive ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Send className="h-3 w-3" />
              )}
              발행
            </Button>
          )}
        </div>
      </div>

      {/* 미리보기 */}
      {showPreview && variant && <VariantPreview variant={variant} />}

      {/* 내보내기 버튼 */}
      {canExport && variant && !isDeployingActive && <ExportButtons variantId={variant.id} />}

      {/* 배포 상태 인라인 표시 */}
      {deployment && <DeploymentStatusRow deployment={deployment} onRetry={onPublished} />}

      {/* 변형 생성 중 안내 */}
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
  const [deployments, setDeployments] = useState<BoDeploymentInfo[]>([])
  const [credentialChannelIds, setCredentialChannelIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  // PUBLISH_APPROVED 상태에서만 변형 생성 가능
  const canGenerate = postStatus === 'PUBLISH_APPROVED'

  const fetchData = useCallback(async () => {
    try {
      const [chRes, varRes, depRes] = await Promise.all([
        fetch('/api/bo/channels'),
        fetch(`/api/bo/posts/${postId}/variants`),
        fetch('/api/bo/deployments'),
      ])

      let activeChannels: Channel[] = []
      if (chRes.ok) {
        const data = (await chRes.json()) as { channels: Channel[] }
        activeChannels = data.channels.filter((c) => c.isActive)
        setChannels(activeChannels)
      }

      if (varRes.ok) {
        const data = (await varRes.json()) as { variants: Variant[] }
        setVariants(data.variants)
      }

      if (depRes.ok) {
        // 배포 목록에서 이 포스트 관련 배포 필터링
        const data = (await depRes.json()) as {
          deployments: Array<{
            id: string
            status: string
            platformUrl: string | null
            variant: { id: string }
            channel: { id: string }
            post: { id: string }
            createdAt: string
          }>
        }
        // 이 포스트에 속한 배포만 필터링
        const postDeps = data.deployments.filter((d) => d.post.id === postId)
        setDeployments(
          postDeps.map((d) => ({
            id: d.id,
            variantId: d.variant.id,
            channelId: d.channel.id,
            status: d.status as BoDeploymentInfo['status'],
            platformUrl: d.platformUrl,
            errorCode: null,
            errorMessage: null,
            createdAt: d.createdAt,
          }))
        )
      }

      // BROWSER 모드 채널에 대해 자격증명 존재 여부 확인
      const browserChannels = activeChannels.filter((c) => c.publisherMode === 'BROWSER')
      if (browserChannels.length > 0) {
        const credResults = await Promise.allSettled(
          browserChannels.map((c) =>
            fetch(`/api/bo/channels/${c.id}/credentials`)
              .then((r) => r.json())
              .then((d: unknown) => {
                const data = d as { credentials: unknown[] }
                return { channelId: c.id, hasCredential: data.credentials.length > 0 }
              })
          )
        )
        const credSet = new Set<string>()
        for (const result of credResults) {
          if (result.status === 'fulfilled' && result.value.hasCredential) {
            credSet.add(result.value.channelId)
          }
        }
        setCredentialChannelIds(credSet)
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

  // GENERATING 변형 폴링
  useEffect(() => {
    const hasGenerating = variants.some((v) => v.status === 'GENERATING')
    if (!hasGenerating) return
    const timer = setTimeout(() => void fetchData(), 5000)
    return () => clearTimeout(timer)
  }, [variants, fetchData])

  // PENDING/PUBLISHING 배포 폴링 (5초)
  useEffect(() => {
    const hasActive = deployments.some((d) => d.status === 'PENDING' || d.status === 'PUBLISHING')
    if (!hasActive) return
    const timer = setTimeout(() => void fetchData(), 5000)
    return () => clearTimeout(timer)
  }, [deployments, fetchData])

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
        // 이 채널의 가장 최근 배포 (변형 id 또는 채널 id 기준)
        const channelDeployments = deployments
          .filter((d) => d.channelId === ch.id)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        const latestDeployment = channelDeployments[0] ?? null

        return (
          <ChannelRow
            key={ch.id}
            channel={ch}
            variant={variant}
            postId={postId}
            canGenerate={canGenerate}
            deployment={latestDeployment}
            hasCredential={credentialChannelIds.has(ch.id)}
            onVariantCreated={() => void fetchData()}
            onPublished={() => void fetchData()}
          />
        )
      })}
    </div>
  )
}
