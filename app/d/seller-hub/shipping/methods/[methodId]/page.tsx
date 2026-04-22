'use client'

import { use } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MethodLabelsTable } from '@/components/sh/shipping/method-labels-table'

type PageProps = {
  params: Promise<{ methodId: string }>
}

export default function ShippingMethodDetailPage({ params }: PageProps) {
  const { methodId } = use(params)
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/d/seller-hub/shipping/methods">
            <ArrowLeft className="mr-1 h-4 w-4" />
            배송 방식 관리
          </Link>
        </Button>
      </div>
      <MethodLabelsTable methodId={methodId} />
    </div>
  )
}
