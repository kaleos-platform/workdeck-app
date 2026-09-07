// 이 라우트는 InvProduct 를 직접 쓰지 않고 appliedAt 도 찍지 않는다 — 읽기 전용.
// src/components/sh/products/product-basic-form.tsx 는 폼이 들고 있는 모든 필드를 디바운스
// autosave로 매 변경마다 PATCH 한다. 서버가 여기서 description 을 직접 쓰면, 그 직후
// 사용자가 다른 필드를 한 글자만 고쳐도 400ms 뒤 autosave PATCH가 옛 값으로 덮어써버린다.
// 그래서 추출값은 폼의 React state 로 흘려보내고, 실제 저장은 폼의 기존 autosave PATCH가
// 담당한다. 여기서는 그 state 주입에 필요한 { values, before } 만 계산해 돌려준다.
// appliedAt 확정은 클라이언트가 autosave 성공을 확인한 뒤 별도 라우트(applied/route.ts)가 찍는다.

import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { productExtractApplySchema } from '@/lib/sh/schemas'
import type { ExtractedProductInfo } from '@/lib/sh/product-extract'

type Params = { params: Promise<{ productId: string; jobId: string }> }
type ApplyField =
  | 'description'
  | 'features'
  | 'certifications'
  | 'manufacturer'
  | 'manufactureCountry'

// InvProduct 필드명 → 추출 결과(ExtractedProductInfo) 키. manufactureCountry 만 이름이 다르다
// (추출 스키마는 originCountry, InvProduct 는 manufactureCountry).
const RESULT_KEY: Record<ApplyField, keyof ExtractedProductInfo> = {
  description: 'description',
  features: 'features',
  certifications: 'certifications',
  manufacturer: 'manufacturer',
  manufactureCountry: 'originCountry',
}

export async function POST(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId, jobId } = await params

  const job = await prisma.productExtractionJob.findFirst({
    where: { id: jobId, productId, spaceId: resolved.space.id },
    select: {
      id: true,
      status: true,
      result: true,
      appliedAt: true,
      appliedBefore: true,
      rolledBackAt: true,
    },
  })
  if (!job) return errorResponse('작업을 찾을 수 없습니다', 404)
  if (job.status !== 'SUCCEEDED') {
    return errorResponse('완료된 추출 작업에만 적용할 수 있습니다', 409)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = productExtractApplySchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const result = job.result as unknown as ExtractedProductInfo | null
  if (!result) return errorResponse('추출 결과가 없습니다', 409)

  const product = await prisma.invProduct.findFirst({
    where: { id: productId, spaceId: resolved.space.id },
    select: {
      description: true,
      features: true,
      certifications: true,
      manufacturer: true,
      manufactureCountry: true,
    },
  })
  if (!product) return errorResponse('상품을 찾을 수 없습니다', 404)

  const values: Record<string, unknown> = {}
  const before: Record<string, unknown> = {}
  for (const field of parsed.data.fields as ApplyField[]) {
    values[field] = result[RESULT_KEY[field]]
    before[field] = product[field as keyof typeof product]
  }

  // appliedBefore 는 여기서만 정확히 남길 수 있다 — 이 시점 이후 클라이언트가 폼 state 를
  // 거쳐 autosave PATCH 를 보내면 InvProduct 값이 바뀌므로, applied/route.ts 가 호출되는
  // 시점에는 이미 "적용 전" 값을 다시 읽을 방법이 없다(productExtractAppliedSchema 에도
  // before 를 실어보낼 필드가 없다). 그래서 apply 단계에서 스냅샷을 잡 row 에 미리 저장해두고,
  // applied 단계는 appliedAt 만 찍는다. 이미 확정된(appliedAt 있음) 잡은 스냅샷을 덮어쓰지 않는다
  // — 롤백 대상 값이 최초 적용 시점 값으로 고정되어야 하기 때문.
  //
  // 스냅샷은 "한 번 잡히면 끝"이다(appliedBefore 가 null 일 때만 기록). appliedAt 유무로만
  // 판단하면 다음 구멍이 열린다: apply → autosave 성공 → applied 호출 실패(네트워크) →
  // 사용자가 다시 apply. 이때 appliedAt 은 여전히 null 이라 스냅샷이 "이미 AI 값으로 덮인
  // InvProduct" 로 갱신되고, 롤백이 원본이 아니라 AI 값을 복원하게 된다.
  //
  // 롤백된 잡을 다시 적용하는 것은 새 사이클이다 — 이때는 스냅샷을 반드시 새로 잡아야 한다.
  // 이전 사이클의 스냅샷을 남겨두면 롤백이 그 사이클에 적용했던 필드만 되돌리고,
  // 이번에 적용한 나머지 필드는 AI 값인 채로 남는다.
  const finalized = Boolean(job.appliedAt) && !job.rolledBackAt
  const startsNewCycle = job.appliedBefore == null || Boolean(job.rolledBackAt)

  if (!finalized) {
    await prisma.productExtractionJob.update({
      where: { id: jobId },
      data: {
        appliedFields: parsed.data.fields,
        ...(startsNewCycle ? { appliedBefore: before as Prisma.InputJsonValue } : {}),
      },
    })
  }

  return NextResponse.json({ values, before })
}
