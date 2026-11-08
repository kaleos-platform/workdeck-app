// 소재 미디어 폴더 → ScMedia 목록 동기화, 그리고 사진별 AI 설명·얼굴 판정.
// 폴더는 연결의 허용 root(공유 드라이브) 안이어야 한다(fail-closed).

import { prisma } from '@/lib/prisma'
import { generateTextForSpace } from '@/lib/ai/resolve'
import type { TextImage } from '@/lib/ai/providers'
import {
  DriveError,
  downloadThumbnail,
  driveTokenForSpace,
  FOLDER_MIME,
  getDriveFile,
  isWithinRoot,
  listFolderPage,
  type DriveFile,
} from './drive'

const MAX_FILES = 500
const MAX_FOLDERS = 50

/** 소재 폴더(하위 포함)의 이미지 목록을 맞춘다. 바뀐 파일(md5)은 판정을 초기화한다. 반환: 현재 이미지 수. */
export async function syncSourceMedia(spaceId: string, sourceId: string): Promise<number> {
  const [source, conn] = await Promise.all([
    prisma.scSource.findFirst({
      where: { id: sourceId, spaceId },
      select: { driveFolderId: true },
    }),
    prisma.scDriveConnection.findUnique({ where: { spaceId }, select: { rootId: true } }),
  ])
  if (!source?.driveFolderId) return 0
  // status 400 = 사람이 고쳐야 하는 설정 문제 → 수신 쪽에서 재시도 대신 「확인 필요」로 보낸다.
  if (!conn) throw new DriveError('드라이브 연결이 없습니다', 400)
  if (!conn.rootId) throw new DriveError('설정에서 공유 드라이브 링크를 등록하세요', 400)

  const token = await driveTokenForSpace(spaceId)
  const root = await getDriveFile(token, source.driveFolderId).catch((err) => {
    if (err instanceof DriveError && (err.status === 403 || err.status === 404)) {
      throw new DriveError('미디어 폴더를 열 수 없습니다(링크·공유 드라이브 구성원 확인)', 400)
    }
    throw err
  })
  if (root.mimeType !== FOLDER_MIME || !isWithinRoot(root, conn.rootId)) {
    throw new DriveError('미디어 폴더가 등록한 공유 드라이브 밖에 있습니다', 400)
  }

  const images: Array<DriveFile & { folderId: string; path: string }> = []
  const stack = [{ id: root.id, path: root.name }]
  let folders = 0
  while (stack.length && folders < MAX_FOLDERS && images.length < MAX_FILES) {
    const folder = stack.pop()!
    folders++
    let pageToken: string | undefined
    do {
      const page = await listFolderPage(token, folder.id, pageToken)
      for (const f of page.files) {
        if (f.mimeType === FOLDER_MIME) stack.push({ id: f.id, path: `${folder.path}/${f.name}` })
        else if (f.mimeType.startsWith('image/'))
          images.push({ ...f, folderId: folder.id, path: folder.path })
      }
      pageToken = page.nextPageToken
    } while (pageToken && images.length < MAX_FILES)
  }

  const seen = new Set<string>()
  for (const f of images) {
    seen.add(f.id)
    const meta = f.imageMediaMetadata
    const base = {
      sourceId,
      driveFolderId: f.folderId,
      path: f.path,
      name: f.name,
      mimeType: f.mimeType,
      md5: f.md5Checksum ?? null,
      driveModifiedAt: new Date(f.modifiedTime),
      takenAt: parseExifTime(meta?.time),
      width: meta?.width ?? null,
      height: meta?.height ?? null,
      removedAt: null,
    }
    const prev = await prisma.scMedia.findUnique({
      where: { spaceId_driveFileId: { spaceId, driveFileId: f.id } },
      select: { md5: true },
    })
    if (!prev) {
      await prisma.scMedia.create({ data: { spaceId, driveFileId: f.id, ...base } })
    } else {
      const changed = prev.md5 !== base.md5
      await prisma.scMedia.update({
        where: { spaceId_driveFileId: { spaceId, driveFileId: f.id } },
        // 파일이 바뀌면 설명·얼굴 판정을 다시 한다(사람 허용은 allowedMd5 불일치로 자동 무효).
        data: changed
          ? {
              ...base,
              faceStatus: 'UNKNOWN',
              caption: null,
              describedAt: null,
              describeError: null,
            }
          : base,
      })
    }
  }
  // 목록이 잘리지 않았을 때만 사라진 파일을 표시한다(잘렸으면 다음 동기화에서).
  if (images.length < MAX_FILES && folders < MAX_FOLDERS) {
    await prisma.scMedia.updateMany({
      where: { spaceId, sourceId, removedAt: null, driveFileId: { notIn: [...seen] } },
      data: { removedAt: new Date() },
    })
  }
  await prisma.scDriveConnection.update({
    where: { spaceId },
    data: { lastSyncedAt: new Date(), lastError: null },
  })
  return images.length
}

/** EXIF "2026:11:01 14:03:22" → Date(KST 가정). 형식이 다르면 null. */
export function parseExifTime(t?: string): Date | null {
  const m = t?.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/)
  return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+09:00`) : null
}

const DESCRIBE_SYSTEM = `사진을 블로그 작성자에게 설명한다. JSON 으로만 답한다:
{"caption":"무엇이 보이는지 한두 문장(추측 금지)","tags":["핵심 사물·장면 3~8개"],"face":"none|identifiable"}
- face: 얼굴로 사람을 알아볼 수 있으면 identifiable. 뒷모습·멀리 작은 사람·손만 보이면 none. 애매하면 identifiable.`

/** 설명 안 된 사진을 limit 장까지 처리. 반환: 처리 수. 얼굴 판정 실패는 UNKNOWN 유지(게시 불가). */
export async function describePendingMedia(spaceId: string, limit = 10): Promise<number> {
  const pending = await prisma.scMedia.findMany({
    // 일시 오류(429·5xx)는 1시간 뒤 다시 시도한다.
    where: {
      spaceId,
      removedAt: null,
      describedAt: null,
      OR: [{ describeError: null }, { updatedAt: { lt: new Date(Date.now() - 3600_000) } }],
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  })
  if (pending.length === 0) return 0
  const token = await driveTokenForSpace(spaceId)
  for (const m of pending) {
    try {
      const file = await getDriveFile(token, m.driveFileId)
      const { bytes, mimeType } = await downloadThumbnail(token, file, 1024)
      const { result } = await generateTextForSpace(
        spaceId,
        {
          system: DESCRIBE_SYSTEM,
          messages: [
            {
              role: 'user',
              content: `파일명: ${m.name}`,
              images: [
                { mimeType: mimeType as TextImage['mimeType'], data: bytes.toString('base64') },
              ],
            },
          ],
          responseFormat: 'json',
          temperature: 0,
          maxTokens: 500,
        },
        { actor: { type: 'system', id: 'sc-osmu-media' } }
      )
      const out = parseDescribe(result.content)
      await prisma.scMedia.update({
        where: { id: m.id },
        data: {
          caption: out.caption,
          tags: out.tags,
          faceStatus: out.face,
          describedAt: new Date(),
        },
      })
    } catch (err) {
      await prisma.scMedia.update({
        where: { id: m.id },
        data: { describeError: (err instanceof Error ? err.message : String(err)).slice(0, 300) },
      })
    }
  }
  return pending.length
}

export function parseDescribe(text: string): {
  caption: string | null
  tags: string[]
  face: 'NO_FACE' | 'FACE' | 'UNKNOWN'
} {
  let j: { caption?: unknown; tags?: unknown; face?: unknown } = {}
  try {
    j = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? '{}')
  } catch {
    // 형식 오류 → 판정 없음(UNKNOWN)
  }
  return {
    caption: typeof j.caption === 'string' ? j.caption.slice(0, 500) : null,
    tags: Array.isArray(j.tags) ? j.tags.filter((t) => typeof t === 'string').slice(0, 10) : [],
    face: j.face === 'none' ? 'NO_FACE' : j.face === 'identifiable' ? 'FACE' : 'UNKNOWN',
  }
}
