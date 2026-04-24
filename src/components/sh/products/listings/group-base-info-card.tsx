'use client'

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

export type OptionAttribute = { name: string; values: Array<{ value: string }> }

type Props = {
  channelName: string
  baseSearchName: string
  baseDisplayName: string
  baseInternalCode: string
  memo: string
  inconsistentBases: string[]
  onBaseSearchNameChange: (v: string) => void
  onBaseDisplayNameChange: (v: string) => void
  onBaseInternalCodeChange: (v: string) => void
  onMemoChange: (v: string) => void
  disabled?: boolean
}

/**
 * 그룹 상세의 "기본 정보" 섹션 (controlled).
 * 공통 base를 편집하면 상위 컴포넌트가 각 listing의 suffix를 유지한 채 이름을 재구성한다.
 * 저장 버튼은 상위 GroupDetailView의 단일 저장 버튼을 공유한다.
 */
export function GroupBaseInfoCard({
  channelName,
  baseSearchName,
  baseDisplayName,
  baseInternalCode,
  memo,
  inconsistentBases,
  onBaseSearchNameChange,
  onBaseDisplayNameChange,
  onBaseInternalCodeChange,
  onMemoChange,
  disabled,
}: Props) {
  const nameLimit = getChannelNameLimit(channelName)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">기본 정보</CardTitle>
        <CardDescription>
          이 그룹의 모든 listing에 공통으로 적용되는 값. 각 listing의 속성 suffix(예: &lsquo;S
          누드&rsquo;)는 그대로 유지되고 앞부분만 일괄 재작성됩니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {inconsistentBases.length > 0 && (
          <p className="text-xs text-amber-600">
            ⚠ {inconsistentBases.join(' · ')}의 base가 listing마다 달라 대표값을 표시합니다. 저장 시
            모든 listing에 동일하게 적용됩니다.
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
              onChange={(e) => onBaseInternalCodeChange(e.target.value)}
              placeholder="예: CP-MUD — suffix가 붙어 각 listing에 설정됩니다"
              maxLength={50}
              disabled={disabled}
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
            onChange={(e) => onBaseSearchNameChange(e.target.value)}
            placeholder="예: 프리미엄 머드팬티"
            maxLength={MAX_NAME_LENGTH - 30}
            disabled={disabled}
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
            onChange={(e) => onBaseDisplayNameChange(e.target.value)}
            placeholder="상세 페이지에 표시되는 상품명"
            maxLength={MAX_NAME_LENGTH - 30}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="group-memo">메모</Label>
          <Textarea
            id="group-memo"
            value={memo}
            onChange={(e) => onMemoChange(e.target.value)}
            placeholder="내부 참고용 메모 — 저장 시 모든 listing에 동일하게 적용"
            rows={2}
            disabled={disabled}
          />
        </div>
      </CardContent>
    </Card>
  )
}

export function buildSuffix(listing: GroupListingForBase, attrs: OptionAttribute[]): string {
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

export function joinName(base: string, suffix: string): string {
  if (!base) return suffix
  if (!suffix) return base
  return `${base} ${suffix}`
}

function stripSuffix(value: string | null, suffix: string): string {
  if (!value) return ''
  if (!suffix) return value
  if (value.endsWith(suffix)) {
    return value.slice(0, value.length - suffix.length).trimEnd()
  }
  return value
}

export function deriveBaseValues(
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
