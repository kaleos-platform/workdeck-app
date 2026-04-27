// POST: multipart/form-data upload (`file`) 또는 { mode: 'ai', prompt, aspectRatio }
// DELETE: ?assetId=xxx  — Storage 객체까지 함께 제거.

import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import {
  MAX_UPLOAD_BYTES,
  UploadTooLargeError,
  deleteAsset,
  uploadAssetBytes,
} from '@/lib/supabase/storage'
import { selectImageProvider } from '@/lib/ai/providers'
import {
  CreditExceededError,
  commitImageCredit,
  refundImageCredit,
  reserveImageCredit,
} from '@/lib/ai/credit'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id } = await params
  const content = await prisma.content.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!content) return errorResponse('콘텐츠를 찾을 수 없습니다', 404)

  const assets = await prisma.contentAsset.findMany({
    where: { contentId: id },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json({ assets })
}

export async function POST(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id: contentId } = await params
  const content = await prisma.content.findFirst({
    where: { id: contentId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!content) return errorResponse('콘텐츠를 찾을 수 없습니다', 404)

  const contentType = req.headers.get('content-type') ?? ''

  // ─── 모드 1: 파일 직접 업로드 ───
  if (contentType.startsWith('multipart/form-data')) {
    const form = await req.formData()
    const file = form.get('file')
    const slotKey = (form.get('slotKey') as string | null) ?? null
    const alt = (form.get('alt') as string | null) ?? null
    if (!(file instanceof File)) return errorResponse('file 필드가 필요합니다', 400)
    if (file.size > MAX_UPLOAD_BYTES) {
      return errorResponse('20MB 를 초과하는 파일은 업로드할 수 없습니다', 413)
    }

    const bytes = Buffer.from(await file.arrayBuffer())
    try {
      const uploaded = await uploadAssetBytes({
        spaceId: resolved.space.id,
        contentId,
        bytes,
        mimeType: file.type || 'application/octet-stream',
      })
      const asset = await prisma.contentAsset.create({
        data: {
          spaceId: resolved.space.id,
          contentId,
          kind: 'IMAGE',
          slotKey,
          url: uploaded.publicUrl,
          storagePath: uploaded.storagePath,
          mimeType: uploaded.mimeType,
          alt,
        },
      })
      return NextResponse.json({ asset }, { status: 201 })
    } catch (err) {
      if (err instanceof UploadTooLargeError) {
        return errorResponse(err.message, 413, { code: err.code })
      }
      const msg = err instanceof Error ? err.message : String(err)
      return errorResponse('업로드에 실패했습니다', 500, { detail: msg })
    }
  }

  // ─── 모드 2: AI 이미지 생성 ───
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }
  const input = body as {
    mode?: string
    prompt?: string
    negativePrompt?: string
    aspectRatio?: '1:1' | '3:4' | '4:3' | '9:16' | '16:9'
    slotKey?: string
    alt?: string
  } | null
  if (input?.mode !== 'ai') return errorResponse('mode 는 ai 여야 합니다', 400)
  if (!input.prompt || input.prompt.length < 1) return errorResponse('prompt 가 필요합니다', 400)

  let provider
  try {
    provider = selectImageProvider()
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : '이미지 AI 공급자 미구성', 503)
  }

  let reservation
  try {
    reservation = await reserveImageCredit({
      spaceId: resolved.space.id,
      userId: resolved.user.id,
      provider: provider.name,
      model: process.env.GEMINI_IMAGE_MODEL ?? 'imagen-4.0-generate-001',
      prompt: input.prompt,
      negativePrompt: input.negativePrompt,
      aspectRatio: input.aspectRatio,
    })
  } catch (error) {
    if (error instanceof CreditExceededError) {
      return errorResponse('월간 이미지 크레딧이 소진되었습니다', 403, {
        code: error.code,
        yearMonth: error.yearMonth,
      })
    }
    throw error
  }

  try {
    const result = await provider.generate({
      prompt: input.prompt,
      negativePrompt: input.negativePrompt,
      aspectRatio: input.aspectRatio,
      numberOfImages: 1,
    })
    const first = result.images[0]
    const uploaded = await uploadAssetBytes({
      spaceId: resolved.space.id,
      contentId,
      bytes: first.bytes,
      mimeType: first.mimeType,
    })
    await commitImageCredit(reservation.reservationId, { outputCount: 1 })

    const asset = await prisma.contentAsset.create({
      data: {
        spaceId: resolved.space.id,
        contentId,
        kind: 'IMAGE',
        slotKey: input.slotKey ?? null,
        url: uploaded.publicUrl,
        storagePath: uploaded.storagePath,
        mimeType: uploaded.mimeType,
        alt: input.alt ?? null,
      },
    })
    return NextResponse.json(
      {
        asset,
        credit: {
          yearMonth: reservation.yearMonth,
          imageUsed: reservation.imageUsedAfter,
          imageQuota: reservation.imageQuota,
        },
      },
      { status: 201 }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await refundImageCredit(reservation.reservationId, { errorMessage: message })
    return errorResponse('AI 이미지 생성/저장에 실패했습니다', 502, { detail: message })
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id: contentId } = await params
  const url = new URL(req.url)
  const assetId = url.searchParams.get('assetId')
  if (!assetId) return errorResponse('assetId 가 필요합니다', 400)

  const asset = await prisma.contentAsset.findFirst({
    where: { id: assetId, contentId, spaceId: resolved.space.id },
  })
  if (!asset) return errorResponse('에셋을 찾을 수 없습니다', 404)

  if (asset.storagePath) {
    try {
      await deleteAsset(asset.storagePath)
    } catch {
      // storage 삭제 실패해도 DB 레코드는 제거 — 고아 객체는 수동 정리.
    }
  }
  await prisma.contentAsset.delete({ where: { id: assetId } })
  return NextResponse.json({ ok: true })
}
