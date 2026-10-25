import { z } from 'zod'

export const NAVER_COMMERCE_PROVIDER = 'naver-commerce'

export type NaverCommerceStoreSecret = { clientId: string; clientSecret: string }
export type NaverCommerceSecret = { stores: Record<string, NaverCommerceStoreSecret> }
export type NaverCommerceStoreConfig = {
  key: string
  label: string
  startDate: string
  representativeChannelId: string | null
  backfilledThrough: string | null
  /** 이 스토어만 다른 출고 위치(예: 브랜드별 3PL 계정). 없으면 config.locationId */
  locationId?: string | null
}
export type NaverCommerceConfig = { locationId: string; stores: NaverCommerceStoreConfig[] }

export const nbaesongStoreLocationId = (
  config: Pick<NaverCommerceConfig, 'locationId'>,
  store: Pick<NaverCommerceStoreConfig, 'locationId'>
): string => store.locationId || config.locationId

export type NaverSkuMapping = { nsBarcode: string; pickingQuantityPerOrder: number }
export type NaverProductOrder = {
  orderId: string
  productOrderId: string
  paymentDate: string
  productName: string
  quantity: number
  remainQuantity: number
  totalPaymentAmount: number
  remainPaymentAmount: number
  productOrderStatus: string
  claimType: string | null
  deliveryAttributeType: string | null
  logisticsCompanyId: string | null
  skuMappings: NaverSkuMapping[]
}

// 워커가 보낸 주문의 ingest 검증용. NaverProductOrder 와 같은 모양을 유지한다.
const text = z.string().max(500)
export const NaverProductOrderSchema = z.object({
  orderId: text,
  productOrderId: text,
  paymentDate: z.iso.datetime({ offset: true }),
  productName: text,
  quantity: z.number().int().nonnegative(),
  remainQuantity: z.number().int().nonnegative(),
  totalPaymentAmount: z.number().nonnegative(),
  remainPaymentAmount: z.number().nonnegative(),
  productOrderStatus: text,
  claimType: text.nullable(),
  deliveryAttributeType: text.nullable(),
  logisticsCompanyId: text.nullable(),
  skuMappings: z
    .array(z.object({ nsBarcode: text, pickingQuantityPerOrder: z.number().int().nonnegative() }))
    .max(100),
}) satisfies z.ZodType<NaverProductOrder>
