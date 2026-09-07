import { redirect } from 'next/navigation'
import { getSellerHubProductPath } from '@/lib/deck-routes'

/**
 * AI 상품정보 추출 딥링크 — 별도 페이지를 렌더하지 않고 상품 상세로 리다이렉트하며
 * `?extract=1` 쿼리를 붙인다. 상품 상세 페이지가 이 쿼리를 읽어 다이얼로그를 연 상태로
 * 초기 렌더한다(product-detail-tabs.tsx 참고).
 */
export default async function ProductExtractRedirectPage({
  params,
}: {
  params: Promise<{ productId: string }>
}) {
  const { productId } = await params
  redirect(`${getSellerHubProductPath(productId)}?extract=1`)
}
