'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type Brand = { id: string; name: string }
type Category = { id: string; name: string }

type ProductData = {
  id: string
  name: string
  nameEn: string | null
  code: string | null
  description: string | null
  manufacturer: string | null
  manufactureCountry: string | null
  manufactureDate: string | null
  msrp: number | string | null
  features: string[] | null
  certifications: string[] | null
  brandId: string | null
  groupId: string | null
}

type Props = {
  productId: string
  onSaved?: () => void
}

export function ProductBasicForm({ productId, onSaved }: Props) {
  const [data, setData] = useState<ProductData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [brands, setBrands] = useState<Brand[]>([])
  const [categories, setCategories] = useState<Category[]>([])

  // 편집 상태
  const [name, setName] = useState('')
  const [nameEn, setNameEn] = useState('')
  const [code, setCode] = useState('')
  const [description, setDescription] = useState('')
  const [manufacturer, setManufacturer] = useState('')
  const [manufactureCountry, setManufactureCountry] = useState('')
  const [manufactureDate, setManufactureDate] = useState('')
  const [msrp, setMsrp] = useState('')
  const [brandId, setBrandId] = useState('')
  const [groupId, setGroupId] = useState('')
  const [features, setFeatures] = useState<string[]>([])
  const [certifications, setCertifications] = useState<string[]>([])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [prodRes, brandRes, catRes] = await Promise.all([
        fetch(`/api/sh/products/${productId}`),
        fetch('/api/sh/brands'),
        fetch('/api/sh/categories'),
      ])
      if (!prodRes.ok) return
      // API는 { product: {...} }로 wrap해서 응답한다
      const json = await prodRes.json()
      const prod: ProductData = json.product ?? json
      setData(prod)
      setName(prod.name)
      setNameEn(prod.nameEn ?? '')
      setCode(prod.code ?? '')
      setDescription(prod.description ?? '')
      setManufacturer(prod.manufacturer ?? '')
      setManufactureCountry(prod.manufactureCountry ?? '')
      setManufactureDate(prod.manufactureDate ? prod.manufactureDate.split('T')[0] : '')
      // msrp는 Prisma Decimal이라 string/number 둘 다 올 수 있음
      setMsrp(prod.msrp != null ? String(prod.msrp) : '')
      setBrandId(prod.brandId ?? '')
      setFeatures(Array.isArray(prod.features) ? prod.features : [])
      setCertifications(Array.isArray(prod.certifications) ? prod.certifications : [])

      if (brandRes.ok) {
        const bData = await brandRes.json()
        setBrands(bData.brands ?? [])
      }
      if (catRes.ok) {
        const cData = await catRes.json()
        const cats: Category[] = cData.categories ?? []
        setCategories(cats)
        // 상품에 groupId가 있으면 사용, 없으면 첫 번째 카테고리로 기본 설정
        setGroupId(prod.groupId ?? cats[0]?.id ?? '')
      }
    } finally {
      setLoading(false)
    }
  }, [productId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  async function handleSave() {
    if (!name.trim()) {
      toast.error('상품명을 입력해 주세요')
      return
    }
    if (!groupId) {
      toast.error('카테고리를 선택해 주세요')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/sh/products/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          nameEn: nameEn.trim() || null,
          code: code.trim() || null,
          description: description.trim() || null,
          manufacturer: manufacturer.trim() || null,
          manufactureCountry: manufactureCountry.trim() || null,
          manufactureDate: manufactureDate || null,
          msrp: msrp ? parseFloat(msrp) : null,
          brandId: brandId || null,
          groupId: groupId || null,
          features: features.filter((f) => f.trim()),
          certifications: certifications.filter((c) => c.trim()),
        }),
      })
      const resData = await res.json()
      if (!res.ok) {
        const fieldErrors = resData?.errors?.fieldErrors as
          | Record<string, string[] | undefined>
          | undefined
        const firstField = fieldErrors
          ? Object.entries(fieldErrors).find(([, v]) => v && v.length > 0)
          : undefined
        const suffix = firstField ? ` (${firstField[0]}: ${firstField[1]?.[0]})` : ''
        const detail = resData?.detail ? `: ${resData.detail}` : ''
        throw new Error((resData?.message ?? '저장 실패') + suffix + detail)
      }
      toast.success('상품 정보가 저장되었습니다')
      onSaved?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">불러오는 중...</p>
  }

  if (!data) {
    return <p className="text-sm text-muted-foreground">상품을 찾을 수 없습니다</p>
  }

  return (
    <div className="space-y-5">
      {/* 이름 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="bf-name">상품명 (한국어) *</Label>
          <Input id="bf-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bf-name-en">상품명 (영문)</Label>
          <Input
            id="bf-name-en"
            value={nameEn}
            onChange={(e) => setNameEn(e.target.value)}
            placeholder="Product Name"
          />
        </div>
      </div>

      {/* 제품코드 / 소비자가 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="bf-code">제품코드</Label>
          <Input
            id="bf-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="(없음)"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bf-msrp">소비자가 (원)</Label>
          <Input
            id="bf-msrp"
            type="number"
            min="0"
            value={msrp}
            onChange={(e) => setMsrp(e.target.value)}
            placeholder="0"
          />
        </div>
      </div>

      {/* 브랜드 / 카테고리 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
              {categories.length === 0 && (
                <SelectItem value="__none__" disabled>
                  카테고리가 없습니다
                </SelectItem>
              )}
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 제조사 정보 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="bf-mfr">제조사</Label>
          <Input
            id="bf-mfr"
            value={manufacturer}
            onChange={(e) => setManufacturer(e.target.value)}
            placeholder="제조사명"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bf-country">제조국</Label>
          <Input
            id="bf-country"
            value={manufactureCountry}
            onChange={(e) => setManufactureCountry(e.target.value)}
            placeholder="예: 대한민국"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bf-mfr-date">제조일</Label>
          <Input
            id="bf-mfr-date"
            type="date"
            value={manufactureDate}
            onChange={(e) => setManufactureDate(e.target.value)}
          />
        </div>
      </div>

      {/* 설명 */}
      <div className="space-y-2">
        <Label htmlFor="bf-desc">상품 설명</Label>
        <Textarea
          id="bf-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="상품 설명을 입력하세요"
          rows={3}
        />
      </div>

      {/* 특징 목록 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>특징 (features)</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setFeatures((prev) => [...prev, ''])}
          >
            <Plus className="mr-1 h-3 w-3" />
            추가
          </Button>
        </div>
        <div className="space-y-1.5">
          {features.map((f, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <Input
                value={f}
                onChange={(e) =>
                  setFeatures((prev) => prev.map((x, i) => (i === idx ? e.target.value : x)))
                }
                placeholder={`특징 ${idx + 1}`}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => setFeatures((prev) => prev.filter((_, i) => i !== idx))}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {features.length === 0 && (
            <p className="text-xs text-muted-foreground">특징을 추가하세요</p>
          )}
        </div>
      </div>

      {/* 인증 정보 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>인증 정보 (certifications)</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setCertifications((prev) => [...prev, ''])}
          >
            <Plus className="mr-1 h-3 w-3" />
            추가
          </Button>
        </div>
        <div className="space-y-1.5">
          {certifications.map((c, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <Input
                value={c}
                onChange={(e) =>
                  setCertifications((prev) => prev.map((x, i) => (i === idx ? e.target.value : x)))
                }
                placeholder={`인증 ${idx + 1} (예: KC인증번호)`}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => setCertifications((prev) => prev.filter((_, i) => i !== idx))}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {certifications.length === 0 && (
            <p className="text-xs text-muted-foreground">인증 정보를 추가하세요</p>
          )}
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving || !groupId} className="w-full sm:w-auto">
        {saving ? '저장 중...' : '저장'}
      </Button>
    </div>
  )
}
