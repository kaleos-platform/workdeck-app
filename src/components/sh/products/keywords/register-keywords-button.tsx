'use client'

import { useState } from 'react'
import { BookmarkPlus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { createKeywords, summarizeKeywordCreate } from './create-keywords'

type LinkTarget =
  | { productId: string; listingId?: never }
  | { listingId: string; productId?: never }

type Props = {
  /** 화면에서 편집 중인 채널 검색어 */
  keywords: string[]
  /**
   * 함께 만들 KeywordMasterLink 대상. 생략하면 키워드만 등록한다
   * (혼합 구성처럼 귀속 상품이 하나로 특정되지 않는 경우).
   */
  linkTarget?: LinkTarget
  /** 연결 대상 설명 문구. linkTarget 이 있을 때만 쓰인다. */
  linkTargetLabel?: string
  disabled?: boolean
}

/**
 * 채널 검색어 → 키워드 마스터 단방향 등록.
 *
 * `ProductListing.keywords`(채널에 실제 등록된 검색어)와 `KeywordMaster`(space 후보 풀)는
 * **동기화하지 않는다**(prisma/schema.prisma 의 KeywordMaster 주석). 그래서 자동 반영이
 * 아니라 사용자가 명시적으로 누르는 이 액션 하나만 둔다. 반대 방향(마스터 → 리스팅)은
 * KeywordEditor 의 추천 칩이 담당한다.
 *
 * 상태는 SEARCH_TERM(이미 채널 검색어로 쓰는 중), 출처는 INTERNAL 로 고정한다 —
 * 이 경로로 들어오는 값은 정의상 둘 다 확정이라 사용자에게 물을 것이 없다.
 */
export function RegisterKeywordsButton({ keywords, linkTarget, linkTargetLabel, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const targets = Array.from(
    new Map(
      keywords
        .map((k) => k.trim())
        .filter(Boolean)
        .map((k) => [k.toLowerCase(), k])
    ).values()
  )

  async function handleConfirm() {
    if (targets.length === 0) return
    setSaving(true)
    try {
      const result = await createKeywords(targets, {
        status: 'SEARCH_TERM',
        source: 'INTERNAL',
      })

      let linked = 0
      if (linkTarget) {
        for (const keywordId of result.keywordIds) {
          try {
            const res = await fetch('/api/sh/keywords/links', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ keywordId, ...linkTarget }),
            })
            if (res.ok) linked += 1
          } catch {
            // 연결 실패는 키워드 등록 자체를 되돌리지 않는다 — 요약에 건수로만 드러낸다
          }
        }
      }

      const summary = summarizeKeywordCreate(result)
      const message = linkTarget ? `${summary} · ${linked}건 연결` : summary
      if (result.failed.length > 0) toast.warning(message)
      else toast.success(message)
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1"
        disabled={disabled || targets.length === 0}
        onClick={() => setOpen(true)}
      >
        <BookmarkPlus className="h-4 w-4" aria-hidden="true" />
        키워드 마스터에 등록
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (saving) return
          setOpen(next)
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>키워드 마스터에 등록</DialogTitle>
            <DialogDescription>
              지금 화면에 있는 검색어 {targets.length}개를 키워드 마스터에 후보로 담습니다. 상태는
              &lsquo;검색어&rsquo;, 출처는 &lsquo;내부 아이디어&rsquo;로 등록되며, 이미 있는
              키워드는 그대로 둡니다. 이 동작은 검색어를 바꾸지 않습니다.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-60 overflow-y-auto rounded-md border p-2">
            <div className="flex flex-wrap gap-1.5">
              {targets.map((k) => (
                <Badge key={k} variant="secondary" className="font-normal">
                  {k}
                </Badge>
              ))}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            {linkTarget
              ? `등록과 함께 ${linkTargetLabel ?? '이 대상'}에 연결합니다.`
              : '귀속 대상이 하나로 정해지지 않아 연결 없이 키워드만 등록합니다.'}
          </p>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              취소
            </Button>
            <Button type="button" onClick={handleConfirm} disabled={saving}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />}
              등록
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
