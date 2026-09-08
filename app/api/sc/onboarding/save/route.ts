import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { brandProfileSchema, productSchema, personaSchema } from '@/lib/sc/schemas'
import { normalizeResourceUrl } from '@/lib/sc/onboarding/crawl'

const inputSchema = z.object({
  brandProfile: brandProfileSchema,
  products: z
    .array(productSchema.extend({ sourceUrl: z.string().url().max(2000).optional() }))
    .max(1000),
  personas: z.array(personaSchema).max(3),
})

function sourceFromFields(fields: unknown): string | undefined {
  if (!Array.isArray(fields)) return undefined
  return fields.find((field) => field && field.key === '출처' && typeof field.value === 'string')
    ?.value
}

function canonicalSource(source: string | undefined): string | undefined {
  if (!source) return undefined
  try {
    return normalizeResourceUrl(source)
  } catch {
    return source
  }
}

/** 검토한 설정을 한 번에 저장한다. 재시도·새로고침·동시 요청에도 기존 상품을 복제하지 않는다. */
export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error
  const body: unknown = await req.json().catch(() => null)
  const parsed = inputSchema.safeParse(body)
  if (!parsed.success)
    return errorResponse('검토 항목을 확인해주세요', 400, { issues: parsed.error.flatten() })
  const spaceId = resolved.space.id
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${spaceId}))`
        const existing = await tx.product.findMany({
          where: { spaceId },
          select: { name: true, customFields: true },
        })
        const existingPersonas = await tx.persona.findMany({
          where: { spaceId },
          select: { name: true },
        })
        const names = new Set(existing.map((p) => p.name.trim().toLocaleLowerCase()))
        const sources = new Set(
          existing.map((p) => canonicalSource(sourceFromFields(p.customFields))).filter(Boolean)
        )
        const personaNames = new Set(existingPersonas.map((p) => p.name.trim().toLocaleLowerCase()))
        let savedProducts = 0
        let savedPersonas = 0
        for (const product of parsed.data.products) {
          const name = product.name.trim()
          if (!name) throw new Error('상품명을 확인해주세요')
          const sourceUrl = canonicalSource(
            product.sourceUrl ?? sourceFromFields(product.customFields)
          )
          if (names.has(name.toLocaleLowerCase()) || (sourceUrl && sources.has(sourceUrl))) continue
          const customFields = [...(product.customFields ?? [])]
          if (sourceUrl && !sourceFromFields(customFields) && customFields.length < 50)
            customFields.push({ key: '출처', value: sourceUrl })
          await tx.product.create({
            data: {
              spaceId,
              name,
              oneLinerPitch: product.oneLinerPitch ?? null,
              customFields,
              isActive: product.isActive,
            },
          })
          names.add(name.toLocaleLowerCase())
          if (sourceUrl) sources.add(sourceUrl)
          savedProducts++
        }
        for (const persona of parsed.data.personas) {
          const name = persona.name.trim()
          if (!name) throw new Error('고객군 이름을 확인해주세요')
          if (personaNames.has(name.toLocaleLowerCase())) continue
          await tx.persona.create({
            data: {
              spaceId,
              name,
              jobTitle: persona.jobTitle ?? null,
              industry: persona.industry ?? null,
              customFields: persona.customFields ?? [],
              isActive: persona.isActive,
            },
          })
          personaNames.add(name.toLocaleLowerCase())
          savedPersonas++
        }
        const brand = parsed.data.brandProfile
        if (!brand.companyName.trim()) throw new Error('브랜드명을 확인해주세요')
        const data = {
          companyName: brand.companyName.trim(),
          shortDescription: brand.shortDescription ?? null,
          toneOfVoice: brand.toneOfVoice ?? [],
          customFields: brand.customFields ?? [],
        }
        await tx.brandProfile.upsert({
          where: { spaceId },
          create: { spaceId, ...data },
          update: data,
        })
        await tx.salesContentOnboarding.upsert({
          where: { spaceId },
          create: { spaceId, completedAt: new Date() },
          update: { completedAt: new Date() },
        })
        return {
          savedProducts,
          savedPersonas,
          skippedProducts: parsed.data.products.length - savedProducts,
          skippedPersonas: parsed.data.personas.length - savedPersonas,
        }
      },
      { timeout: 30_000 }
    )
    return NextResponse.json(result)
  } catch {
    return errorResponse(
      '설정을 저장하지 못했습니다. 입력을 확인하고 다시 시도해주세요. 일부만 저장되지는 않습니다',
      500
    )
  }
}
