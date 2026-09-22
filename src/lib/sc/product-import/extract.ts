import { generateTextForSpace } from '@/lib/ai/resolve'
import { safeFetchHtml } from '@/lib/net/safe-fetch'
import { htmlToText, HTML_TEXT_MAX_CHARS } from '@/lib/sh/html-to-text'
import { prepareProductImages } from './images'
import { normalizeExtracted, productExtractSchema } from './schemas'
import { PRODUCT_EXTRACT_SYSTEM_PROMPT, buildProductExtractPrompt } from './prompts'

export class EmptyProductSourceError extends Error {}

export async function readProductPage(url: string) {
  const page = await safeFetchHtml(url)
  const extracted = htmlToText(page.html, HTML_TEXT_MAX_CHARS, {
    baseUrl: page.finalUrl,
    maxImageUrls: 100,
    detailImagesOnly: true,
  })
  return {
    text: extracted.text,
    title: extracted.title ?? '',
    imageUrls: extracted.imageUrls,
    sourceUrl: page.finalUrl,
    warnings: [
      ...(page.truncated || extracted.truncated
        ? ['페이지 텍스트가 길이 제한을 초과해 일부를 읽지 못했습니다']
        : []),
      ...(extracted.imageUrlsTruncated
        ? ['상세 이미지가 100개를 초과해 일부는 분석하지 못했습니다']
        : []),
    ],
  }
}

/** 링크 가져오기와 온보딩이 같은 이미지 분석·상품 어휘를 사용한다. */
export async function extractSalesProduct(
  spaceId: string,
  source: {
    text: string
    imageUrls: string[]
    sourceUrl?: string
    title?: string
    warnings?: string[]
  },
  audience = ''
) {
  const prepared = await prepareProductImages(source.imageUrls)
  prepared.warnings.unshift(...(source.warnings ?? []))
  if (source.text.trim().length < 50 && prepared.images.length === 0) {
    throw new EmptyProductSourceError(
      '상품 본문과 상세 이미지를 읽지 못했습니다. PDF·Markdown 자료 또는 상세 내용을 추가해주세요'
    )
  }
  const prompt = buildProductExtractPrompt({
    sourceLabel: source.sourceUrl ?? source.title ?? '자료',
    text: source.text,
  })
  let raw: ReturnType<typeof productExtractSchema.safeParse> | undefined
  let generated: Awaited<ReturnType<typeof generateTextForSpace>> | undefined
  for (let attempt = 0; attempt < 2; attempt++) {
    generated = await generateTextForSpace(spaceId, {
      system: PRODUCT_EXTRACT_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `${prompt}\n우선 고객군: ${audience || '자료에서 확인되는 구매자'}\n${prepared.warnings.join('\n')}`,
          images: prepared.images,
        },
      ],
      responseFormat: 'json',
      maxTokens: 6000,
      temperature: 0.2,
    })
    try {
      raw = productExtractSchema.safeParse(
        JSON.parse(
          generated.result.content
            .trim()
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/, '')
        )
      )
      if (raw.success) break
    } catch {
      /* JSON 형식 오류에 한해 한 번 재시도한다. */
    }
  }
  if (!raw?.success || !generated)
    throw new Error('상품 분석 결과를 해석하지 못했습니다. 다시 시도해주세요')
  const draft = normalizeExtracted(raw.data)
  if (!draft.name.trim())
    throw new EmptyProductSourceError(
      '페이지에서 상품명을 확인하지 못했습니다. 상세 자료를 추가해주세요'
    )
  if (source.sourceUrl)
    draft.customFields.push({ key: '출처', value: source.sourceUrl.slice(0, 2000) })
  // URL 목록은 서버가 실제 읽은 것으로만 구성한다. 모델이 출처를 만들어내지 않게 한다.
  // 긴 URL을 중간에서 자르면 출처 링크가 깨지므로 항목 단위로 묶는다.
  let sourceGroup = ''
  const sourceGroups: string[] = []
  for (const url of prepared.readUrls) {
    if (sourceGroup.length + url.length + 1 > 2000 && sourceGroup) {
      sourceGroups.push(sourceGroup)
      sourceGroup = ''
    }
    if (url.length <= 2000) sourceGroup += `${sourceGroup ? '\n' : ''}${url}`
  }
  if (sourceGroup) sourceGroups.push(sourceGroup)
  const availableFields = Math.max(0, 49 - draft.customFields.length)
  draft.customFields.push(
    ...sourceGroups.slice(0, availableFields).map((value) => ({ key: '상세 이미지 출처', value }))
  )
  if (sourceGroups.length > availableFields || prepared.readUrls.some((url) => url.length > 2000)) {
    prepared.warnings.push(
      '일부 긴 이미지 출처는 저장 길이 한도로 생략되었습니다. 원본 상품 페이지에서 확인해주세요.'
    )
  }
  if (prepared.warnings.length)
    draft.customFields.push({
      key: '분석 주의사항',
      value: prepared.warnings.join('\n').slice(0, 2000),
    })
  return {
    draft: { ...draft, sourceUrl: source.sourceUrl, warnings: prepared.warnings },
    imageAnalysis: {
      requested: source.imageUrls.length,
      read: prepared.readUrls.length,
      tiles: prepared.images.length,
    },
    providerName: generated.providerName,
    model: generated.result.model,
  }
}
