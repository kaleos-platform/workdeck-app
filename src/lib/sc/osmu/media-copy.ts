// 제안 시점 사진 복사. 승인 화면·게시본은 이 복사본만 쓴다 → 승인 뒤 드라이브가 바뀌어도 게시 사진은 그대로(§10).

import { prisma } from '@/lib/prisma'
import { ToolUserError } from '@/lib/agent/tools/errors'
import { buildStoragePath, SALES_CONTENT_BUCKET, uploadStorageBytes } from '@/lib/supabase/storage'
import { downloadThumbnail, driveTokenForSpace, getDriveFile } from './drive'

type MediaForPublish = {
  faceStatus: 'UNKNOWN' | 'NO_FACE' | 'FACE'
  md5: string | null
  allowedMd5: string | null
  removedAt: Date | null
}

/** 게시 가능 = 얼굴 없음 판정 또는 사람이 지금 파일(md5)에 대해 허용. 미판정은 불가(fail-closed). */
export function isPublishable(m: MediaForPublish): boolean {
  if (m.removedAt || !m.md5) return false
  if (m.faceStatus === 'NO_FACE') return true
  return m.allowedMd5 === m.md5
}

export type PhotoChoice = { slot: number; mediaId: string }

/**
 * 요청의 소재에 속한 게시 가능 사진만 복사한다. (requestId, mediaId, md5) 로 멱등.
 * 드라이브 현재 md5 가 DB 와 다르면 거부(허용 판정이 이전 파일 기준이므로 동기화 후 재제안).
 */
export async function copyRequestPhotos(input: {
  spaceId: string
  requestId: string
  photos: PhotoChoice[]
}): Promise<Array<PhotoChoice & { copyId: string }>> {
  const { spaceId, requestId, photos } = input
  if (photos.length === 0) return []
  const request = await prisma.scPublishRequest.findFirst({
    where: { id: requestId, spaceId },
    select: { sourceId: true, state: true, contentId: true },
  })
  if (!request?.sourceId) throw new ToolUserError('발행 요청의 소재를 찾을 수 없습니다')
  // 복사(드라이브·storage 호출) 전에 거를 수 있는 건 거른다.
  if (request.contentId || (request.state !== 'READY' && request.state !== 'PROPOSED')) {
    throw new ToolUserError('작성 대기 상태의 발행 요청이 아닙니다')
  }

  const ids = [...new Set(photos.map((p) => p.mediaId))]
  const media = await prisma.scMedia.findMany({
    where: { id: { in: ids }, spaceId, sourceId: request.sourceId },
  })
  const byId = new Map(media.map((m) => [m.id, m]))
  for (const id of ids) {
    const m = byId.get(id)
    if (!m) throw new ToolUserError(`이 요청의 소재 사진이 아닙니다: ${id}`)
    if (!isPublishable(m))
      throw new ToolUserError(`게시 허용되지 않은 사진입니다(얼굴·미판정): ${m.name}`)
  }

  let token: string | null = null
  const copyIdByMedia = new Map<string, string>()
  for (const id of ids) {
    const m = byId.get(id)!
    const existing = await prisma.scMediaCopy.findUnique({
      where: { requestId_mediaId_md5: { requestId, mediaId: id, md5: m.md5! } },
      select: { id: true },
    })
    if (existing) {
      copyIdByMedia.set(id, existing.id)
      continue
    }
    token ??= await driveTokenForSpace(spaceId)
    const file = await getDriveFile(token, m.driveFileId)
    if (file.md5Checksum !== m.md5) {
      throw new ToolUserError(
        `드라이브에서 사진이 바뀌었습니다(${m.name}). 동기화 후 다시 제안하세요`
      )
    }
    const { bytes, mimeType } = await downloadThumbnail(token, file)
    const storagePath = buildStoragePath({ spaceId, contentId: `osmu-${requestId}`, mimeType })
    const url = await uploadStorageBytes(SALES_CONTENT_BUCKET, storagePath, bytes, mimeType)
    // 동시 제안 경합 시 unique 충돌 → 먼저 만든 행을 쓴다(올린 파일 하나는 고아로 남음, 무해).
    const copy = await prisma.scMediaCopy.upsert({
      where: { requestId_mediaId_md5: { requestId, mediaId: id, md5: m.md5! } },
      create: {
        spaceId,
        requestId,
        mediaId: id,
        md5: m.md5!,
        storagePath,
        url,
        mimeType,
        width: m.width,
        height: m.height,
      },
      update: {},
      select: { id: true },
    })
    copyIdByMedia.set(id, copy.id)
  }
  return photos.map((p) => ({ ...p, copyId: copyIdByMedia.get(p.mediaId)! }))
}
