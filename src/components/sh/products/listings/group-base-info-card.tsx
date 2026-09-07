'use client'

import { useMemo } from 'react'
import { Lock, Sparkles } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { rulesForNameField, type KeywordRuleSet } from '@/lib/sh/keyword-rules'

import { NameCounter } from './name-counter'
import { NameValidationPanel } from './name-validation-panel'

const MAX_NAME_LENGTH = 200

type Props = {
  channelName: string
  /** 채널 기준 규칙셋 — 부모(group-detail-view)가 한 번만 계산해 내려준다. 이 카드가 다시
   * 계산하면 externalSource 반영을 두 곳에서 따로 고쳐야 해 재발한다. */
  rules: KeywordRuleSet
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
  /** 연동 채널(externalSource != null)이면 true — 상품명(검색용·노출용) 입력·검증 패널·
   * AI 상품명 버튼을 잠근다. `disabled`(옵션 CRUD 중)와는 뜻이 다르다 — 섞지 않는다. */
  namesReadOnly?: boolean
  /** AI 상품명 버튼. 연동 채널(namesReadOnly)이면 아예 렌더하지 않는다(부모가 undefined 로 전달). */
  aiNameButton?: { disabled: boolean; tooltip?: string; onClick: () => void }
}

/**
 * 그룹 상세의 "기본 정보" 섹션 (controlled).
 * 공통 base를 편집하면 상위 컴포넌트가 각 listing의 suffix를 유지한 채 이름을 재구성한다.
 * 저장 버튼은 상위 GroupDetailView의 단일 저장 버튼을 공유한다.
 */
export function GroupBaseInfoCard({
  channelName,
  rules,
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
  namesReadOnly,
  aiNameButton,
}: Props) {
  const searchNameRules = useMemo(() => rulesForNameField(rules, 'searchName'), [rules])
  const displayNameRules = useMemo(() => rulesForNameField(rules, 'displayName'), [rules])

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-1.5 text-lg">
              기본 정보
              {namesReadOnly && (
                <Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              )}
            </CardTitle>
            <CardDescription>
              이 채널 상품의 모든 판매 옵션에 공통으로 적용되는 값. 각 판매 옵션의 옵션 코드(예:
              &lsquo;S 누드&rsquo;)는 그대로 유지되고 앞부분만 일괄 재작성됩니다.
              {namesReadOnly && ' 연동 채널이라 상품명(검색용·노출용)은 여기서 수정할 수 없습니다.'}
            </CardDescription>
          </div>
          {namesReadOnly && <Badge variant="outline">연동 채널 (읽기전용)</Badge>}
        </div>
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
            <div className="flex items-center gap-2">
              <Label htmlFor="group-search">상품명 (검색용)</Label>
              {aiNameButton && (
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6 gap-1 px-2 text-xs"
                          disabled={aiNameButton.disabled}
                          onClick={aiNameButton.onClick}
                        >
                          <Sparkles className="h-3 w-3" aria-hidden="true" />
                          AI 상품명
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {aiNameButton.tooltip && (
                      <TooltipContent side="top">{aiNameButton.tooltip}</TooltipContent>
                    )}
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
            <NameCounter value={baseSearchName} limit={searchNameRules.nameHardMax} guide />
          </div>
          <Input
            id="group-search"
            value={baseSearchName}
            onChange={(e) => onBaseSearchNameChange(e.target.value)}
            placeholder="예: 프리미엄 머드팬티"
            maxLength={MAX_NAME_LENGTH - 30}
            disabled={disabled}
            readOnly={namesReadOnly}
          />
          {/* 변경 작업 중(disabled)에는 원클릭 수정을 막는다 — 자동저장 타이머가 걸려
              진행 중인 작업의 재적재와 경합한다. namesReadOnly(연동 채널)도 같은 이유로 잠근다. */}
          <NameValidationPanel
            value={baseSearchName}
            onChange={onBaseSearchNameChange}
            field="searchName"
            rules={rules}
            readOnly={disabled || namesReadOnly}
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="group-display">상품명 (노출용)</Label>
            <NameCounter value={baseDisplayName} limit={displayNameRules.nameHardMax} guide />
          </div>
          <Input
            id="group-display"
            value={baseDisplayName}
            onChange={(e) => onBaseDisplayNameChange(e.target.value)}
            placeholder="비우면 검색용 상품명을 그대로 사용합니다"
            maxLength={MAX_NAME_LENGTH - 30}
            disabled={disabled}
            readOnly={namesReadOnly}
          />
          {/* 빈 값은 "검색용을 그대로 쓴다"는 뜻이라 폴백값을 넣지 않는다 — 패널이 알아서 숨는다. */}
          <NameValidationPanel
            value={baseDisplayName}
            onChange={onBaseDisplayNameChange}
            field="displayName"
            rules={rules}
            readOnly={disabled || namesReadOnly}
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="group-management">상품명 (관리용)</Label>
            {/* 내부 표시용이라 채널 상한이 없다. 옵션 접미사(최대 30자)를 뺀 여유분만 보여준다. */}
            <NameCounter value={baseManagementName} limit={MAX_NAME_LENGTH - 30} />
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
