'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Link2, FileText, Trash2, Upload, Loader2, ImagePlus, AlertCircle } from 'lucide-react'
import type { OnboardingResourceData } from './types'

const MAX_RESOURCES = 10

type Props = {
  resources: OnboardingResourceData[]
  onResourcesChange: (next: OnboardingResourceData[]) => void
  logoUrl: string | null
  onLogoChange: (url: string) => void
}

function statusBadge(resource: OnboardingResourceData) {
  if (resource.status === 'DONE') {
    return (
      <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
        완료
      </Badge>
    )
  }
  if (resource.status === 'FAILED') {
    const badge = (
      <Badge variant="outline" className="border-destructive/40 text-destructive">
        실패
      </Badge>
    )
    if (!resource.errorMessage) return badge
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1">
              {badge}
              <AlertCircle className="h-3.5 w-3.5 text-destructive" />
            </span>
          </TooltipTrigger>
          <TooltipContent>{resource.errorMessage}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      대기 중
    </Badge>
  )
}

export function StepResources({ resources, onResourcesChange, logoUrl, onLogoChange }: Props) {
  const [url, setUrl] = useState('')
  const [addingUrl, setAddingUrl] = useState(false)
  const [uploadingFile, setUploadingFile] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)

  const atLimit = resources.length >= MAX_RESOURCES

  async function addUrl() {
    const trimmed = url.trim()
    if (!trimmed) return
    setAddingUrl(true)
    try {
      const res = await fetch('/api/sc/onboarding/resources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'URL', url: trimmed }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.message || 'URL 등록 실패')
      onResourcesChange([...resources, json.resource])
      setUrl('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'URL 등록 실패')
    } finally {
      setAddingUrl(false)
    }
  }

  async function uploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (!file) return
    setUploadingFile(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/sc/onboarding/resources', { method: 'POST', body: form })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.message || '파일 업로드 실패')
      onResourcesChange([...resources, json.resource])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '파일 업로드 실패')
    } finally {
      setUploadingFile(false)
    }
  }

  async function uploadLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (logoInputRef.current) logoInputRef.current.value = ''
    if (!file) return
    setUploadingLogo(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/sc/onboarding/logo', { method: 'POST', body: form })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.message || '로고 업로드 실패')
      onLogoChange(json.logoUrl)
      toast.success('로고를 업로드했습니다.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '로고 업로드 실패')
    } finally {
      setUploadingLogo(false)
    }
  }

  async function removeResource(id: string) {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/sc/onboarding/resources/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('삭제 실패')
      onResourcesChange(resources.filter((r) => r.id !== id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">회사·상품 자료를 등록하세요</h2>
        <p className="text-sm text-muted-foreground">
          홈페이지 URL이나 소개서(PDF·문서)를 등록하면 AI가 브랜드 프로필·상품·페르소나 초안을
          만들어 드립니다. PDF는 텍스트 추출을 지원하며, 스캔된 이미지형 PDF는 추출되지 않을 수
          있습니다.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">회사 로고 (선택)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- 외부 Supabase Storage URL, next.config remotePatterns 미설정
                <img src={logoUrl} alt="회사 로고" className="h-full w-full object-cover" />
              ) : (
                <ImagePlus className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
            <div className="space-y-1.5">
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={uploadLogo}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploadingLogo}
                onClick={() => logoInputRef.current?.click()}
              >
                {uploadingLogo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {logoUrl ? '로고 변경' : '로고 업로드'}
              </Button>
              <p className="text-xs text-muted-foreground">PNG·JPG·WebP·SVG, 최대 2MB</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">자료 등록 ({resources.length}/{MAX_RESOURCES})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://company.com"
              disabled={atLimit || addingUrl}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void addUrl()
                }
              }}
            />
            <Button type="button" onClick={addUrl} disabled={atLimit || addingUrl || !url.trim()}>
              {addingUrl ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              URL 추가
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.ppt,.pptx,.hwp,.txt"
              className="hidden"
              onChange={uploadFile}
            />
            <Button
              type="button"
              variant="outline"
              disabled={atLimit || uploadingFile}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploadingFile ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              문서 업로드
            </Button>
            <p className="text-xs text-muted-foreground">PDF·doc·ppt·hwp·txt, 최대 10MB</p>
          </div>

          {atLimit && (
            <p className="text-xs text-destructive">최대 {MAX_RESOURCES}개까지 등록할 수 있습니다.</p>
          )}

          {resources.length > 0 && (
            <ul className="divide-y rounded-md border">
              {resources.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    {r.kind === 'URL' ? (
                      <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate text-sm">
                      {r.kind === 'URL' ? r.sourceUrl : r.fileName}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {statusBadge(r)}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={deletingId === r.id}
                      onClick={() => removeResource(r.id)}
                      aria-label="리소스 삭제"
                    >
                      {deletingId === r.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
