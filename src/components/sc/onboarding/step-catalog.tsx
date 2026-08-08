'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SALES_CONTENT_SETTINGS_PATH } from '@/lib/deck-routes'
import type { OnboardingDraft } from './types'

type DraftProductRow = { selected: boolean; name: string; oneLinerPitch: string }
type DraftPersonaRow = { selected: boolean; name: string; jobTitle: string; industry: string }

type Props = {
  draft: OnboardingDraft | null
  productCount: number
  personaCount: number
  onSaved: (savedProducts: number, savedPersonas: number) => void
}

export function StepCatalog({ draft, productCount, personaCount, onSaved }: Props) {
  const [products, setProducts] = useState<DraftProductRow[]>(
    (draft?.products ?? []).map((p) => ({
      selected: true,
      name: p.name,
      oneLinerPitch: p.oneLinerPitch ?? '',
    }))
  )
  const [personas, setPersonas] = useState<DraftPersonaRow[]>(
    (draft?.personas ?? []).map((p) => ({
      selected: true,
      name: p.name,
      jobTitle: p.jobTitle ?? '',
      industry: p.industry ?? '',
    }))
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  function updateProduct(i: number, patch: Partial<DraftProductRow>) {
    setProducts((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
  }
  function updatePersona(i: number, patch: Partial<DraftPersonaRow>) {
    setPersonas((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
  }

  async function saveSelected() {
    setSaving(true)
    let savedProducts = 0
    let savedPersonas = 0
    try {
      // 인덱스 기준으로 성공한 행은 즉시 selected=false 처리 — 실패 후 재시도 시 중복 생성 방지
      for (let i = 0; i < products.length; i++) {
        const p = products[i]
        if (!p.selected || !p.name.trim()) continue
        const res = await fetch('/api/sc/products', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: p.name.trim(),
            oneLinerPitch: p.oneLinerPitch.trim() || undefined,
          }),
        })
        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          throw new Error(json.message || `상품 "${p.name}" 저장 실패`)
        }
        savedProducts++
        setProducts((prev) => prev.map((row, idx) => (idx === i ? { ...row, selected: false } : row)))
      }

      for (let i = 0; i < personas.length; i++) {
        const p = personas[i]
        if (!p.selected || !p.name.trim()) continue
        const res = await fetch('/api/sc/personas', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: p.name.trim(),
            jobTitle: p.jobTitle.trim() || undefined,
            industry: p.industry.trim() || undefined,
          }),
        })
        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          throw new Error(json.message || `페르소나 "${p.name}" 저장 실패`)
        }
        savedPersonas++
        setPersonas((prev) => prev.map((row, idx) => (idx === i ? { ...row, selected: false } : row)))
      }

      toast.success(`상품 ${savedProducts}개·페르소나 ${savedPersonas}개를 저장했습니다.`)
      setSaved(true)
      onSaved(savedProducts, savedPersonas)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  const hasDraftItems = products.length > 0 || personas.length > 0

  if (!hasDraftItems) {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">상품·페르소나</h2>
          <p className="text-sm text-muted-foreground">
            AI 초안이 없습니다. 이전 단계에서 초안을 생성하거나, 설정 페이지에서 직접
            등록하세요.
          </p>
        </div>
        <Card>
          <CardContent className="flex items-center justify-between p-6">
            <p className="text-sm text-muted-foreground">
              현재 상품 {productCount}개 · 페르소나 {personaCount}개 등록됨
            </p>
            <Button asChild variant="outline">
              <Link href={SALES_CONTENT_SETTINGS_PATH}>설정 페이지로 이동</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">상품·페르소나</h2>
        <p className="text-sm text-muted-foreground">
          이미 상품 {productCount}개·페르소나 {personaCount}개가 등록되어 있습니다. 선택한 초안
          항목이 추가로 생성됩니다.
        </p>
      </div>

      {products.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">상품 초안 ({products.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {products.map((p, i) => (
              <div key={i} className="flex items-start gap-3 rounded-md border p-3">
                <Checkbox
                  checked={p.selected}
                  onCheckedChange={(checked) => updateProduct(i, { selected: checked === true })}
                  className="mt-1.5"
                  aria-label="상품 선택"
                />
                <div className="grid flex-1 gap-2 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">상품명</Label>
                    <Input
                      value={p.name}
                      onChange={(e) => updateProduct(i, { name: e.target.value })}
                      maxLength={200}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">한 줄 소개</Label>
                    <Input
                      value={p.oneLinerPitch}
                      onChange={(e) => updateProduct(i, { oneLinerPitch: e.target.value })}
                      maxLength={200}
                    />
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {personas.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">페르소나 초안 ({personas.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {personas.map((p, i) => (
              <div key={i} className="flex items-start gap-3 rounded-md border p-3">
                <Checkbox
                  checked={p.selected}
                  onCheckedChange={(checked) => updatePersona(i, { selected: checked === true })}
                  className="mt-1.5"
                  aria-label="페르소나 선택"
                />
                <div className="grid flex-1 gap-2 md:grid-cols-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">이름</Label>
                    <Input
                      value={p.name}
                      onChange={(e) => updatePersona(i, { name: e.target.value })}
                      maxLength={200}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">직함</Label>
                    <Input
                      value={p.jobTitle}
                      onChange={(e) => updatePersona(i, { jobTitle: e.target.value })}
                      maxLength={200}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">산업</Label>
                    <Input
                      value={p.industry}
                      onChange={(e) => updatePersona(i, { industry: e.target.value })}
                      maxLength={200}
                    />
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <Button type="button" onClick={saveSelected} disabled={saving || saved}>
          {saving ? '저장 중…' : saved ? '저장 완료' : '선택 항목 저장'}
        </Button>
      </div>
    </div>
  )
}
