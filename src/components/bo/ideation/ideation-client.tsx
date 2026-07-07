'use client'

import { useState } from 'react'
import { IdeationForm } from './ideation-form'
import { IdeationHistory } from './ideation-history'

type Product = { id: string; name: string }

interface IdeationClientProps {
  products: Product[]
}

export function IdeationClient({ products }: IdeationClientProps) {
  // 폼 성공 시 history 새로 고침을 위한 키
  const [refreshKey, setRefreshKey] = useState(0)

  function handleSuccess() {
    setRefreshKey((k) => k + 1)
  }

  return (
    <div className="space-y-8">
      <section className="space-y-4 rounded-lg border p-5">
        <h2 className="font-medium">소구점 발굴 실행</h2>
        <IdeationForm products={products} onSuccess={handleSuccess} />
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">실행 이력</h2>
        <IdeationHistory refreshKey={refreshKey} />
      </section>
    </div>
  )
}
