import sharp from 'sharp'

import { sniffImage } from '@/lib/hiring/storage'

export { sniffImage }
type ImageMime = NonNullable<ReturnType<typeof sniffImage>>

// sharp 오류 문구는 경로·값을 담을 수 있어 종류만 남긴다.
function decodeFailureClass(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (/premature|truncat|end of (file|stream)/i.test(message)) return 'TRUNCATED'
  if (/pixel limit/i.test(message)) return 'PIXEL_LIMIT'
  if (/unsupported image format/i.test(message)) return 'UNSUPPORTED_FORMAT'
  if (/corrupt|invalid|bad |not a /i.test(message)) return 'CORRUPT'
  return 'OTHER'
}
const undecodable = (error: unknown) =>
  Error('ASSET_UNDECODABLE', { cause: decodeFailureClass(error) })

// 다시 인코딩해 EXIF·XMP·IPTC·PNG 텍스트를 지운다. sharp는 withMetadata 없이는 메타데이터를 쓰지 않는다.
export async function stripImageMetadata(bytes: Uint8Array, mimeType: ImageMime) {
  try {
    const animated = mimeType === 'image/gif' || mimeType === 'image/webp'
    const image = sharp(bytes, { animated })
    let output: Promise<Buffer>
    if (mimeType === 'image/png') output = image.png().toBuffer()
    else if (mimeType === 'image/jpeg')
      // EXIF 방향값이 사라지므로 픽셀에 먼저 반영한다.
      output = image.rotate().jpeg({ quality: 92 }).toBuffer()
    else if (mimeType === 'image/webp') output = image.webp({ quality: 92 }).toBuffer()
    else output = image.gif().toBuffer()
    return new Uint8Array(await output)
  } catch (error) {
    throw undecodable(error)
  }
}

export function isSvg(bytes: Uint8Array) {
  return /^\s*(?:﻿)?(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!doctype[^>]*>\s*)?<svg[\s>]/i.test(
    Buffer.from(bytes.subarray(0, 4096)).toString('utf8')
  )
}

// 외부 파일·네트워크를 가리키는 SVG는 렌더링하지 않는다. 내부 참조(#)와 data:만 허용한다.
const SVG_EXTERNAL_REF = /(?:href|src)\s*=\s*["'](?!#|data:)|url\(\s*["']?(?!#|data:)/i

// 벡터는 메타데이터·스크립트를 함께 버리도록 PNG로 굽는다. 표시 크기는 요소가 정하므로 선명도만 높인다.
async function rasterizeSvg(bytes: Uint8Array) {
  if (SVG_EXTERNAL_REF.test(Buffer.from(bytes).toString('utf8'))) throw Error('SVG_EXTERNAL_REF')
  try {
    return new Uint8Array(await sharp(bytes, { density: 192 }).png().toBuffer())
  } catch (error) {
    throw undecodable(error)
  }
}

export type CleanImage = { bytes: Uint8Array; mimeType: ImageMime }

export async function cleanImage(bytes: Uint8Array): Promise<CleanImage> {
  const mimeType = sniffImage(bytes)
  if (mimeType) return { bytes: await stripImageMetadata(bytes, mimeType), mimeType }
  if (isSvg(bytes)) return { bytes: await rasterizeSvg(bytes), mimeType: 'image/png' }
  throw Error('ASSET_UNSUPPORTED_TYPE')
}

// 디자인 편집기 저장 한도(scene + 내보낸 이미지 4 MiB) 안에 들도록 해상도는 두고 손실 압축한다.
// scene 내장 이미지는 투명도를 지키는 WebP, 내보낸 이미지는 편집기 저장 형식과 같은 흰 배경 JPEG.
// GIF(움직임)·이미 작은 이미지는 그대로 둔다.
export async function lossyCompress(clean: CleanImage, to: 'webp' | 'jpeg'): Promise<CleanImage> {
  if (clean.mimeType !== 'image/png' && clean.mimeType !== 'image/jpeg') return clean
  try {
    const image = sharp(clean.bytes)
    const output =
      to === 'webp'
        ? image.webp({ quality: 85 })
        : image.flatten({ background: '#ffffff' }).jpeg({ quality: 85, mozjpeg: true })
    const bytes = new Uint8Array(await output.toBuffer())
    return bytes.byteLength < clean.bytes.byteLength
      ? { bytes, mimeType: `image/${to}` as ImageMime }
      : clean
  } catch (error) {
    throw undecodable(error)
  }
}

export const sniffLabel = (bytes: Uint8Array) =>
  sniffImage(bytes)?.replace('image/', '') ?? (isSvg(bytes) ? 'svg' : 'unknown')

// 형식 진단용. 값·id 없이 선언 형식|실제 형식|결과만 남긴다.
export function imageDiagKey(declared: string, sniffed: string, outcome: string) {
  const safe = /^[a-z0-9.+/-]{1,40}$/.test(declared) ? declared : declared ? 'other' : 'none'
  return `${safe}|${sniffed}|${outcome}`
}
export const failureLabel = (error: unknown) => {
  const message = error instanceof Error ? error.message : ''
  const code = /^[A-Z][A-Z_]{2,80}$/.test(message) ? message : 'OTHER'
  const cause = error instanceof Error && typeof error.cause === 'string' ? error.cause : ''
  return cause ? `${code}:${cause}` : code
}

// data:[타입][;매개변수][;base64],본문. 대소문자·charset·URL 인코딩을 모두 받는다.
function parseDataUrl(value: unknown): { declared: string; bytes: Uint8Array | null } | null {
  if (typeof value !== 'string' || !/^data:/i.test(value)) return null
  const comma = value.indexOf(',')
  if (comma < 0) return { declared: '', bytes: null }
  const [type, ...params] = value.slice(5, comma).split(';')
  const declared = type.trim().toLowerCase()
  const body = value.slice(comma + 1)
  if (params.some((param) => param.trim().toLowerCase() === 'base64')) {
    const compact = body.replace(/\s+/g, '')
    if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(compact)) return { declared, bytes: null }
    return { declared, bytes: Buffer.from(compact, 'base64') }
  }
  try {
    return { declared, bytes: Buffer.from(decodeURIComponent(body), 'utf8') }
  } catch {
    return { declared, bytes: null }
  }
}

type Row = Record<string, unknown>

async function cleanSceneFile(id: string, file: Row, diag: (key: string) => void) {
  const parsed = parseDataUrl(file.dataURL)
  const declaredField = typeof file.mimeType === 'string' ? file.mimeType.toLowerCase() : ''
  if (!parsed) {
    const remote = typeof file.dataURL === 'string' && /^https?:/i.test(file.dataURL)
    const code = remote ? 'SCENE_IMAGE_REMOTE' : 'SCENE_IMAGE_NO_DATA'
    diag(imageDiagKey(declaredField, 'none', code))
    throw Error(code)
  }
  const declared = parsed.declared || declaredField
  if (!parsed.bytes?.byteLength) {
    diag(imageDiagKey(declared, 'none', 'SCENE_IMAGE_MALFORMED'))
    throw Error('SCENE_IMAGE_MALFORMED')
  }
  const sniffed = sniffLabel(parsed.bytes)
  try {
    const clean = await lossyCompress(await cleanImage(parsed.bytes), 'webp')
    diag(imageDiagKey(declared, sniffed, sniffed === 'svg' ? 'CONVERTED' : 'OK'))
    const { created } = file
    return {
      id,
      mimeType: clean.mimeType,
      dataURL: `data:${clean.mimeType};base64,${Buffer.from(clean.bytes).toString('base64')}`,
      ...(typeof created === 'number' ? { created } : {}),
    }
  } catch (error) {
    const outcome = failureLabel(error)
    diag(imageDiagKey(declared, sniffed, outcome))
    throw Error(
      error instanceof Error && error.message === 'ASSET_UNSUPPORTED_TYPE'
        ? 'SCENE_IMAGE_UNSUPPORTED'
        : error instanceof Error && error.message === 'SVG_EXTERNAL_REF'
          ? 'SVG_EXTERNAL_REF'
          : 'SCENE_IMAGE_CORRUPT'
    )
  }
}

// 화면에 보이는 것만 남긴다. 삭제 요소·미사용 파일·customData·편집기 상태는 싣지 않는다.
// 진단이 첫 실패에서 끊기지 않게 파일을 모두 본 뒤 첫 오류를 던진다.
export async function sanitizeScene(raw: Row, diag: (key: string) => void = () => undefined) {
  if (!Array.isArray(raw.elements)) throw Error('SCENE_INVALID')
  const source = (raw.files && typeof raw.files === 'object' ? raw.files : {}) as Record<
    string,
    Row | null
  >
  const hasFile = (id: unknown) =>
    typeof id === 'string' && Object.hasOwn(source, id) && !!source[id]
  const elements = (raw.elements as Row[])
    .filter((element) => element?.isDeleted !== true)
    // 파일이 없는 이미지 요소는 편집기에서도 빈 칸이고 내보낸 PNG에는 영향이 없다.
    .filter((element) => {
      if (element?.type !== 'image' || hasFile(element.fileId)) return true
      diag(imageDiagKey('', 'none', 'ELEMENT_DROPPED_NO_FILE'))
      return false
    })
    .map((element) => {
      const kept = { ...element }
      delete kept.customData
      return kept
    })
  const files: Record<string, unknown> = {}
  let failure: unknown
  for (const id of new Set(elements.map((element) => element.fileId))) {
    if (!hasFile(id)) continue
    try {
      files[id as string] = await cleanSceneFile(id as string, source[id as string] as Row, diag)
    } catch (error) {
      failure ??= error
    }
  }
  if (failure) throw failure
  const { type, version, source: origin, appState } = raw
  const background = (appState as Row | undefined)?.viewBackgroundColor
  // 없는 키가 undefined로 남으면 scene 검증(JSON 값만 허용)에 걸린다.
  return JSON.parse(
    JSON.stringify({
      type,
      version,
      source: origin,
      elements,
      ...(typeof background === 'string' ? { appState: { viewBackgroundColor: background } } : {}),
      files,
    })
  )
}
