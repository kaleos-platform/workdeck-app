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
  managementName: string | null
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
  baseManagementName: string
  baseInternalCode: string
  memo: string
  inconsistentBases: string[]
  onBaseSearchNameChange: (v: string) => void
  onBaseDisplayNameChange: (v: string) => void
  onBaseManagementNameChange: (v: string) => void
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
  baseManagementName,
  baseInternalCode,
  memo,
  inconsistentBases,
  onBaseSearchNameChange,
  onBaseDisplayNameChange,
  onBaseManagementNameChange,
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
          이 채널 상품의 모든 판매 옵션에 공통으로 적용되는 값. 각 판매 옵션의 옵션 코드(예:
          &lsquo;S 누드&rsquo;)는 그대로 유지되고 앞부분만 일괄 재작성됩니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {inconsistentBases.length > 0 && (
          <p className="text-xs text-amber-600">
            ⚠ {inconsistentBases.join(' · ')}이 판매 옵션마다 달라 대표값을 표시합니다. 저장 시 모든
            판매 옵션에 동일하게 적용됩니다.
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
              placeholder="예: CP-MUD — 옵션 코드가 붙어 각 판매 옵션에 설정됩니다"
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
            placeholder="비우면 검색용 상품명을 그대로 사용합니다"
            maxLength={MAX_NAME_LENGTH - 30}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="group-management">상품명 (관리용)</Label>
            <NameCounter value={baseManagementName} />
          </div>
          <Input
            id="group-management"
            value={baseManagementName}
            onChange={(e) => onBaseManagementNameChange(e.target.value)}
            placeholder="내부 목록 표시용. 비우면 검색용 상품명을 사용합니다"
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
            placeholder="내부 참고용 메모 — 저장 시 모든 판매 옵션에 동일하게 적용"
            rows={2}
            disabled={disabled}
          />
        </div>
      </CardContent>
    </Card>
  )
}

export function buildSuffix(listing: GroupListingForBase, attrs: OptionAttribute[]): string {
  if (listing.items.length === 0) return ''
  // 모든 item이 공통으로 가지는 속성값만 suffix로 사용 (묶음 item일 때 안전).
  // 단, 공통값이라도 listing 이름 끝에 실제로 들어가지 않을 수 있으므로 후처리는 stripSuffix에서.
  const parts: string[] = []
  for (const a of attrs) {
    const first = listing.items[0].attributeValues?.[a.name]
    if (!first) continue
    const allSame = listing.items.every((it) => (it.attributeValues ?? {})[a.name] === first)
    if (allSame) parts.push(first)
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
  // 끝의 묶음 라벨(` #N ...`)과 ` N개` 차원을 먼저 제거
  let v = value.replace(/\s+#\d+\s.*$/, '').replace(/\s+\d+개$/, '')
  if (suffix && v.endsWith(suffix)) {
    v = v.slice(0, v.length - suffix.length).trimEnd()
  }
  return v
}

export function deriveBaseValues(
  listings: GroupListingForBase[],
  attrs: OptionAttribute[]
): {
  baseSearchName: string
  baseDisplayName: string
  baseManagementName: string
  baseInternalCode: string
  memo: string
  inconsistentBases: string[]
} {
  const searchBases: string[] = []
  const displayBases: string[] = []
  const managementBases: string[] = []
  const codeBases: string[] = []
  for (const l of listings) {
    const suffix = buildSuffix(l, attrs)
    searchBases.push(stripSuffix(l.searchName, suffix))
    displayBases.push(stripSuffix(l.displayName, suffix))
    managementBases.push(stripSuffix(l.managementName, suffix))
    codeBases.push(stripSuffix(l.internalCode, suffix))
  }

  const inconsistent: string[] = []
  const baseSearchName = mostCommon(searchBases)
  if (new Set(searchBases.filter((s) => s)).size > 1) inconsistent.push('검색명')
  const rawBaseDisplayName = mostCommon(displayBases)
  const sameAsSearchForAll = listings.every((_, idx) => displayBases[idx] === searchBases[idx])
  if (new Set(displayBases.filter((s) => s)).size > 1) inconsistent.push('노출명')
  const baseDisplayName = sameAsSearchForAll ? '' : rawBaseDisplayName
  const baseManagementName = mostCommon(managementBases)
  if (new Set(managementBases.filter((s) => s)).size > 1) inconsistent.push('관리명')
  const baseInternalCode = mostCommon(codeBases)
  if (new Set(codeBases.filter((s) => s)).size > 1) inconsistent.push('관리 코드')

  const memos = listings.map((l) => l.memo ?? '')
  const memo = mostCommon(memos)

  return {
    baseSearchName,
    baseDisplayName,
    baseManagementName,
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
