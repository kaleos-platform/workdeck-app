'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ProductForm, type ProductFormState } from './product-form'
import { SellerOpsProductPicker } from './seller-ops-product-picker'
import { invProductToDraft } from '@/lib/sc/product-import/map-inv-product'

// 상품 추가 보조 경로의 공유 셸. 두 경로가 다른 건 입력 스텝과 draft 생성 방법뿐이고,
// 검토·저장은 기존 ProductForm 을 그대로 재사용한다(스키마·에디터 이중 관리 방지).

export type AddProductMode = 'seller-ops'

type Step = 'input' | 'loading' | 'review'

type Props = {
  mode: AddProductMode | null
  onClose: () => void
}

const TITLES: Record<AddProductMode, { title: string; description: string }> = {
  'seller-ops': {
    title: '세일즈 운영에서 상품 가져오기',
    description: '가져올 상품을 고르면 내용을 확인·수정한 뒤 저장합니다.',
  },
}

export function AddProductDialog({ mode, onClose }: Props) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('input')
  const [draft, setDraft] = useState<Partial<ProductFormState> | null>(null)

  function reset() {
    setStep('input')
    setDraft(null)
  }

  function close() {
    reset()
    onClose()
  }

  const meta = mode ? TITLES[mode] : null

  return (
    <Dialog
      open={mode != null}
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{meta?.title}</DialogTitle>
          <DialogDescription>{meta?.description}</DialogDescription>
        </DialogHeader>

        {step === 'input' && mode === 'seller-ops' && (
          <SellerOpsProductPicker
            onPick={(product) => {
              setDraft(invProductToDraft(product))
              setStep('review')
            }}
          />
        )}

        {step === 'loading' && (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…
          </div>
        )}

        {step === 'review' && draft && (
          <ProductForm
            mode="create"
            initial={draft}
            onSaved={() => {
              // 설정 화면은 서버 렌더 + searchParams 탭이라 refresh 만으로 URL 유지된 채 목록이 갱신된다.
              close()
              router.refresh()
            }}
            onCancel={reset}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
