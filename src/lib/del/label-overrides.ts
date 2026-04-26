import type { DelFieldMapping } from '@/lib/del/format-templates'

export const FIELD_KEYS: ReadonlySet<DelFieldMapping> = new Set<DelFieldMapping>([
  'recipientName',
  'phone',
  'postalCode',
  'fullAddress',
  'deliveryMessage',
  'productName',
  'productQuantity',
  'orderNumber',
  'orderDate',
  'channelName',
  'trackingNumber',
  'barcode',
])

/**
 * 클라이언트가 보낸 overrides JSON 을 허용 키 + trim 비어있지 않은 문자열만 남겨 정규화.
 */
export function sanitizeOverrides(raw: unknown): Partial<Record<DelFieldMapping, string>> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Partial<Record<DelFieldMapping, string>> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!FIELD_KEYS.has(k as DelFieldMapping)) continue
    if (typeof v !== 'string') continue
    const trimmed = v.trim()
    if (trimmed === '') continue
    out[k as DelFieldMapping] = trimmed
  }
  return out
}
