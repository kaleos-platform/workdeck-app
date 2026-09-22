'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { FloatingActionBar, floatingActionButtonClass } from '@/components/ui/floating-action-bar'
import { applyRangeSelection } from '@/lib/range-selection'
import { SALES_CONTENT_HOME_PATH, SALES_CONTENT_SETTINGS_PATH } from '@/lib/deck-routes'
import type { BrandProfileData, OnboardingDraft } from './types'

type Field = { key: string; value: string }
type SaveResult = {
  savedProducts: number
  savedPersonas: number
  skippedProducts: number
  skippedPersonas: number
}

function Details({
  fields,
  onChange,
  label,
}: {
  fields: Field[]
  onChange: (fields: Field[]) => void
  label: string
}) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer py-2 text-muted-foreground">
        {label} · 상세 정보 {fields.length}개
      </summary>
      <div className="space-y-2">
        {fields.map((field, index) => (
          <div key={index} className="grid gap-2 sm:grid-cols-[180px_1fr_auto]">
            <Input
              aria-label={`${label} 상세 항목 ${index + 1}`}
              value={field.key}
              maxLength={100}
              onChange={(e) =>
                onChange(fields.map((f, i) => (i === index ? { ...f, key: e.target.value } : f)))
              }
            />
            <Textarea
              aria-label={`${label} 상세 내용 ${index + 1}`}
              value={field.value}
              maxLength={2000}
              onChange={(e) =>
                onChange(fields.map((f, i) => (i === index ? { ...f, value: e.target.value } : f)))
              }
            />
            <Button
              variant="ghost"
              aria-label={`${label} 상세 ${index + 1} 삭제`}
              onClick={() => onChange(fields.filter((_, i) => i !== index))}
            >
              삭제
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          disabled={fields.length >= 50}
          onClick={() => onChange([...fields, { key: '', value: '' }])}
        >
          상세 항목 추가
        </Button>
      </div>
    </details>
  )
}

export function StepReview({
  draft,
  initial,
  active = true,
  onSaved,
}: {
  draft: OnboardingDraft | null
  initial: BrandProfileData | null
  active?: boolean
  onSaved?: (brand: BrandProfileData) => void
}) {
  const [brand, setBrand] = useState<BrandProfileData>(
    () =>
      initial ?? {
        companyName: draft?.brandProfile.companyName ?? '',
        shortDescription: draft?.brandProfile.shortDescription ?? '',
        toneOfVoice: draft?.brandProfile.toneOfVoice ?? [],
        customFields: draft?.brandProfile.customFields ?? [],
      }
  )
  const [products, setProducts] = useState(draft?.products ?? [])
  const [personas, setPersonas] = useState(draft?.personas ?? [])
  const [selected, setSelected] = useState(
    () =>
      new Set([
        ...(draft?.products ?? []).map((_, i) => `product-${i}`),
        ...(draft?.personas ?? []).map((_, i) => `persona-${i}`),
      ])
  )
  const lastIndex = useRef<Record<string, number | null>>({ product: null, persona: null })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<SaveResult | null>(null)
  const [error, setError] = useState('')
  const [settingsPath, setSettingsPath] = useState<string | null>(null)
  function edited() {
    setError('')
  }
  function toggle(kind: string, index: number, shiftKey: boolean, length: number) {
    edited()
    setSelected((prev) =>
      applyRangeSelection(
        prev,
        Array.from({ length }, (_, i) => `${kind}-${i}`),
        `${kind}-${index}`,
        index,
        shiftKey,
        lastIndex.current[kind]
      )
    )
    lastIndex.current[kind] = index
  }
  function header(kind: string, length: number, label: string) {
    const keys = Array.from({ length }, (_, i) => `${kind}-${i}`)
    const count = keys.filter((key) => selected.has(key)).length
    return (
      <div className="flex items-center gap-3 border-b pb-3">
        <Checkbox
          aria-label={`${label} 전체 선택`}
          disabled={saving}
          checked={count === length && length > 0 ? true : count > 0 ? 'indeterminate' : false}
          onCheckedChange={(checked) => {
            edited()
            setSelected((prev) => {
              const next = new Set(prev)
              keys.forEach((key) => (checked ? next.add(key) : next.delete(key)))
              return next
            })
          }}
        />
        <h3 className="font-medium">
          {label} {length}개
        </h3>
        <span className="text-xs text-muted-foreground">{count}개 선택</span>
      </div>
    )
  }
  async function save() {
    if (saving || saved) return
    const selectedProducts = products.filter((_, i) => selected.has(`product-${i}`))
    const selectedPersonas = personas.filter((_, i) => selected.has(`persona-${i}`))
    const fieldLists = [
      brand.customFields ?? [],
      ...selectedProducts.map((p) => p.customFields ?? []),
      ...selectedPersonas.map((p) => p.customFields ?? []),
    ]
    if (fieldLists.some((fields) => fields.length > 50)) {
      setError(
        '상세 정보는 항목별 최대 50개입니다. 보존할 내용을 검토해 합치거나 삭제한 뒤 저장하세요.'
      )
      return
    }
    if (
      fieldLists.some((fields) =>
        fields.some(
          (field) =>
            !field.key.trim() ||
            field.key.length > 100 ||
            !field.value.trim() ||
            field.value.length > 2000
        )
      )
    ) {
      setError('상세 정보의 이름(1~100자)과 내용(1~2,000자)을 확인하세요.')
      return
    }
    setSaving(true)
    setError('')
    setSettingsPath(null)
    try {
      const response = await fetch('/api/sc/onboarding/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          brandProfile: {
            ...brand,
            toneOfVoice: brand.toneOfVoice.map((tone) => tone.trim()).filter(Boolean),
          },
          products: products
            .filter((_, i) => selected.has(`product-${i}`))
            .map(({ name, oneLinerPitch, sourceUrl, customFields }) => ({
              name,
              oneLinerPitch,
              sourceUrl,
              customFields,
            })),
          personas: personas.filter((_, i) => selected.has(`persona-${i}`)),
        }),
      })
      const result = await response.json()
      if (!response.ok) {
        if (
          typeof result.settingsPath === 'string' &&
          result.settingsPath.startsWith('/') &&
          !result.settingsPath.startsWith('//')
        )
          setSettingsPath(result.settingsPath)
        throw new Error(result.message || '저장 실패')
      }
      setSaved(result)
      onSaved?.({
        ...brand,
        toneOfVoice: brand.toneOfVoice.map((tone) => tone.trim()).filter(Boolean),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-8 pb-16">
      <div>
        <h2 className="text-lg font-semibold">검토하고 한 번에 저장</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          분석된 제품을 표시합니다. 수집·분석 경고와 출처·인증·ESG 근거를 확인하고 수정하세요.
        </p>
      </div>
      {(draft?.warnings ?? []).map((warning) => (
        <p key={warning} className="text-sm text-amber-700 dark:text-amber-400">
          {warning}
        </p>
      ))}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {saved && (
        <div role="status" className="space-y-3 rounded-md border p-4">
          <p>
            저장 완료 · 제품 {saved.savedProducts}개 · 고객 {saved.savedPersonas}개
          </p>
          <p className="text-sm text-muted-foreground">
            이미 등록된 제품 {saved.skippedProducts}개 · 고객 {saved.skippedPersonas}개는
            유지했습니다.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild variant="outline">
              <Link href={SALES_CONTENT_SETTINGS_PATH}>저장한 정보 수정</Link>
            </Button>
            <Button asChild>
              <Link href={SALES_CONTENT_HOME_PATH}>콘텐츠 만들러 가기</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`${SALES_CONTENT_SETTINGS_PATH}?tab=channels`}>
                배포 채널 설정 (선택)
              </Link>
            </Button>
          </div>
        </div>
      )}
      {settingsPath && (
        <Link href={settingsPath} className="text-sm underline">
          설정 확인
        </Link>
      )}
      <fieldset disabled={saving || !!saved} className="space-y-8">
        <div className="space-y-3">
          <h3 className="font-medium">브랜드</h3>
          {initial && draft && (
            <div className="rounded-md border p-3 text-sm">
              <p>
                AI 제안: {draft.brandProfile.companyName} · {draft.brandProfile.shortDescription}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => {
                  edited()
                  setBrand({
                    companyName: draft.brandProfile.companyName,
                    shortDescription: draft.brandProfile.shortDescription ?? '',
                    toneOfVoice: draft.brandProfile.toneOfVoice ?? [],
                    customFields: [
                      ...(brand.customFields ?? []),
                      ...(draft.brandProfile.customFields ?? []).filter(
                        (field) =>
                          !(brand.customFields ?? []).some(
                            (old) => old.key === field.key && old.value === field.value
                          )
                      ),
                    ],
                  })
                }}
              >
                AI 제안 적용
              </Button>
            </div>
          )}
          <label className="block space-y-1 text-sm">
            <span>회사명</span>
            <Input
              value={brand.companyName}
              maxLength={200}
              onChange={(e) => {
                edited()
                setBrand({ ...brand, companyName: e.target.value })
              }}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>한 줄 소개</span>
            <Input
              value={brand.shortDescription}
              maxLength={400}
              onChange={(e) => {
                edited()
                setBrand({ ...brand, shortDescription: e.target.value })
              }}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>보이스·톤 (쉼표로 구분, 최대 3개)</span>
            <Input
              value={brand.toneOfVoice.join(',')}
              onChange={(e) => {
                edited()
                setBrand({ ...brand, toneOfVoice: e.target.value.split(',').slice(0, 3) })
              }}
            />
          </label>
          <Details
            label="브랜드"
            fields={brand.customFields ?? []}
            onChange={(customFields) => {
              edited()
              setBrand({ ...brand, customFields })
            }}
          />
        </div>
        <div className="space-y-3">
          {header('product', products.length, '제품')}
          {products.length === 0 && (
            <p className="text-sm text-muted-foreground">
              제품 초안이 없습니다. 자료 분석을 진행하거나 제품 자료를 추가하세요.
            </p>
          )}
          {products.map((product, index) => (
            <div key={index} className="flex gap-3 border-b py-3">
              <Checkbox
                className="mt-3"
                aria-label={`${product.name} 선택`}
                checked={selected.has(`product-${index}`)}
                onClick={(event) => toggle('product', index, event.shiftKey, products.length)}
              />
              <div className="min-w-0 flex-1 space-y-2">
                <Input
                  aria-label={`제품 ${index + 1} 이름`}
                  value={product.name}
                  maxLength={200}
                  onChange={(e) => {
                    edited()
                    setProducts(
                      products.map((p, i) => (i === index ? { ...p, name: e.target.value } : p))
                    )
                  }}
                />
                <Input
                  aria-label={`제품 ${index + 1} 한 줄 소개`}
                  value={product.oneLinerPitch ?? ''}
                  maxLength={200}
                  onChange={(e) => {
                    edited()
                    setProducts(
                      products.map((p, i) =>
                        i === index ? { ...p, oneLinerPitch: e.target.value } : p
                      )
                    )
                  }}
                />
                {product.sourceUrl && (
                  <p className="text-xs break-all text-muted-foreground">
                    출처: {product.sourceUrl}
                  </p>
                )}
                {product.warnings?.map((warning) => (
                  <p key={warning} className="text-xs text-amber-700 dark:text-amber-400">
                    {warning}
                  </p>
                ))}
                <Details
                  label={`제품 ${index + 1}`}
                  fields={product.customFields ?? []}
                  onChange={(customFields) => {
                    edited()
                    setProducts(products.map((p, i) => (i === index ? { ...p, customFields } : p)))
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-3">
          {header('persona', personas.length, '고객')}
          {personas.map((persona, index) => (
            <div key={index} className="flex gap-3 border-b py-3">
              <Checkbox
                className="mt-3"
                aria-label={`${persona.name} 선택`}
                checked={selected.has(`persona-${index}`)}
                onClick={(event) => toggle('persona', index, event.shiftKey, personas.length)}
              />
              <div className="min-w-0 flex-1 space-y-2">
                {(['name', 'jobTitle', 'industry'] as const).map((field) => (
                  <Input
                    key={field}
                    aria-label={`고객 ${index + 1} ${field}`}
                    value={persona[field] ?? ''}
                    maxLength={200}
                    onChange={(e) => {
                      edited()
                      setPersonas(
                        personas.map((p, i) =>
                          i === index ? { ...p, [field]: e.target.value } : p
                        )
                      )
                    }}
                  />
                ))}
                <Details
                  label={`고객 ${index + 1}`}
                  fields={persona.customFields ?? []}
                  onChange={(customFields) => {
                    edited()
                    setPersonas(personas.map((p, i) => (i === index ? { ...p, customFields } : p)))
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </fieldset>
      <FloatingActionBar
        open={active && !saved}
        onClear={() => {
          edited()
          setSelected(new Set())
        }}
        clearDisabled={saving}
        actions={
          <Button
            variant="ghost"
            className={floatingActionButtonClass}
            disabled={saving || !brand.companyName.trim()}
            onClick={save}
          >
            {saving ? '저장 중…' : '선택 항목과 브랜드 저장'}
          </Button>
        }
      >
        <span className="text-sm">{selected.size}개 선택</span>
      </FloatingActionBar>
    </section>
  )
}
