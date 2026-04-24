'use client'

import { use, useEffect, useState } from 'react'
import { notFound, useRouter } from 'next/navigation'

import {
  ListingForm,
  type ListingFormInitial,
} from '@/components/sh/products/listings/listing-form'
import { getSellerHubListingGroupPath } from '@/lib/deck-routes'

type ListingDetail = {
  id: string
  channel: { id: string; name: string; kind: string }
  internalCode: string | null
  searchName: string
  displayName: string
  keywords: string[]
  retailPrice: number | null
  baselinePrice: number | null
  discountAmount: number | null
  discountPercent: number | null
  status: 'ACTIVE' | 'SUSPENDED'
  effectiveStatus: 'ACTIVE' | 'SOLD_OUT' | 'SUSPENDED'
  availableStock: number
  autoAvailableStock: number
  channelAllocation: number | null
  memo: string | null
  items: Array<{
    optionId: string
    optionName: string
    sku: string | null
    productId: string
    productName: string
    productOfficialName: string
    brandName: string | null
    retailPrice: number | null
    costPrice: number | null
    quantity: number
    sortOrder: number
    optionStock: number
  }>
}

export default function ListingDetailPage({ params }: { params: Promise<{ listingId: string }> }) {
  const { listingId } = use(params)
  const router = useRouter()
  const [listing, setListing] = useState<ListingDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFoundFlag, setNotFoundFlag] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/sh/products/listings/${listingId}`)
        if (res.status === 404) {
          if (!cancelled) setNotFoundFlag(true)
          return
        }
        if (!res.ok) throw new Error('조회 실패')
        const data: { listing: ListingDetail } = await res.json()
        if (cancelled) return
        // 단일 상품 구성이면 상품×채널 그룹 상세로 리다이렉트
        const productIds = Array.from(new Set(data.listing.items.map((it) => it.productId)))
        if (productIds.length === 1) {
          router.replace(getSellerHubListingGroupPath(productIds[0], data.listing.channel.id))
          return
        }
        // 혼합 구성 → 기존 단일 편집 폼으로 fallback
        setListing(data.listing)
      } catch {
        if (!cancelled) setListing(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [listingId, router])

  if (notFoundFlag) notFound()
  if (loading) {
    return <p className="text-sm text-muted-foreground">불러오는 중...</p>
  }
  if (!listing) {
    return <p className="text-sm text-muted-foreground">상품을 불러올 수 없습니다.</p>
  }

  const initial: ListingFormInitial = {
    id: listing.id,
    channel: { id: listing.channel.id, name: listing.channel.name },
    internalCode: listing.internalCode,
    searchName: listing.searchName,
    displayName: listing.displayName,
    keywords: listing.keywords,
    retailPrice: listing.retailPrice,
    channelAllocation: listing.channelAllocation,
    status: listing.status,
    memo: listing.memo,
    availableStock: listing.availableStock,
    autoAvailableStock: listing.autoAvailableStock,
    items: listing.items.map((it) => ({
      optionId: it.optionId,
      optionName: it.optionName,
      sku: it.sku,
      productId: it.productId,
      productName: it.productName,
      brandName: it.brandName,
      quantity: it.quantity,
      retailPrice: it.retailPrice,
      optionStock: it.optionStock,
    })),
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-muted-foreground">{listing.channel.name} · 판매채널 상품</p>
        <h1 className="text-2xl font-bold">{listing.searchName}</h1>
      </div>
      <ListingForm mode="edit" initial={initial} />
    </div>
  )
}
