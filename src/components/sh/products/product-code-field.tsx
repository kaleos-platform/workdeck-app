'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Props = {
  productId: string
  /** 저장 성공 시 호출 — 상위에서 SKU 파생 컴포넌트를 리마운트하는 용도 */
  onSaved?: () => void
  /** dirty(미저장 변경) 건수 변경 시 호출 — 상위 SaveStatusChip 통합용 */
  onDirtyChange?: (count: number) => void
  /** 자동 저장 시작/완료 시 호출 */
  onSavingChange?: (saving: boolean) => void
  /** 자동 저장 실패 메시지(또는 null) */
  onError?: (msg: string | null) => void
  /** 자동 저장 재시도 트리거를 상위에서 호출할 수 있게 노출 */
  onRetryRefAvailable?: (retry: () => void) => void
}

/**
 * 제품코드 편집 — 옵션 관리 섹션 전용.
 *
 * 제품코드는 상품 메타데이터가 아니라 옵션 관리코드(SKU)의 접두어이자
 * 엑셀 재고 입출고 임포트의 상품 매칭 키다. 그래서 기본 정보가 아니라
 * 옵션 관리 섹션 최상단에 둔다.
 */
export function ProductCodeField({
  productId,
  onSaved,
  onDirtyChange,
  onSavingChange,
  onError,
  onRetryRefAvailable,
}: Props) {
  const [original, setOriginal] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/sh/products/${productId}`)
      if (!res.ok) return
      const json = await res.json()
      const prod = json.product ?? json
      const value = (prod?.code ?? '') as string
      setOriginal(value)
      setCode(value)
    } finally {
      setLoading(false)
    }
  }, [productId])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = original !== null && code !== original

  useEffect(() => {
    onDirtyChange?.(dirty ? 1 : 0)
  }, [dirty, onDirtyChange])

  useEffect(() => {
    onSavingChange?.(saving)
  }, [saving, onSavingChange])

  const runAutoSave = useCallback(async () => {
    if (original === null) return
    if (saving) return
    if (code === original) return
    setSaving(true)
    onError?.(null)
    setFieldError(null)
    try {
      const res = await fetch(`/api/sh/products/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() || null }),
      })
      const resData = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(resData?.message ?? '제품코드 저장 실패')
      }
      const savedCode = (resData?.product?.code ?? '') as string
      setOriginal(savedCode)
      setCode(savedCode)
      onSaved?.()
    } catch (err) {
      const msg = err instanceof Error ? err.message : '제품코드 저장 실패'
      setFieldError(msg)
      onError?.(msg)
    } finally {
      setSaving(false)
    }
  }, [code, original, productId, saving, onError, onSaved])

  const runAutoSaveRef = useRef(runAutoSave)
  runAutoSaveRef.current = runAutoSave

  const scheduleAutoSave = useCallback((delay = 400) => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null
      void runAutoSaveRef.current()
    }, delay)
  }, [])

  useEffect(() => {
    if (dirty) scheduleAutoSave(400)
  }, [dirty, code, scheduleAutoSave])

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    }
  }, [])

  // 재시도 핸들 노출
  useEffect(() => {
    if (onRetryRefAvailable) {
      onRetryRefAvailable(() => {
        onError?.(null)
        setFieldError(null)
        void runAutoSaveRef.current()
      })
    }
  }, [onRetryRefAvailable, onError])

  return (
    <div className="rounded-md border px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Label htmlFor="pcf-code" className="shrink-0">
          제품코드
        </Label>
        <Input
          id="pcf-code"
          value={code}
          disabled={loading}
          onChange={(e) => setCode(e.target.value)}
          placeholder="(없음)"
          className={`max-w-xs ${fieldError ? 'border-destructive' : ''}`}
          aria-invalid={fieldError ? true : undefined}
        />
        <p className="text-xs text-muted-foreground">
          관리코드(SKU) 접두어이자 엑셀 재고 입출고 임포트의 상품 매칭 키로 사용됩니다.
        </p>
      </div>
      {fieldError && <p className="mt-2 text-xs text-destructive">{fieldError}</p>}
    </div>
  )
}
