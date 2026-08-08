import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { uploadBrandLogo, ALLOWED_LOGO_MIME, MAX_LOGO_BYTES } from '@/lib/sc/onboarding/storage'

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }
  const file = form.get('file')
  if (!(file instanceof File)) return errorResponse('file 필드가 필요합니다', 400)
  if (!ALLOWED_LOGO_MIME.has(file.type)) {
    return errorResponse('PNG·JPG·WebP·SVG 이미지만 업로드할 수 있습니다', 400)
  }
  if (file.size > MAX_LOGO_BYTES) {
    return errorResponse('로고가 용량 제한(2MB)을 초과했습니다', 400)
  }

  try {
    const { publicUrl } = await uploadBrandLogo({
      spaceId,
      data: new Uint8Array(await file.arrayBuffer()),
      mimeType: file.type,
    })

    // BrandProfile이 아직 없으면 회사명 placeholder로 생성 (온보딩 중 로고 먼저 올리는 케이스)
    const profile = await prisma.brandProfile.upsert({
      where: { spaceId },
      create: { spaceId, companyName: '', logoUrl: publicUrl },
      update: { logoUrl: publicUrl },
    })
    return NextResponse.json({ logoUrl: profile.logoUrl })
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : '로고 업로드에 실패했습니다', 500)
  }
}
