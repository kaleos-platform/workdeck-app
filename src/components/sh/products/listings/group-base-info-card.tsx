'use client'

import { useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { countChars, getChannelNameLimit } from './channel-name-limits'

const MAX_NAME_LENGTH = 200

export type GroupListingForBase = {
  id: string
  searchName: string
  displayName: string
  internalCode: string | null
  memo: string | null
  items: Array<{
    optionId: string
    attributeValues: Record<string, string>
  }>
}

type OptionAttribute = { name: string; values: Array<{ value: string }> }

type Props = {
  channelName: string
  optionAttributes: OptionAttribute[]
  listings: GroupListingForBase[]
  onSaved: () => void
}

/**
 * 그룹 상세의 "기본 정보" 섹션 — 공통 base(검색명/노출명/관리 코드/메모)를 편집하면
 * 각 listing의 suffix(속성값)를 유지한 채로 이름·코드가 일괄 재작성된다.
 *
 * suffix 추론: listing.items[0].attributeValues를 product.optionAttributes 순서대로
 * 공백으로 join한 문자열 (예: "S 누드"). searchName이 해당 suffix로 끝나면 base로 인정.
 */
export function GroupBaseInfoCard({ channelName, optionAttributes, listings, onSaved }: Props) {
  const derived = useMemo(
    () => deriveBaseValues(listings, optionAttributes),
    [listings, optionAttributes]
  )

  const [baseSearchName, setBaseSearchName] = useState(derived.baseSearchName)
  const [baseDisplayName, setBaseDisplayName] = useState(derived.baseDisplayName)
  const [baseInternalCode, setBaseInternalCode] = useState(derived.baseInternalCode)
  const [memo, setMemo] = useState(derived.memo)
  const [saving, setSaving] = useState(false)

  const nameLimit = getChannelNameLimit(channelName)

  const dirty =
    baseSearchName !== derived.baseSearchName ||
    baseDisplayName !== derived.baseDisplayName ||
    baseInternalCode !== derived.baseInternalCode ||
    memo !== derived.memo

  async function handleSave() {
    if (!dirty) return
    setSaving(true)
    const failures: string[] = []
    for (const l of listings) {
      const suffix = buildSuffix(l, optionAttributes)
      const newSearch = joinName(baseSearchName.trim(), suffix)
      const newDisplay = joinName(baseDisplayName.trim(), suffix)
      const newCode = baseInternalCode.trim() ? joinName(baseInternalCode.trim(), suffix) : null
      const patch = {
        searchName: newSearch || l.searchName,
        displayName: newDisplay || l.displayName,
        internalCode: newCode,
        memo: memo.trim() || null,
      }
      try {
        const res = await fetch(`/api/sh/products/listings/${l.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          failures.push(`${l.searchName}: ${err?.message ?? '저장 실패'}`)
        }
      } catch (err) {
        failures.push(`${l.searchName}: ${err instanceof Error ? err.message : '저장 실패'}`)
      }
    }
    setSaving(false)
    if (failures.length > 0) {
      toast.warning(`${listings.length - failures.length}개 저장 · ${failures.length}개 실패`)
    } else {
      toast.success('기본 정보가 저장되었습니다')
    }
    onSaved()
  }

  function reset() {
    setBaseSearchName(derived.baseSearchName)
    setBaseDisplayName(derived.baseDisplayName)
    setBaseInternalCode(derived.baseInternalCode)
    setMemo(derived.memo)
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-lg">기본 정보</CardTitle>
          <CardDescription>
            이 그룹의 모든 listing에 공통으로 적용되는 값. 각 listing의 속성 suffix(예: &lsquo;S
            누드&rsquo;)는 그대로 유지되고 앞부분만 일괄 재작성됩니다.
          </CardDescription>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={reset} disabled={!dirty || saving}>
            되돌리기
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!dirty || saving}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            기본 정보 저장
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {derived.inconsistentBases.length > 0 && (
          <p className="text-xs text-amber-600">
            ⚠ {derived.inconsistentBases.join(' · ')}의 base가 listing마다 달라 대표값을 표시합니다.
            저장 시 모든 listing에 동일하게 적용됩니다.
          </p>
        )}
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>판매채널</Label>
            <Input value={channelName} disabled />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="group-code">관리 코드 (접두어)</Label>
            <Input
              id="group-code"
              value={baseInternalCode}
              onChange={(e) => setBaseInternalCode(e.target.value)}
              placeholder="예: CP-MUD — suffix가 붙어 각 listing에 설정됩니다"
              maxLength={50}
              disabled={saving}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="group-search">상품명 (검색용)</Label>
            <NameCounter value={baseSearchName} limit={nameLimit.searchName} />
          </div>
          <Input
            id="group-search"
            value={baseSearchName}
            onChange={(e) => setBaseSearchName(e.target.value)}
            placeholder="예: 프리미엄 머드팬티"
            maxLength={MAX_NAME_LENGTH - 30}
            disabled={saving}
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="group-display">상품명 (노출용)</Label>
            <NameCounter value={baseDisplayName} limit={nameLimit.displayName} />
          </div>
          <Input
            id="group-display"
            value={baseDisplayName}
            onChange={(e) => setBaseDisplayName(e.target.value)}
            placeholder="상세 페이지에 표시되는 상품명"
            maxLength={MAX_NAME_LENGTH - 30}
            disabled={saving}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="group-memo">메모</Label>
          <Textarea
            id="group-memo"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="내부 참고용 메모 — 저장 시 모든 listing에 동일하게 적용"
            rows={2}
            disabled={saving}
          />
        </div>
      </CardContent>
    </Card>
  )
}

function buildSuffix(listing: GroupListingForBase, attrs: OptionAttribute[]): string {
  const firstItem = listing.items[0]
  if (!firstItem) return ''
  const values = firstItem.attributeValues ?? {}
  const parts: string[] = []
  for (const a of attrs) {
    const v = values[a.name]
    if (v) parts.push(v)
  }
  return parts.join(' ')
}

function stripSuffix(value: string | null, suffix: string): string {
  if (!value) return ''
  if (!suffix) return value
  if (value.endsWith(suffix)) {
    return value.slice(0, value.length - suffix.length).trimEnd()
  }
  return value
}

function joinName(base: string, suffix: string): string {
  if (!base) return suffix
  if (!suffix) return base
  return `${base} ${suffix}`
}

function deriveBaseValues(
  listings: GroupListingForBase[],
  attrs: OptionAttribute[]
): {
  baseSearchName: string
  baseDisplayName: string
  baseInternalCode: string
  memo: string
  inconsistentBases: string[]
} {
  const searchBases: string[] = []
  const displayBases: string[] = []
  const codeBases: string[] = []
  for (const l of listings) {
    const suffix = buildSuffix(l, attrs)
    searchBases.push(stripSuffix(l.searchName, suffix))
    displayBases.push(stripSuffix(l.displayName, suffix))
    codeBases.push(stripSuffix(l.internalCode, suffix))
  }

  const inconsistent: string[] = []
  const baseSearchName = mostCommon(searchBases)
  if (new Set(searchBases.filter((s) => s)).size > 1) inconsistent.push('검색명')
  const baseDisplayName = mostCommon(displayBases)
  if (new Set(displayBases.filter((s) => s)).size > 1) inconsistent.push('노출명')
  const baseInternalCode = mostCommon(codeBases)
  if (new Set(codeBases.filter((s) => s)).size > 1) inconsistent.push('관리 코드')

  const memos = listings.map((l) => l.memo ?? '')
  const memo = mostCommon(memos)

  return {
    baseSearchName,
    baseDisplayName,
    baseInternalCode,
    memo,
    inconsistentBases: inconsistent,
  }
}

function mostCommon(values: string[]): string {
  if (values.length === 0) return ''
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best = values[0]
  let bestCount = 0
  for (const [v, c] of counts) {
    if (c > bestCount || (c === bestCount && v.length > best.length)) {
      best = v
      bestCount = c
    }
  }
  return best
}

function NameCounter({ value, limit }: { value: string; limit?: number }) {
  const n = countChars(value)
  const overflow = limit != null && n > limit
  const color = overflow ? 'text-destructive' : 'text-muted-foreground'
  return (
    <span className={`text-xs ${color}`}>
      {n}
      {limit != null ? ` / ${limit}(가이드)` : ` / ${MAX_NAME_LENGTH - 30}`}
    </span>
  )
}
