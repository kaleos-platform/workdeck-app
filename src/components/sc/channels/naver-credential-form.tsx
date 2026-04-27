'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Upload, AlertCircle, CheckCircle2, RefreshCw, Info } from 'lucide-react'

type Props = {
  channelId: string
  hasExistingCredential?: boolean
}

// Playwright storageState 최소 구조 타입
interface StorageState {
  cookies?: Array<Record<string, unknown>>
  origins?: Array<Record<string, unknown>>
}

export function NaverCredentialForm({ channelId, hasExistingCredential = false }: Props) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [blogId, setBlogId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null)
    setSuccess(false)
    const selected = e.target.files?.[0] ?? null
    setFile(selected)
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    // blogId 검증
    const trimmedBlogId = blogId.trim()
    if (!trimmedBlogId) {
      setError('블로그 ID를 입력해주세요.')
      return
    }
    // 네이버 블로그 ID 형식 검증 (소문자, 숫자, 하이픈)
    if (!/^[a-z0-9][a-z0-9-]*$/.test(trimmedBlogId)) {
      setError('블로그 ID는 소문자·숫자·하이픈(-)만 허용합니다. (예: meaning-lab)')
      return
    }

    // 파일 검증
    if (!file) {
      setError('storageState JSON 파일을 선택해주세요.')
      return
    }

    // 파일 파싱 및 구조 검증
    let storageState: StorageState
    try {
      const text = await file.text()
      storageState = JSON.parse(text) as StorageState
    } catch {
      setError('JSON 파싱 실패 — 올바른 storageState.json 파일인지 확인해주세요.')
      return
    }

    if (!Array.isArray(storageState.cookies) || storageState.cookies.length === 0) {
      setError('유효한 storageState가 아닙니다 (cookies 없음) — 세션 발급 후 다시 시도해주세요.')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/sc/channels/${channelId}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'COOKIE',
          payload: {
            storageState,
            blogId: trimmedBlogId,
          },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((data as { message?: string })?.message ?? '저장 실패')
        return
      }
      setSuccess(true)
      setFile(null)
      setBlogId('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      router.refresh()
    } catch {
      setError('네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          {hasExistingCredential ? (
            <>
              <RefreshCw className="h-4 w-4 text-muted-foreground" />
              네이버 블로그 세션 재업로드
            </>
          ) : (
            <>
              <Upload className="h-4 w-4 text-muted-foreground" />
              네이버 블로그 세션 업로드
            </>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* 안내 문구 */}
        <div className="mb-4 flex gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs text-sky-700 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            터미널에서{' '}
            <code className="rounded bg-sky-100 px-1 py-0.5 font-mono dark:bg-sky-900">
              npx tsx scripts/sc/acquire-naver-session.ts --auto --out /tmp/naver-session.json
            </code>{' '}
            으로 세션을 먼저 발급해주세요.
          </span>
        </div>

        {/* 기존 자격증명 교체 경고 */}
        {hasExistingCredential && (
          <div className="mb-4 flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>기존 쿠키 자격증명이 새 파일로 교체됩니다.</span>
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          {/* storageState 파일 업로드 */}
          <div className="space-y-1.5">
            <Label htmlFor="storageState">
              storageState.json 파일{' '}
              <span className="text-muted-foreground">(Playwright 세션 파일)</span>
            </Label>
            <Input
              id="storageState"
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleFileChange}
              className="cursor-pointer"
            />
            {file && (
              <p className="text-xs text-muted-foreground">
                선택됨: <span className="font-mono">{file.name}</span> (
                {(file.size / 1024).toFixed(1)} KB)
              </p>
            )}
          </div>

          {/* blogId 입력 */}
          <div className="space-y-1.5">
            <Label htmlFor="blogId">
              블로그 ID <span className="text-muted-foreground">(네이버 블로그 주소의 ID)</span>
            </Label>
            <Input
              id="blogId"
              type="text"
              value={blogId}
              onChange={(e) => setBlogId(e.target.value)}
              placeholder="meaning-lab"
              spellCheck={false}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              예: blog.naver.com/<strong>meaning-lab</strong> → <code>meaning-lab</code>
            </p>
          </div>

          {/* 에러 메시지 */}
          {error && (
            <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* 성공 메시지 */}
          {success && (
            <div className="flex gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>자격증명이 저장되었습니다. 복호화는 워커 프로세스에서만 수행됩니다.</span>
            </div>
          )}

          <div className="flex justify-end">
            <Button type="submit" disabled={submitting || (!file && !success)}>
              {submitting ? (
                '저장 중…'
              ) : hasExistingCredential ? (
                <>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  세션 재업로드
                </>
              ) : (
                <>
                  <Upload className="mr-1.5 h-3.5 w-3.5" />
                  세션 업로드
                </>
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
