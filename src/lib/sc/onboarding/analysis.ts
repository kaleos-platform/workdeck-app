import { z } from 'zod'
import { draftProductSchema } from './schemas'

const cachedAnalysisSchema = z.object({
  analysis: z.object({ audience: z.string(), draft: draftProductSchema }),
})

export function readProductAnalysis(raw: string, audience: string) {
  try {
    const parsed = cachedAnalysisSchema.safeParse(JSON.parse(raw))
    return parsed.success && parsed.data.analysis.audience === audience
      ? parsed.data.analysis.draft
      : null
  } catch {
    return null
  }
}

/** 같은 URL 또는 같은 상품명을 가진 초안을 중복 생성하지 않는다. */
export function uniqueDraftProducts(products: z.infer<typeof draftProductSchema>[]) {
  const urls = new Set<string>()
  const names = new Set<string>()
  return products.filter((product) => {
    const name = product.name.trim().toLocaleLowerCase()
    if ((product.sourceUrl && urls.has(product.sourceUrl)) || names.has(name)) return false
    if (product.sourceUrl) urls.add(product.sourceUrl)
    names.add(name)
    return true
  })
}
