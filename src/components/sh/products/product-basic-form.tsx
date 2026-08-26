'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
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
  internalName: string | null
  nameEn: string | null
  description: string | null
  manufacturer: string | null
  manufactureCountry: string | null
  manufactureDate: string | null
  features: string[] | null
  certifications: string[] | null
  brandId: string | null
  groupId: string | null
}

/** AI 추출 패널이 폼 상태에 직접 주입할 수 있는 필드 — 서버가 직접 쓰면 autosave가 덮어쓴다 */
export type ProductApplyPatch = {
  description?: string | null
  features?: string[]
  certifications?: string[]
  manufacturer?: string | null
  manufactureCountry?: string | null
}

type Props = {
  productId: string
  onSaved?: () => void
  /** dirty(미저장 변경) 건수 변경 시 호출 — 상위 SaveStatusChip 통합용 */
  onDirtyChange?: (count: number) => void
  /** 자동 저장 시작/완료 시 호출 */
  onSavingChange?: (saving: boolean) => void
  /** 자동 저장 실패 메시지(또는 null) */
  onError?: (msg: string | null) => void
  /** 자동 저장 재시도 트리거를 상위에서 호출할 수 있게 노출 */
  onRetryRefAvailable?: (retry: () => void) => void
  /**
   * 상위(AI 추출 패널)가 폼 상태에 직접 값을 주입할 수 있게 노출한다.
   * 반환된 Promise는 이 주입으로 촉발된 autosave가 성공하면 resolve, 실패하면 reject된다 —
   * 호출자는 이 Promise가 끝난 뒤에만 "적용됨"으로 확정해야 한다.
   */
  onApplyRefAvailable?: (apply: (patch: ProductApplyPatch) => Promise<void>) => void
}

export function ProductBasicForm({
  productId,
  onSaved,
  onDirtyChange,
  onSavingChange,
  onError,
  onRetryRefAvailable,
  onApplyRefAvailable,
}: Props) {
  const [data, setData] = useState<ProductData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeSavePromiseRef = useRef<Promise<void> | null>(null)
  // onApplyRefAvailable로 주입된 값이 저장 완료(성공/실패)될 때까지 기다리는 호출자들
  const applyResolversRef = useRef<Array<{ resolve: () => void; reject: (err: Error) => void }>>([])

  const [brands, setBrands] = useState<Brand[]>([])
  const [categories, setCategories] = useState<Category[]>([])

  // 편집 상태
  const [name, setName] = useState('') // 공식 상품명
  const [internalName, setInternalName] = useState('') // 관리 상품명
  const [nameEn, setNameEn] = useState('')
  const [description, setDescription] = useState('')
  const [manufacturer, setManufacturer] = useState('')
  const [manufactureCountry, setManufactureCountry] = useState('')
  const [manufactureDate, setManufactureDate] = useState('')
  const [brandId, setBrandId] = useState('')
  const [groupId, setGroupId] = useState('')
  const [features, setFeatures] = useState<string[]>([])
  const [certifications, setCertifications] = useState<string[]>([])

  // '추가' 직후 새 입력칸으로 포커스·스크롤을 옮긴다. 항목이 많으면 새 행이
  // 화면 밖에 붙어 버튼이 안 먹은 것처럼 보인다.
  const featureInputsRef = useRef<Array<HTMLInputElement | null>>([])
  const certInputsRef = useRef<Array<HTMLInputElement | null>>([])
  const pendingFocusRef = useRef<{ list: 'features' | 'certifications'; idx: number } | null>(null)

  useEffect(() => {
    const pending = pendingFocusRef.current
    if (!pending) return
    pendingFocusRef.current = null
    const el =
      pending.list === 'features'
        ? featureInputsRef.current[pending.idx]
        : certInputsRef.current[pending.idx]
    el?.focus()
    el?.scrollIntoView({ block: 'nearest' })
  }, [features, certifications])

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
      setInternalName(prod.internalName ?? '')
      setNameEn(prod.nameEn ?? '')
      setDescription(prod.description ?? '')
      setManufacturer(prod.manufacturer ?? '')
      setManufactureCountry(prod.manufactureCountry ?? '')
      setManufactureDate(prod.manufactureDate ? prod.manufactureDate.slice(0, 7) : '')
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

  // dirty 계산 — 원본 data와 현재 입력값 비교
  const dirty = (() => {
    if (!data) return false
    const ymdToYm = (v: string | null) => (v ? v.slice(0, 7) : '')
    return (
      name !== data.name ||
      internalName !== (data.internalName ?? '') ||
      nameEn !== (data.nameEn ?? '') ||
      description !== (data.description ?? '') ||
      manufacturer !== (data.manufacturer ?? '') ||
      manufactureCountry !== (data.manufactureCountry ?? '') ||
      manufactureDate !== ymdToYm(data.manufactureDate) ||
      brandId !== (data.brandId ?? '') ||
      groupId !== (data.groupId ?? '') ||
      JSON.stringify(features.filter((f) => f.trim())) !== JSON.stringify(data.features ?? []) ||
      JSON.stringify(certifications.filter((c) => c.trim())) !==
        JSON.stringify(data.certifications ?? [])
    )
  })()

  // dirty 보고
  useEffect(() => {
    onDirtyChange?.(dirty ? 1 : 0)
  }, [dirty, onDirtyChange])

  // saving 보고
  useEffect(() => {
    onSavingChange?.(saving)
  }, [saving, onSavingChange])

  const runAutoSave = useCallback(async () => {
    if (!data) return
    if (!name.trim() || !groupId) return // invalid 상태에서는 스킵 (dirty는 표시)
    if (saving) return
    setSaving(true)
    onError?.(null)
    const promise = (async () => {
      try {
        const res = await fetch(`/api/sh/products/${productId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            internalName: internalName.trim() || null,
            nameEn: nameEn.trim() || null,
            description: description.trim() || null,
            manufacturer: manufacturer.trim() || null,
            manufactureCountry: manufactureCountry.trim() || null,
            manufactureDate: manufactureDate ? `${manufactureDate}-01` : null,
            brandId: brandId || null,
            groupId: groupId || null,
            features: features.filter((f) => f.trim()),
            certifications: certifications.filter((c) => c.trim()),
          }),
        })
        const resData = await res.json().catch(() => ({}))
        if (!res.ok) {
          const fieldErrors = resData?.errors?.fieldErrors as
            | Record<string, string[] | undefined>
            | undefined
          const firstField = fieldErrors
            ? Object.entries(fieldErrors).find(([, v]) => v && v.length > 0)
            : undefined
          const suffix = firstField ? ` (${firstField[0]}: ${firstField[1]?.[0]})` : ''
          throw new Error((resData?.message ?? '저장 실패') + suffix)
        }
        // 응답으로 받은 product를 data로 교체 — dirty 상태 자동 해소
        const savedProd: ProductData = resData.product ?? resData
        setData(savedProd)
        onSaved?.()
        applyResolversRef.current.splice(0).forEach((r) => r.resolve())
      } catch (err) {
        const message = err instanceof Error ? err.message : '저장 실패'
        onError?.(message)
        applyResolversRef.current.splice(0).forEach((r) => r.reject(new Error(message)))
      } finally {
        setSaving(false)
        activeSavePromiseRef.current = null
      }
    })()
    activeSavePromiseRef.current = promise
    await promise
  }, [
    data,
    name,
    internalName,
    nameEn,
    description,
    manufacturer,
    manufactureCountry,
    manufactureDate,
    brandId,
    groupId,
    features,
    certifications,
    productId,
    saving,
    onError,
    onSaved,
  ])

  const runAutoSaveRef = useRef(runAutoSave)
  runAutoSaveRef.current = runAutoSave

  const scheduleAutoSave = useCallback((delay = 400) => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null
      void runAutoSaveRef.current()
    }, delay)
  }, [])

  // dirty 상태가 되면 자동 저장 스케줄
  useEffect(() => {
    if (dirty) scheduleAutoSave(400)
  }, [
    dirty,
    name,
    internalName,
    nameEn,
    description,
    manufacturer,
    manufactureCountry,
    manufactureDate,
    brandId,
    groupId,
    features,
    certifications,
    scheduleAutoSave,
  ])

  // 재시도 핸들 노출
  useEffect(() => {
    if (onRetryRefAvailable) {
      onRetryRefAvailable(() => {
        onError?.(null)
        void runAutoSaveRef.current()
      })
    }
  }, [onRetryRefAvailable, onError])

  // AI 추출 패널 등 상위가 폼 상태에 직접 값을 주입할 수 있는 핸들 노출.
  // 서버가 직접 DB에 쓰면 사용자가 다른 필드를 편집하는 순간 autosave가 덮어쓰므로,
  // 반드시 이 함수로 로컬 state를 갱신해 기존 dirty/autosave 경로를 태워야 한다.
  useEffect(() => {
    if (!onApplyRefAvailable) return
    onApplyRefAvailable((patch: ProductApplyPatch) => {
      if (patch.description !== undefined) setDescription(patch.description ?? '')
      if (patch.features !== undefined) setFeatures(patch.features)
      if (patch.certifications !== undefined) setCertifications(patch.certifications)
      if (patch.manufacturer !== undefined) setManufacturer(patch.manufacturer ?? '')
      if (patch.manufactureCountry !== undefined)
        setManufactureCountry(patch.manufactureCountry ?? '')
      return new Promise<void>((resolve, reject) => {
        applyResolversRef.current.push({ resolve, reject })
      })
    })
  }, [onApplyRefAvailable])

  // 언마운트 정리
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    }
  }, [])

  // 페이지 이탈 방지 — dirty 또는 저장 중이면 경고
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty || saving) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty, saving])

  if (loading) {
    return <p className="text-sm text-muted-foreground">불러오는 중...</p>
  }

  if (!data) {
    return <p className="text-sm text-muted-foreground">상품을 찾을 수 없습니다</p>
  }

  return (
    <div className="space-y-5">
      {/* 공식 상품명 (판매채널 노출) — 필수 */}
      <div className="space-y-2">
        <Label htmlFor="bf-name">
          공식 상품명 <span className="text-destructive">*</span>
        </Label>
        <Input
          id="bf-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="고객에게 표시되는 공식 상품명"
        />
        <p className="text-xs text-muted-foreground">판매채널에 노출되는 이름입니다.</p>
      </div>

      {/* 관리 상품명 (내부 식별) + 영문 상품명 — 선택 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="bf-internal-name">관리 상품명</Label>
          <Input
            id="bf-internal-name"
            value={internalName}
            onChange={(e) => setInternalName(e.target.value)}
            placeholder="내부 식별용 짧은 이름 (선택)"
          />
          <p className="text-xs text-muted-foreground">비워두면 공식 상품명이 표시됩니다.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="bf-name-en">영문 상품명</Label>
          <Input
            id="bf-name-en"
            value={nameEn}
            onChange={(e) => setNameEn(e.target.value)}
            placeholder="Product Name (선택)"
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
          <Label htmlFor="bf-mfr-date">제조년월</Label>
          <Input
            id="bf-mfr-date"
            type="month"
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
            onClick={() =>
              setFeatures((prev) => {
                pendingFocusRef.current = { list: 'features', idx: prev.length }
                return [...prev, '']
              })
            }
          >
            <Plus className="mr-1 h-3 w-3" />
            추가
          </Button>
        </div>
        <div className="space-y-1.5">
          {features.map((f, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <Input
                ref={(el) => {
                  featureInputsRef.current[idx] = el
                }}
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
            onClick={() =>
              setCertifications((prev) => {
                pendingFocusRef.current = { list: 'certifications', idx: prev.length }
                return [...prev, '']
              })
            }
          >
            <Plus className="mr-1 h-3 w-3" />
            추가
          </Button>
        </div>
        <div className="space-y-1.5">
          {certifications.map((c, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <Input
                ref={(el) => {
                  certInputsRef.current[idx] = el
                }}
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
    </div>
  )
}
