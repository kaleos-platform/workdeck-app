'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Check, Loader2, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  PRODUCT_DESCRIPTION_MAX,
  PRODUCT_LIST_FIELD_MAX_ITEMS,
  PRODUCT_LIST_FIELD_MAX_ITEM_LENGTH,
} from '@/lib/sh/constants'
import type { ProductApplyPatch } from '@/components/sh/products/product-basic-form'
import type { ApplyField, ExtractJob } from './types'

type CurrentProduct = {
  description: string | null
  features: string[]
  certifications: string[]
  manufacturer: string | null
  manufactureCountry: string | null
}

type ListMode = 'replace' | 'merge'
type DescMode = 'append' | 'replace'

function mergeList(
  current: string[],
  selected: string[],
  extras: string[],
  mode: ListMode
): string[] {
  const combined =
    mode === 'replace' ? [...selected, ...extras] : [...current, ...selected, ...extras]
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of combined) {
    const trimmed = raw.trim().slice(0, PRODUCT_LIST_FIELD_MAX_ITEM_LENGTH)
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
    if (out.length >= PRODUCT_LIST_FIELD_MAX_ITEMS) break
  }
  return out
}

type Props = {
  productId: string
  job: ExtractJob
  basicBusy: boolean
  onApply: (patch: ProductApplyPatch) => Promise<void>
  /** 적용 확정(applied) 또는 실패 후 재시도 등으로 상위(이력 목록) 새로고침이 필요할 때 */
  onApplied: () => void
  onClose: () => void
}

/**
 * 방금 만든(또는 이력에서 재열람한) 추출 잡의 결과를 검토하고 기본 정보 폼에 반영한다.
 *
 * 적용 순서: POST .../apply (스냅샷 기록용, fields만 전달) → 로컬에서 편집/선택한 값으로
 * patch 구성 → onApply(patch)로 폼 state에 주입해 autosave 성공까지 대기 → 성공 시에만
 * POST .../applied 로 확정. 서버 apply 응답의 values는 원본 그대로라 사용자가 편집한 설명이나
 * 개별 선택한 특징/인증 항목을 반영하지 못하므로, 실제로 저장하는 값은 이 화면에서 만든
 * patch를 쓴다 — "화면에 보이는 것이 저장되는 것"을 보장하기 위함이다.
 */
export function ProductExtractReview({
  productId,
  job,
  basicBusy,
  onApply,
  onApplied,
  onClose,
}: Props) {
  const [current, setCurrent] = useState<CurrentProduct | null>(null)
  const [loadingCurrent, setLoadingCurrent] = useState(true)

  const result = job.result

  // ─── 편집 상태 (job이 바뀌면 초기화) ───
  const [descSelected, setDescSelected] = useState(false)
  const [descText, setDescText] = useState('')
  const [descMode, setDescMode] = useState<DescMode>('append')
  const [featureSel, setFeatureSel] = useState<Set<number>>(new Set())
  const [featureMode, setFeatureMode] = useState<ListMode>('merge')
  const [featureExtras, setFeatureExtras] = useState<string[]>([])
  const [certSel, setCertSel] = useState<Set<number>>(new Set())
  const [certMode, setCertMode] = useState<ListMode>('merge')
  const [mfrSelected, setMfrSelected] = useState(false)
  const [countrySelected, setCountrySelected] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 현재 상품값 로딩과 편집 상태 초기화를 하나의 effect로 묶는다 — 두 fetch가 분리되어 있으면
  // "기존 값이 있을 때만 기본 미선택" 판단이 current가 아직 도착하기 전 result만으로 이뤄져
  // 매 번 잘못된 기본값(기존 값이 있어도 기본 선택됨)으로 렌더될 수 있다.
  useEffect(() => {
    let cancelled = false
    setLoadingCurrent(true)
    setError(null)
    fetch(`/api/sh/products/${productId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return
        const p = data ? (data.product ?? data) : null
        const curr: CurrentProduct = {
          description: p?.description ?? null,
          features: Array.isArray(p?.features) ? p.features : [],
          certifications: Array.isArray(p?.certifications) ? p.certifications : [],
          manufacturer: p?.manufacturer ?? null,
          manufactureCountry: p?.manufactureCountry ?? null,
        }
        setCurrent(curr)

        // 추출된 값이 있고 "기존 값이 없는" 필드만 기본 선택 — 기존 정보가 있으면
        // 사용자가 명시적으로 선택해야 반영되게 해 무음 덮어쓰기를 막는다.
        // 예외는 인증정보뿐: 인증번호는 오독 시 법적 리스크가 있어 항상 직접 선택하게 한다.
        setDescSelected(Boolean(result?.description) && !curr.description)
        setDescText(result?.description ?? '')
        setDescMode('append')
        setFeatureSel(new Set((result?.features ?? []).map((_, i) => i)))
        setFeatureMode('merge')
        setFeatureExtras([])
        setCertSel(new Set())
        setCertMode('merge')
        setMfrSelected(Boolean(result?.manufacturer) && !curr.manufacturer)
        setCountrySelected(Boolean(result?.originCountry) && !curr.manufactureCountry)
      })
      .finally(() => {
        if (!cancelled) setLoadingCurrent(false)
      })
    return () => {
      cancelled = true
    }
  }, [productId, job.id, result])

  // 이어붙이기 모드일 때 기존 설명 + 추출 설명을 합친 실제 저장값 — 잘림 여부를
  // 조용히 처리하지 않고 배지로 드러내기 위해 미리 계산해 둔다.
  const combinedDescription = useMemo(() => {
    const base = descMode === 'append' && current?.description ? current.description : ''
    if (base && descText) return `${base}\n\n${descText}`
    return base || descText
  }, [descMode, current?.description, descText])
  const descWillTruncate = combinedDescription.length > PRODUCT_DESCRIPTION_MAX

  const addToFeatures = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    setFeatureExtras((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]))
    toast.success('특징에 추가했습니다 — 적용 시 반영됩니다')
  }, [])

  const removeExtra = useCallback((text: string) => {
    setFeatureExtras((prev) => prev.filter((t) => t !== text))
  }, [])

  // 롤백된 잡은 다시 적용할 수 있어야 한다 — appliedAt 만 보면 롤백 후에도 읽기 전용으로
  // 잠겨서 "이미 롤백한 것을 또 롤백하라"는 막다른 안내가 남는다.
  const alreadyApplied = Boolean(job.appliedAt) && !job.rolledBackAt
  // 적용된 잡도 결과 자체는 보여준다 — 다만 편집/선택 컨트롤 없이 읽기 전용으로.
  const isReadOnly = alreadyApplied
  const canShow = job.status === 'SUCCEEDED' && Boolean(result)
  const appliedFieldSet = useMemo(() => new Set(job.appliedFields ?? []), [job.appliedFields])

  const featuresIncluded = featureSel.size > 0 || featureExtras.length > 0
  const certsIncluded = certSel.size > 0

  const anySelected =
    descSelected || featuresIncluded || certsIncluded || mfrSelected || countrySelected

  const handleApply = useCallback(async () => {
    if (!result) return
    setError(null)
    const fields: ApplyField[] = []
    if (descSelected) fields.push('description')
    if (featuresIncluded) fields.push('features')
    if (certsIncluded) fields.push('certifications')
    if (mfrSelected) fields.push('manufacturer')
    if (countrySelected) fields.push('manufactureCountry')
    if (fields.length === 0) {
      setError('적용할 항목을 하나 이상 선택하세요')
      return
    }

    setApplying(true)
    try {
      const applyRes = await fetch(`/api/sh/products/${productId}/extract/${job.id}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      })
      const applyData = await applyRes.json().catch(() => ({}))
      if (!applyRes.ok) {
        throw new Error(applyData?.message ?? '적용 준비에 실패했습니다')
      }

      const patch: ProductApplyPatch = {}
      if (descSelected) {
        patch.description = combinedDescription.slice(0, PRODUCT_DESCRIPTION_MAX).trim() || null
      }
      if (featuresIncluded) {
        const selected = result.features.filter((_, i) => featureSel.has(i))
        patch.features = mergeList(current?.features ?? [], selected, featureExtras, featureMode)
      }
      if (certsIncluded) {
        const selected = result.certifications.filter((_, i) => certSel.has(i))
        patch.certifications = mergeList(current?.certifications ?? [], selected, [], certMode)
      }
      if (mfrSelected) patch.manufacturer = result.manufacturer
      if (countrySelected) patch.manufactureCountry = result.originCountry

      // onApply는 이 patch로 촉발된 폼 autosave가 성공할 때까지 기다린다(product-basic-form 참고).
      await onApply(patch)

      const appliedRes = await fetch(`/api/sh/products/${productId}/extract/${job.id}/applied`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      })
      if (!appliedRes.ok) {
        const d = await appliedRes.json().catch(() => ({}))
        throw new Error(d?.message ?? '적용 확정 처리에 실패했습니다 (값은 이미 저장되었습니다)')
      }
      toast.success('기본 정보에 적용되었습니다')
      onApplied()
      onClose()
    } catch (err) {
      // onApply가 reject되었거나(autosave 실패) apply/applied 라우트가 실패한 경우 —
      // 어느 쪽이든 applied 호출은 하지 않았으므로 잡은 "미적용" 상태로 남는다.
      setError(err instanceof Error ? err.message : '적용에 실패했습니다')
    } finally {
      setApplying(false)
    }
  }, [
    result,
    productId,
    job.id,
    descSelected,
    combinedDescription,
    featuresIncluded,
    featureSel,
    featureExtras,
    featureMode,
    certsIncluded,
    certSel,
    certMode,
    mfrSelected,
    countrySelected,
    current,
    onApply,
    onApplied,
    onClose,
  ])

  if (job.status === 'FAILED') {
    return (
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-base">추출 실패</CardTitle>
          <CardAction>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onClose}
              aria-label="닫기"
            >
              <X className="h-4 w-4" />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">
            {job.errorMessage ?? '알 수 없는 오류로 추출에 실패했습니다'}
          </p>
        </CardContent>
      </Card>
    )
  }

  if (job.status === 'PENDING' || job.status === 'RUNNING') {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          추출이 진행 중입니다...
        </CardContent>
      </Card>
    )
  }

  if (!canShow || !result) return null

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="text-base">
          {isReadOnly ? '적용된 추출 결과' : '추출 결과 검토'}
        </CardTitle>
        <CardAction>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onClose}
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        {isReadOnly && (
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <p className="font-medium">
              {job.appliedAt
                ? `${new Date(job.appliedAt).toLocaleString('ko-KR')}에 적용됨`
                : '적용됨'}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              아래는 적용 당시 AI 추출값과 현재 상품값을 비교하는 읽기 전용 화면입니다 — 되돌리려면
              이력에서 [롤백]을 사용하세요.
            </p>
          </div>
        )}

        {result.confidence < 0.5 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>신뢰도가 낮습니다 ({Math.round(result.confidence * 100)}%)</AlertTitle>
            <AlertDescription>
              소재에서 정보를 명확히 찾지 못했을 수 있습니다. 적용 전 내용을 꼼꼼히 확인하세요.
            </AlertDescription>
          </Alert>
        )}

        {/* 설명 */}
        <FieldBlock
          checked={descSelected}
          onCheckedChange={setDescSelected}
          label="상품 설명"
          currentPreview={loadingCurrent ? '불러오는 중...' : current?.description || '(없음)'}
          hint={
            current?.description
              ? '기존 설명이 있습니다 — 선택하면 아래 방식대로 반영됩니다'
              : undefined
          }
          readOnly={isReadOnly}
          applied={appliedFieldSet.has('description')}
        >
          {job.result?.truncatedFields.includes('description') && (
            <Badge variant="outline" className="mb-1.5">
              추출 원문이 {PRODUCT_DESCRIPTION_MAX}자로 잘렸습니다
            </Badge>
          )}
          {isReadOnly ? (
            <div className="rounded-md border bg-muted/20 p-2 text-sm whitespace-pre-wrap">
              {descText || (
                <span className="text-muted-foreground">AI가 추출한 설명이 없습니다</span>
              )}
            </div>
          ) : (
            <>
              {current?.description && (
                <div className="mb-1.5 flex flex-wrap gap-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setDescMode('append')}
                    className={`rounded-full border px-2.5 py-1 ${descMode === 'append' ? 'border-primary bg-primary/10 font-medium text-primary' : 'text-muted-foreground'}`}
                  >
                    뒤에 추가
                  </button>
                  <button
                    type="button"
                    onClick={() => setDescMode('replace')}
                    className={`rounded-full border px-2.5 py-1 ${descMode === 'replace' ? 'border-primary bg-primary/10 font-medium text-primary' : 'text-muted-foreground'}`}
                  >
                    교체
                  </button>
                </div>
              )}
              <Textarea
                value={descText}
                onChange={(e) => setDescText(e.target.value)}
                rows={4}
                maxLength={PRODUCT_DESCRIPTION_MAX}
                placeholder="추출된 설명이 없습니다"
              />
              <p className="mt-1 text-right text-xs text-muted-foreground">
                {descText.length} / {PRODUCT_DESCRIPTION_MAX}자
              </p>
              {descWillTruncate && (
                <Badge variant="outline" className="mt-1.5">
                  기존 설명과 합치면 {PRODUCT_DESCRIPTION_MAX}자로 잘립니다
                </Badge>
              )}
            </>
          )}
        </FieldBlock>

        <Separator />

        {/* 특징 */}
        <ListFieldBlock
          title="특징 (features)"
          items={result.features}
          selected={featureSel}
          onToggle={(i) =>
            setFeatureSel((prev) => {
              const next = new Set(prev)
              if (next.has(i)) next.delete(i)
              else next.add(i)
              return next
            })
          }
          mode={featureMode}
          onModeChange={setFeatureMode}
          currentCount={current?.features.length ?? 0}
          extras={featureExtras}
          onRemoveExtra={removeExtra}
          readOnly={isReadOnly}
          applied={appliedFieldSet.has('features')}
        />

        <Separator />

        {/* 인증정보 */}
        <div className="space-y-1.5">
          {!isReadOnly && (
            <p className="text-xs text-muted-foreground">
              KC 인증번호 등은 오독 시 법적 리스크가 있어 기본적으로 선택되지 않습니다 — 원문과 대조
              후 직접 선택하세요.
            </p>
          )}
          <ListFieldBlock
            title="인증 정보 (certifications)"
            items={result.certifications}
            selected={certSel}
            onToggle={(i) =>
              setCertSel((prev) => {
                const next = new Set(prev)
                if (next.has(i)) next.delete(i)
                else next.add(i)
                return next
              })
            }
            readOnly={isReadOnly}
            applied={appliedFieldSet.has('certifications')}
            mode={certMode}
            onModeChange={setCertMode}
            currentCount={current?.certifications.length ?? 0}
          />
        </div>

        <Separator />

        {/* 제조사 / 제조국 */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FieldBlock
            checked={mfrSelected}
            onCheckedChange={setMfrSelected}
            label="제조사"
            currentPreview={loadingCurrent ? '불러오는 중...' : current?.manufacturer || '(없음)'}
            hint={current?.manufacturer ? '기존 값이 있습니다 — 선택하면 교체됩니다' : undefined}
            readOnly={isReadOnly}
            applied={appliedFieldSet.has('manufacturer')}
          >
            <p className="text-sm">{result.manufacturer || '(추출되지 않음)'}</p>
          </FieldBlock>
          <FieldBlock
            checked={countrySelected}
            onCheckedChange={setCountrySelected}
            label="제조국"
            currentPreview={
              loadingCurrent ? '불러오는 중...' : current?.manufactureCountry || '(없음)'
            }
            hint={
              current?.manufactureCountry ? '기존 값이 있습니다 — 선택하면 교체됩니다' : undefined
            }
            readOnly={isReadOnly}
            applied={appliedFieldSet.has('manufactureCountry')}
          >
            <p className="text-sm">{result.originCountry || '(추출되지 않음)'}</p>
          </FieldBlock>
        </div>

        {/* 참고 정보 — InvProduct에 컬럼이 없어 특징으로만 편입 가능 */}
        {(result.ingredients.length > 0 || result.capacity || result.cautions.length > 0) && (
          <>
            <Separator />
            <div className="space-y-2 rounded-md border bg-muted/30 p-3">
              <p className="text-sm font-medium">참고 정보</p>
              <p className="text-xs text-muted-foreground">
                성분·용량·주의사항은 상품 필드가 따로 없어 저장되지 않습니다.
                {!isReadOnly && ' 필요하면 특징으로 추가하세요.'}
              </p>
              <div className="space-y-1.5">
                {result.capacity && (
                  <ReferenceRow
                    label="용량"
                    text={result.capacity}
                    onAdd={isReadOnly ? undefined : () => addToFeatures(`용량: ${result.capacity}`)}
                  />
                )}
                {result.ingredients.map((item, i) => (
                  <ReferenceRow
                    key={`ing-${i}`}
                    label="성분"
                    text={item}
                    onAdd={isReadOnly ? undefined : () => addToFeatures(item)}
                  />
                ))}
                {result.cautions.map((item, i) => (
                  <ReferenceRow
                    key={`cau-${i}`}
                    label="주의사항"
                    text={item}
                    onAdd={isReadOnly ? undefined : () => addToFeatures(item)}
                  />
                ))}
              </div>
            </div>
          </>
        )}

        {result.notes && <p className="text-xs text-muted-foreground">AI 메모: {result.notes}</p>}

        {!isReadOnly && error && <p className="text-sm text-destructive">{error}</p>}

        {!isReadOnly && basicBusy && (
          <p className="text-xs text-amber-600">기본 정보 저장 중입니다. 잠시 후 적용해주세요.</p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={applying}>
            닫기
          </Button>
          {!isReadOnly && (
            <Button
              type="button"
              onClick={handleApply}
              disabled={applying || basicBusy || !anySelected}
            >
              {applying ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  적용 중...
                </>
              ) : (
                <>
                  <Check className="mr-1.5 h-4 w-4" />
                  선택 항목 적용
                </>
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function FieldBlock({
  checked,
  onCheckedChange,
  label,
  currentPreview,
  hint,
  readOnly,
  applied,
  children,
}: {
  checked: boolean
  onCheckedChange: (v: boolean) => void
  label: string
  currentPreview: string
  /** 기존 값이 있어 기본 미선택인 경우 사용자에게 알리는 안내 문구 */
  hint?: string
  /** true면 체크박스·선택 없이 비교만 보여준다(적용 완료된 잡 재열람) */
  readOnly?: boolean
  /** readOnly일 때 이 필드가 실제로 적용됐는지 — 배지로 표시 */
  applied?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-2">
        {!readOnly && (
          <Checkbox
            id={`ex-chk-${label}`}
            checked={checked}
            onCheckedChange={(v) => onCheckedChange(v === true)}
            className="mt-0.5"
          />
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-1.5">
            <Label
              htmlFor={readOnly ? undefined : `ex-chk-${label}`}
              className="text-sm font-medium"
            >
              {label}
            </Label>
            {readOnly && applied && (
              <Badge variant="secondary" className="text-[10px]">
                적용됨
              </Badge>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">현재값: {currentPreview}</p>
          {hint && !readOnly && <p className="text-xs text-amber-600">{hint}</p>}
          {children}
        </div>
      </div>
    </div>
  )
}

function ListFieldBlock({
  title,
  items,
  selected,
  onToggle,
  mode,
  onModeChange,
  currentCount,
  extras,
  onRemoveExtra,
  readOnly,
  applied,
}: {
  title: string
  items: string[]
  selected: Set<number>
  onToggle: (i: number) => void
  mode: ListMode
  onModeChange: (m: ListMode) => void
  currentCount: number
  extras?: string[]
  onRemoveExtra?: (text: string) => void
  /** true면 체크박스·모드 선택 없이 비교만 보여준다(적용 완료된 잡 재열람) */
  readOnly?: boolean
  /** readOnly일 때 이 필드가 실제로 적용됐는지 — 배지로 표시 */
  applied?: boolean
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium">{title}</p>
          {readOnly && applied && (
            <Badge variant="secondary" className="text-[10px]">
              적용됨
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">현재 {currentCount}개</p>
      </div>
      {items.length === 0 && (!extras || extras.length === 0) ? (
        <p className="text-xs text-muted-foreground">추출된 항목이 없습니다</p>
      ) : (
        <>
          {!readOnly && (
            <div className="flex flex-wrap gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => onModeChange('replace')}
                className={`rounded-full border px-2.5 py-1 ${mode === 'replace' ? 'border-primary bg-primary/10 font-medium text-primary' : 'text-muted-foreground'}`}
              >
                교체
              </button>
              <button
                type="button"
                onClick={() => onModeChange('merge')}
                className={`rounded-full border px-2.5 py-1 ${mode === 'merge' ? 'border-primary bg-primary/10 font-medium text-primary' : 'text-muted-foreground'}`}
              >
                추가 (중복 제거 병합)
              </button>
            </div>
          )}
          <ul className="space-y-1">
            {items.map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                {!readOnly && (
                  <Checkbox
                    checked={selected.has(i)}
                    onCheckedChange={() => onToggle(i)}
                    className="mt-0.5"
                  />
                )}
                <span className="text-sm">{item}</span>
              </li>
            ))}
            {!readOnly &&
              extras?.map((item) => (
                <li key={item} className="flex items-center gap-2 text-sm text-primary">
                  <Plus className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1">{item}</span>
                  <button
                    type="button"
                    onClick={() => onRemoveExtra?.(item)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
          </ul>
        </>
      )}
    </div>
  )
}

function ReferenceRow({
  label,
  text,
  onAdd,
}: {
  label: string
  text: string
  /** 없으면(읽기 전용) 액션 버튼을 렌더하지 않는다 */
  onAdd?: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="min-w-0 flex-1">
        <span className="text-muted-foreground">[{label}] </span>
        {text}
      </span>
      {onAdd && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 px-2 text-xs"
          onClick={onAdd}
        >
          <Plus className="mr-1 h-3 w-3" />
          특징으로 추가
        </Button>
      )}
    </div>
  )
}
