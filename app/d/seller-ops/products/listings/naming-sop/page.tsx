import { NamingSopWizard } from '@/components/sh/products/listings/naming-sop-wizard'

type Props = { searchParams: Promise<{ listingId?: string }> }

// 상품명 작성 SOP (가이드 §22 STEP 01~08)
// - ?listingId=... : 해당 판매채널 상품의 상품명·검색어를 이어서 편집하고 마지막에 반영
// - 파라미터가 없으면 저장 대상이 없는 연습용 스크래치패드로 동작한다
export default async function NamingSopPage({ searchParams }: Props) {
  const { listingId } = await searchParams
  return <NamingSopWizard listingId={listingId ?? null} />
}
