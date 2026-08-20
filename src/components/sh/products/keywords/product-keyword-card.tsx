'use client'

// 상품 축 키워드 화면의 채널 카드 하나 — 채널 하나의 상품명 2종 + 키워드를 한 카드에서
// 편집하고 저장까지 한다. 리스팅 폼으로 튕겨 보내지 않는다("한번에 관리하는 공간" 요건).

import { useMemo, useState } from 'react'
import { Loader2, Lock } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { resolveKeywordRules, rulesForNameField, withChannelDefaults } from '@/lib/sh/keyword-rules'
import { diffKeywordChange } from '@/lib/sh/keyword-change'

import { KeywordChangeDialog, type KeywordChangeMeta } from '../listings/keyword-change-dialog'
import { KeywordEditor } from '../listings/keyword-editor'
import { NameCounter } from '../listings/name-counter'
import { NameValidationPanel } from '../listings/name-validation-panel'

const MAX_NAME_LENGTH = 200

/** 서버가 상품 축 키워드 화면에 내려주는 카드 하나. 다음 태스크(화면 셸)가 이 타입으로 목록을 그린다. */
export type KeywordCard = {
  kind: 'channelProduct' | 'listing'
  id: string // kind 에 따라 channelProductId 또는 listingId
  channelId: string
  channelName: string
  externalSource: string | null // non-null 이면 연동 채널 = 읽기전용 미러
  searchName: string
  displayName: string | null
  keywords: string[]
  listingCount: number
}

type Props = {
  card: KeywordCard
  onSaved: () => void
}

export function ProductKeywordCard({ card, onSaved }: Props) {
  const readOnly = card.externalSource != null

  const [searchName, setSearchName] = useState(card.searchName)
  const [displayName, setDisplayName] = useState(card.displayName ?? '')
  const [keywords, setKeywords] = useState<string[]>(card.keywords)
  const [saving, setSaving] = useState(false)
  const [gateOpen, setGateOpen] = useState(false)

  // 채널 기준 규칙셋. DB 오버라이드(ChannelKeywordRule)는 아직 서버에서 폼으로 내려오는
  // 경로가 없어 resolveKeywordRules(null) 로 기본값만 쓴다.
  const rules = useMemo(
    () =>
      withChannelDefaults(resolveKeywordRules(null), {
        name: card.channelName,
        externalSource: card.externalSource,
      }),
    [card.channelName, card.externalSource]
  )
  const searchNameRules = useMemo(() => rulesForNameField(rules, 'searchName'), [rules])
  const displayNameRules = useMemo(() => rulesForNameField(rules, 'displayName'), [rules])

  const diff = useMemo(
    () =>
      diffKeywordChange({
        beforeName: card.searchName,
        afterName: searchName,
        beforeKeywords: card.keywords,
        afterKeywords: keywords,
      }),
    [card.searchName, card.keywords, searchName, keywords]
  )
  const dirty =
    searchName !== card.searchName ||
    displayName !== (card.displayName ?? '') ||
    diff.keywordsChanged
  // 게이트는 서버의 기록 조건과 같은 함수(diffKeywordChange)로 판정한다 — searchName·keywords 만
  // 본다. displayName(노출용 상품명)은 KeywordChangeLog 대상이 아니라서, 여기서만 사유를
  // 요구하면 사용자가 고른 사유가 서버에서 조용히 버려진다. 노출용만 바꾼 저장은 dirty 는
  // true 지만 게이트는 걸리지 않고 바로 PATCH 된다.
  const gateRequired = diff.changed

  async function handleSave(changeMeta?: KeywordChangeMeta) {
    if (gateRequired && !changeMeta) {
      setGateOpen(true)
      return
    }
    setSaving(true)
    try {
      const normalizedSearchName = searchName.trim()
      const normalizedDisplayName = displayName.trim()
      const url =
        card.kind === 'channelProduct'
          ? `/api/sh/products/listings/channel-products/${card.id}`
          : `/api/sh/products/listings/${card.id}`
      const body =
        card.kind === 'channelProduct'
          ? {
              baseSearchName: normalizedSearchName,
              baseDisplayName: normalizedDisplayName,
              keywords,
              ...(changeMeta ?? {}),
            }
          : {
              searchName: normalizedSearchName,
              displayName: normalizedDisplayName,
              keywords,
              ...(changeMeta ?? {}),
            }
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? '저장 실패')
      toast.success('저장했습니다')
      setGateOpen(false)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-1.5 text-lg">
              {card.channelName}
              {readOnly && <Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
            </CardTitle>
            {card.kind === 'channelProduct' && card.listingCount > 1 && (
              <CardDescription>판매 옵션 {card.listingCount}개</CardDescription>
            )}
          </div>
          {readOnly && <Badge variant="outline">연동 채널 (읽기전용)</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor={`kw-search-${card.id}`}>상품명 (검색용)</Label>
            <NameCounter value={searchName} limit={searchNameRules.nameHardMax} guide />
          </div>
          <Input
            id={`kw-search-${card.id}`}
            value={searchName}
            onChange={(e) => setSearchName(e.target.value)}
            placeholder="판매채널 리스팅에 노출되는 상품명"
            maxLength={MAX_NAME_LENGTH}
            readOnly={readOnly}
          />
          <NameValidationPanel
            value={searchName}
            onChange={setSearchName}
            field="searchName"
            rules={rules}
            readOnly={readOnly}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor={`kw-display-${card.id}`}>상품명 (노출용)</Label>
            <NameCounter value={displayName} limit={displayNameRules.nameHardMax} guide />
          </div>
          <Input
            id={`kw-display-${card.id}`}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="비우면 검색용 상품명을 그대로 사용합니다"
            maxLength={MAX_NAME_LENGTH}
            readOnly={readOnly}
          />
          {/* 빈 값은 "검색용을 그대로 쓴다"는 뜻이라 폴백값을 넣지 않는다 — 패널이 알아서 숨는다. */}
          <NameValidationPanel
            value={displayName}
            onChange={setDisplayName}
            field="displayName"
            rules={rules}
            readOnly={readOnly}
          />
        </div>

        <div className="space-y-1.5">
          <Label>키워드</Label>
          <KeywordEditor
            value={keywords}
            onChange={setKeywords}
            productName={searchName}
            rules={rules}
          />
        </div>

        {!readOnly && (
          <div className="flex justify-end">
            <Button onClick={() => handleSave()} disabled={!dirty || saving}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />}
              {gateRequired ? '변경 사유 입력 후 저장' : '저장'}
            </Button>
          </div>
        )}
      </CardContent>

      {!readOnly && (
        <KeywordChangeDialog
          open={gateOpen}
          onOpenChange={setGateOpen}
          beforeName={card.searchName}
          afterName={searchName.trim()}
          beforeKeywords={card.keywords}
          afterKeywords={keywords}
          saving={saving}
          onConfirm={(meta) => handleSave(meta)}
        />
      )}
    </Card>
  )
}
