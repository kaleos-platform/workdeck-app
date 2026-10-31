import sharp from 'sharp'

type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

export function sniffImage(bytes: Uint8Array): ImageMime | null {
  const head = Buffer.from(bytes.subarray(0, 12))
  if (head.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png'
  if (head.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) return 'image/jpeg'
  if (head.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif'
  if (head.subarray(0, 4).toString() === 'RIFF' && head.subarray(8, 12).toString() === 'WEBP')
    return 'image/webp'
  return null
}

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
  } catch {
    throw Error('ASSET_UNDECODABLE')
  }
}

type Row = Record<string, unknown>

// 화면에 보이는 것만 남긴다. 삭제 요소·미사용 파일·customData·편집기 상태는 싣지 않는다.
export async function sanitizeScene(raw: Row) {
  if (!Array.isArray(raw.elements)) throw Error('SCENE_INVALID')
  const elements = (raw.elements as Row[])
    .filter((element) => element?.isDeleted !== true)
    .map((element) => {
      const kept = { ...element }
      delete kept.customData
      return kept
    })
  const source = (raw.files ?? {}) as Record<string, Row>
  const files: Record<string, unknown> = {}
  for (const id of new Set(elements.map((element) => element.fileId))) {
    if (typeof id !== 'string' || !Object.hasOwn(source, id)) continue
    const match = String(source[id]?.dataURL ?? '').match(
      /^data:[^;,]+;base64,([A-Za-z0-9+/=\s]+)$/
    )
    if (!match) throw Error('SCENE_IMAGE_UNSUPPORTED')
    const bytes = Buffer.from(match[1], 'base64')
    const mimeType = sniffImage(bytes)
    if (!mimeType) throw Error('SCENE_IMAGE_UNSUPPORTED')
    const clean = await stripImageMetadata(bytes, mimeType)
    const { created } = source[id]
    files[id] = {
      id,
      mimeType,
      dataURL: `data:${mimeType};base64,${Buffer.from(clean).toString('base64')}`,
      ...(typeof created === 'number' ? { created } : {}),
    }
  }
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
