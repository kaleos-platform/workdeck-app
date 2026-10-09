import { ListingsTwoPane } from '@/components/sh/products/listings/listings-two-pane'

type Props = { searchParams: Promise<{ channel?: string }> }

// ?channel= — 다른 화면(상품 매칭 등)에서 돌아올 때 그 채널을 선택한 채로 연다.
export default async function ListingsPage({ searchParams }: Props) {
  const { channel } = await searchParams
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">판매채널 상품</h1>
        <p className="text-sm text-muted-foreground">채널별로 판매할 상품 묶음을 구성합니다</p>
      </div>
      <ListingsTwoPane initialChannelId={channel ?? null} />
    </div>
  )
}
