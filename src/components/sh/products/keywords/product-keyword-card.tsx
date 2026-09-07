'use client'

// 상품 축 키워드 화면의 채널 카드 하나 — 채널 하나의 상품명 2종 + 키워드를 한 카드에서
// 편집하고 저장까지 한다. 리스팅 폼으로 튕겨 보내지 않는다("한번에 관리하는 공간" 요건).

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, Lock, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getSellerHubChannelProductPath } from '@/lib/deck-routes'
import { resolveKeywordRules, rulesForNameField, withChannelDefaults } from '@/lib/sh/keyword-rules'
import { diffKeywordChange } from '@/lib/sh/keyword-change'
import { normalizeKeyword } from '@/lib/sh/keyword-normalize'

import { KeywordChangeDialog, type KeywordChangeMeta } from '../listings/keyword-change-dialog'
import { KeywordEditor } from '../listings/keyword-editor'
import { NameCounter } from '../listings/name-counter'
import { NameValidationPanel } from '../listings/name-validation-panel'
import { NameDraftDialog } from './name-draft-dialog'
import { useNameDraft } from './use-name-draft'

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
  nameEditable: boolean
}

type Props = {
  card: KeywordCard
  /** AI 초안 API(POST /api/sh/products/<productId>/name-draft)에 필요한 상품 단위 id.
   * card.id 는 kind 에 따라 channelProductId/listingId 라 여기 상품 id 는 패널에서 따로 받는다. */
  productId: string
  suggestions?: string[]
  onSaved: () => void
}

export function ProductKeywordCard({ card, productId, suggestions, onSaved }: Props) {
  const readOnly = card.externalSource != null
  // 묶인 채널상품(channelProduct) 카드는 서버가 CP 전체 자식을 확인해 상품이 하나로 맞는 경우에만
  // nameEditable=true 를 내려준다. 그 경우 PATCH 의 propagateNames 로 서버가 접미사를 보존한 채
  // 자식 리스팅에 이름을 전파한다. 서로 다른 상품이 섞인 CP 는 전파 대상을 계산할 수 없어 잠근다.
  const nameLocked = readOnly || !card.nameEditable

  const [searchName, setSearchName] = useState(card.searchName)
  const [displayName, setDisplayName] = useState(card.displayName ?? '')
  const [keywords, setKeywords] = useState<string[]>(card.keywords)
  const [saving, setSaving] = useState(false)
  const [gateOpen, setGateOpen] = useState(false)
  const [nameDraftOpen, setNameDraftOpen] = useState(false)
  const [keywordDraftOpen, setKeywordDraftOpen] = useState(false)

  // 상품명·키워드 두 다이얼로그가 이 훅 하나를 공유한다 — load() 는 멱등이라 두 버튼 중 먼저
  // 눌린 쪽에서만 실제 fetch 가 나가고, 나중에 다른 버튼을 눌러도 이미 받아온 결과를 재사용한다
  // (화면 방문당 API 호출 1회).
  const draft = useNameDraft(readOnly || nameLocked ? null : productId, card.channelId)

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

  // 패널이 상품 단위로 한 번 받아온 추천 풀 — 이 카드에 이미 담긴 키워드는 빼고 보여준다.
  // 읽기전용 카드는 애초에 suggestions 를 넘기지 않는다(호출부에서 처리).
  const cardSuggestions = useMemo(() => {
    if (!suggestions || suggestions.length === 0) return []
    const existing = new Set(keywords.map((k) => normalizeKeyword(k)))
    return suggestions.filter((s) => !existing.has(normalizeKeyword(s)))
  }, [suggestions, keywords])

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

  // KeywordEditor 와 같은 규칙: 이미 담긴 키워드(정규화 기준)는 다시 추가하지 않는다.
  // 상품명·키워드 두 다이얼로그가 공유한다.
  function handleAddKeyword(keyword: string) {
    setKeywords((prev) => {
      const existing = new Set(prev.map((k) => normalizeKeyword(k)))
      if (existing.has(normalizeKeyword(keyword))) return prev
      return [...prev, keyword]
    })
  }

  // 제거도 추가와 같다 — 로컬 폼 state 만 바꾸고 저장은 기존 저장 버튼 + 변경 사유 게이트가
  // 맡는다. 여기서 자동 저장하면 게이트를 우회한다.
  function handleRemoveKeyword(keyword: string) {
    const target = normalizeKeyword(keyword)
    setKeywords((prev) => prev.filter((k) => normalizeKeyword(k) !== target))
  }

  // 제안대로 하나만 바꾼다. 제거와 마찬가지로 로컬 state 만 건드리고 저장은 기존 경로가 맡는다.
  // 이미 같은 값이 있으면 중복이 되므로 교체 대신 원본만 뺀다.
  function handleReplaceKeyword(keyword: string, next: string) {
    const target = normalizeKeyword(keyword)
    const replacement = normalizeKeyword(next)
    setKeywords((prev) => {
      const others = prev.filter((k) => normalizeKeyword(k) !== target)
      if (others.some((k) => normalizeKeyword(k) === replacement)) return others
      return prev.map((k) => (normalizeKeyword(k) === target ? next : k))
    })
  }

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
      // channelProduct 카드는 이름이 잠겨 있으면(nameLocked) 이름 필드를 아예 담지 않는다 —
      // 어차피 안 바뀌는 값을 보낼 이유가 없고, baseDisplayName 이 '' 로 덮어써지는 사고 표면을
      // 남기지 않기 위함이다. 잠겨있지 않으면 propagateNames:true 로 서버가 자식 리스팅까지
      // 접미사를 보존한 채 전파한다. baseDisplayName 은 ChannelProduct 쪽이라 빈 값은 null 로
      // 정규화한다(ProductListing.displayName 쪽 빈 문자열 관례와 다르다).
      const body =
        card.kind === 'channelProduct'
          ? nameLocked
            ? {
                keywords,
                ...(changeMeta ?? {}),
              }
            : {
                baseSearchName: normalizedSearchName,
                baseDisplayName: normalizedDisplayName || null,
                propagateNames: true,
                keywords,
                ...(changeMeta ?? {}),
              }
          : {
              // 바뀐 필드만 담는다.
              // displayName 은 null 을 보내면 안 된다 — ProductListing 쪽 스키마는
              // nullable 이 아니고(schemas.ts listingOptionalNameSchema), 라우트가 빈 값을
              // searchName 으로 채운다. null 을 보내면 Zod 가 400 으로 막는다.
              // (null 관례는 ChannelProduct.baseDisplayName 쪽 얘기고, 그 분기는 애초에
              //  이름 필드를 보내지 않는다.)
              ...(normalizedSearchName !== card.searchName
                ? { searchName: normalizedSearchName }
                : {}),
              ...(normalizedDisplayName !== (card.displayName ?? '')
                ? { displayName: normalizedDisplayName }
                : {}),
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
        {card.kind === 'channelProduct' && !readOnly && !card.nameEditable && (
          <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            여러 상품이 섞인 채널 상품이라 상품명을 여기서 일괄 변경할 수 없습니다.{' '}
            <Link
              href={getSellerHubChannelProductPath(card.id)}
              className="font-medium text-primary underline underline-offset-2"
            >
              이 판매채널 상품 편집
            </Link>
          </p>
        )}
        {card.kind === 'channelProduct' &&
          !readOnly &&
          card.nameEditable &&
          card.listingCount > 1 && (
            <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              상품명을 바꾸면 이 채널의 판매 옵션 {card.listingCount}개 이름이 함께 바뀝니다. 옵션별
              이름 뒷부분(색상·사이즈 등)은 그대로 유지됩니다.{' '}
              <Link
                href={getSellerHubChannelProductPath(card.id)}
                className="font-medium text-primary underline underline-offset-2"
              >
                이 판매채널 상품 편집
              </Link>
            </p>
          )}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Label htmlFor={`kw-search-${card.id}`}>상품명 (검색용)</Label>
              {!readOnly && !nameLocked && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 gap-1 px-2 text-xs"
                  onClick={() => {
                    draft.load({ keywords, searchName })
                    setNameDraftOpen(true)
                  }}
                >
                  <Sparkles className="h-3 w-3" aria-hidden="true" />
                  AI 상품명
                </Button>
              )}
            </div>
            <NameCounter value={searchName} limit={searchNameRules.nameHardMax} guide />
          </div>
          <Input
            id={`kw-search-${card.id}`}
            value={searchName}
            onChange={(e) => setSearchName(e.target.value)}
            placeholder="판매채널 리스팅에 노출되는 상품명"
            maxLength={MAX_NAME_LENGTH}
            readOnly={nameLocked}
          />
          <NameValidationPanel
            value={searchName}
            onChange={setSearchName}
            field="searchName"
            rules={rules}
            readOnly={nameLocked}
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
            readOnly={nameLocked}
          />
          {/* 빈 값은 "검색용을 그대로 쓴다"는 뜻이라 폴백값을 넣지 않는다 — 패널이 알아서 숨는다. */}
          <NameValidationPanel
            value={displayName}
            onChange={setDisplayName}
            field="displayName"
            rules={rules}
            readOnly={nameLocked}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Label>키워드</Label>
            {!readOnly && !nameLocked && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 gap-1 px-2 text-xs"
                onClick={() => {
                  draft.load({ keywords, searchName })
                  setKeywordDraftOpen(true)
                }}
              >
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                AI 키워드
              </Button>
            )}
          </div>
          <KeywordEditor
            value={keywords}
            onChange={setKeywords}
            suggestions={readOnly ? undefined : cardSuggestions}
            productName={searchName}
            rules={rules}
            readOnly={readOnly}
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

      {!readOnly && !nameLocked && (
        <>
          <NameDraftDialog
            open={nameDraftOpen}
            onOpenChange={setNameDraftOpen}
            mode="name"
            status={draft.status}
            names={draft.names}
            keywords={draft.keywords}
            reviews={draft.reviews}
            existingKeywords={keywords}
            currentSearchName={searchName}
            onApplyName={setSearchName}
            onAddKeyword={handleAddKeyword}
            onRemoveKeyword={handleRemoveKeyword}
            onReplaceKeyword={handleReplaceKeyword}
          />
          <NameDraftDialog
            open={keywordDraftOpen}
            onOpenChange={setKeywordDraftOpen}
            mode="keyword"
            status={draft.status}
            names={draft.names}
            keywords={draft.keywords}
            reviews={draft.reviews}
            existingKeywords={keywords}
            currentSearchName={searchName}
            onApplyName={setSearchName}
            onAddKeyword={handleAddKeyword}
            onRemoveKeyword={handleRemoveKeyword}
            onReplaceKeyword={handleReplaceKeyword}
          />
        </>
      )}
    </Card>
  )
}
