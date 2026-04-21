'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ProductOptionAttributesEditor,
  type OptionAttribute,
  type CombinationRow,
} from '@/components/sh/products/product-option-attributes-editor'

type Brand = { id: string; name: string }
type Category = { id: string; name: string }

export default function ProductNewPage() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)

  // 기본 정보
  const [name, setName] = useState('')
  const [nameEn, setNameEn] = useState('')
  const [brandId, setBrandId] = useState('')
  const [groupId, setGroupId] = useState('')
  const [manufacturer, setManufacturer] = useState('')
  const [msrp, setMsrp] = useState('')
  const [description, setDescription] = useState('')

  // 선택지
  const [brands, setBrands] = useState<Brand[]>([])
  const [categories, setCategories] = useState<Category[]>([])

  // 옵션 속성 + 조합
  const [attributes, setAttributes] = useState<OptionAttribute[]>([])
  const [combinations, setCombinations] = useState<CombinationRow[]>([])

  // 단순 옵션 모드 (속성 미사용 시)
  const useAttributeMode = attributes.length > 0

  useEffect(() => {
    Promise.all([
      fetch('/api/sh/brands').then((res) => (res.ok ? res.json() : null)),
      fetch('/api/sh/categories').then((res) => (res.ok ? res.json() : null)),
    ]).then(([bData, cData]) => {
      setBrands(bData?.brands ?? [])
      const cats: Category[] = cData?.categories ?? []
      setCategories(cats)
      // 첫 번째 카테고리를 기본값으로 설정
      if (cats.length > 0) setGroupId(cats[0].id)
    })
  }, [])

  async function handleSave() {
    if (!name.trim()) {
      toast.error('상품명을 입력해 주세요')
      return
    }
    if (!groupId) {
      toast.error('카테고리를 선택해 주세요')
      return
    }

    // 속성 모드일 때 조합 기반 옵션 생성, 아니면 기본 단일 옵션
    const optionsPayload = useAttributeMode
      ? combinations
          .filter((row) => row.combination.length > 0)
          .map((row) => ({
            name: row.combination.join(' / '),
            sku: row.sku.trim() || undefined,
            costPrice: row.costPrice ? parseFloat(row.costPrice) : undefined,
            retailPrice: row.retailPrice ? parseFloat(row.retailPrice) : undefined,
            attributeValues: Object.fromEntries(
              attributes
                .filter((a) => a.name.trim())
                .map((a, i) => [a.name, row.combination[i] ?? ''])
            ),
          }))
      : [{ name: '기본' }]

    if (useAttributeMode && optionsPayload.length === 0) {
      toast.error('속성 값을 입력하면 조합이 자동 생성됩니다')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/sh/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          nameEn: nameEn.trim() || undefined,
          groupId,
          brandId: brandId || undefined,
          manufacturer: manufacturer.trim() || undefined,
          msrp: msrp ? parseFloat(msrp) : undefined,
          description: description.trim() || undefined,
          optionAttributes: useAttributeMode
            ? attributes
                .filter((a) => a.name.trim() && a.values.length > 0)
                .map((a) => ({ name: a.name, values: a.values }))
            : undefined,
          options: optionsPayload,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? '상품 생성 실패')
      toast.success('상품이 생성되었습니다')
      // 생성된 상품 상세 페이지로 이동
      router.push(`/d/seller-hub/products/${data.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '생성 실패')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/d/seller-hub/products/list" aria-label="목록으로">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">새 상품 등록</h1>
          <p className="text-sm text-muted-foreground">기본 정보와 옵션을 입력하세요</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* 왼쪽: 기본 정보 + 옵션 속성 */}
        <div className="space-y-6">
          {/* 기본 정보 카드 */}
          <Card>
            <CardHeader>
              <CardTitle>기본 정보</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 상품명 */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="new-name">
                    상품명 (한국어) <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="new-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="상품명"
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-name-en">상품명 (영문)</Label>
                  <Input
                    id="new-name-en"
                    value={nameEn}
                    onChange={(e) => setNameEn(e.target.value)}
                    placeholder="Product Name"
                  />
                </div>
              </div>

              {/* 카테고리 / 브랜드 */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>
                    카테고리 <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={groupId || '__none__'}
                    onValueChange={(v) => setGroupId(v === '__none__' ? '' : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="카테고리 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.length === 0 ? (
                        <SelectItem value="__none__" disabled>
                          카테고리가 없습니다
                        </SelectItem>
                      ) : (
                        categories.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>브랜드</Label>
                  <Select
                    value={brandId || '__none__'}
                    onValueChange={(v) => setBrandId(v === '__none__' ? '' : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="(없음)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">(없음)</SelectItem>
                      {brands.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* 제조사 / 소비자가 */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="new-mfr">제조사</Label>
                  <Input
                    id="new-mfr"
                    value={manufacturer}
                    onChange={(e) => setManufacturer(e.target.value)}
                    placeholder="제조사명 (선택)"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-msrp">소비자가 (원)</Label>
                  <Input
                    id="new-msrp"
                    type="number"
                    min="0"
                    value={msrp}
                    onChange={(e) => setMsrp(e.target.value)}
                    placeholder="0"
                  />
                </div>
              </div>

              {/* 설명 */}
              <div className="space-y-2">
                <Label htmlFor="new-desc">상품 설명</Label>
                <Textarea
                  id="new-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="상품 설명을 입력하세요 (선택)"
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>

          {/* 옵션 속성 카드 */}
          <Card>
            <CardHeader>
              <CardTitle>옵션 속성</CardTitle>
            </CardHeader>
            <CardContent>
              <ProductOptionAttributesEditor
                attributes={attributes}
                combinations={combinations}
                onAttributesChange={setAttributes}
                onCombinationsChange={setCombinations}
              />
              {!useAttributeMode && (
                <p className="mt-3 text-xs text-muted-foreground">
                  속성을 추가하지 않으면 &quot;기본&quot; 옵션 1개가 자동 생성됩니다.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 오른쪽: 저장 패널 */}
        <div>
          <Card className="sticky top-6">
            <CardContent className="space-y-4 pt-6">
              <div className="space-y-1 text-sm">
                <p className="font-medium">저장 요약</p>
                <Separator />
                <div className="flex justify-between py-1 text-muted-foreground">
                  <span>상품명</span>
                  <span className="max-w-[160px] truncate text-right font-medium text-foreground">
                    {name.trim() || '(미입력)'}
                  </span>
                </div>
                <div className="flex justify-between py-1 text-muted-foreground">
                  <span>카테고리</span>
                  <span className="font-medium text-foreground">
                    {categories.find((c) => c.id === groupId)?.name ?? '(미선택)'}
                  </span>
                </div>
                <div className="flex justify-between py-1 text-muted-foreground">
                  <span>옵션 수</span>
                  <span className="font-medium text-foreground">
                    {useAttributeMode ? `${combinations.length}개` : '1개 (기본)'}
                  </span>
                </div>
              </div>

              <Button
                className="w-full"
                onClick={handleSave}
                disabled={saving || !name.trim() || !groupId}
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {saving ? '저장 중...' : '상품 등록'}
              </Button>
              <Button variant="outline" className="w-full" asChild>
                <Link href="/d/seller-hub/products/list">취소</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
