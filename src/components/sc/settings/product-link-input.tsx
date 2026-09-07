'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { ProductFormState } from './product-form'

// 상품 링크 → 추출. 봇 차단·JS 렌더링 페이지는 서버가 recovery:'paste' 를 주므로
// 그때 붙여넣기 입력으로 전환한다.

type Props = {
  onExtracted: (draft: Partial<ProductFormState>) => void
  onLoadingChange: (loading: boolean) => void
}

export function ProductLinkInput({ onExtracted, onLoadingChange }: Props) {
  const [url, setUrl] = useState('')
  const [pastedText, setPastedText] = useState('')
  const [showPaste, setShowPaste] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settingsPath, setSettingsPath] = useState<string | null>(null)

  async function extract() {
    setBusy(true)
    onLoadingChange(true)
    setError(null)
    setSettingsPath(null)
    try {
      const res = await fetch('/api/sc/products/extract', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: url.trim() || undefined,
          pastedText: showPaste && pastedText.trim() ? pastedText.trim() : undefined,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (json.recovery === 'paste') setShowPaste(true)
        if (json.settingsPath) setSettingsPath(json.settingsPath)
        throw new Error(json.message || '상품 정보를 가져오지 못했습니다')
      }
      onExtracted(json.draft)
    } catch (err) {
      setError(err instanceof Error ? err.message : '상품 정보를 가져오지 못했습니다')
    } finally {
      setBusy(false)
      onLoadingChange(false)
    }
  }

  const canSubmit = showPaste ? pastedText.trim().length >= 50 : url.trim().length > 0

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="sc-product-url">상품 페이지 주소</Label>
        <Input
          id="sc-product-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSubmit && !busy) {
              e.preventDefault()
              void extract()
            }
          }}
        />
        <p className="text-xs text-muted-foreground">
          쇼핑몰·브랜드 상세페이지 주소를 넣으면 상품명·특징·인증 정보를 정리합니다.
        </p>
      </div>

      {showPaste && (
        <div className="space-y-1.5">
          <Label htmlFor="sc-product-paste">상세 내용 붙여넣기</Label>
          <Textarea
            id="sc-product-paste"
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            rows={8}
            placeholder="브라우저에서 상품 상세 내용을 복사해 붙여넣으세요 (50자 이상)"
          />
        </div>
      )}

      {error && (
        <div className="space-y-1 text-sm text-destructive">
          <p>{error}</p>
          {settingsPath && (
            <Link href={settingsPath} className="underline underline-offset-2">
              AI 설정으로 이동
            </Link>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        {!showPaste ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowPaste(true)}>
            직접 붙여넣기
          </Button>
        ) : (
          <span />
        )}
        <Button type="button" onClick={extract} disabled={!canSubmit || busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy ? '분석 중…' : '정보 가져오기'}
        </Button>
      </div>
    </div>
  )
}
