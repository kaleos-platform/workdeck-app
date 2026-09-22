import sharp from 'sharp'
import { safeFetchBinary } from '@/lib/net/safe-fetch'
import type { TextImage } from '@/lib/ai/providers'

const MAX_INPUT_BYTES = 30 * 1024 * 1024
const MAX_OUTPUT_BYTES = 12 * 1024 * 1024
const MAX_TILES = 64
const TILE_HEIGHT = 1800

/** 상세 이미지의 글자가 축소되어 사라지지 않도록 세로로 나눈다. 실패한 출처는 숨기지 않는다. */
export async function prepareProductImages(urls: string[]): Promise<{
  images: TextImage[]
  readUrls: string[]
  warnings: string[]
}> {
  const images: TextImage[] = []
  const readUrls: string[] = []
  const warnings: string[] = []
  let inputBytes = 0
  let outputBytes = 0
  const started = Date.now()
  const unique = [...new Set(urls)]
  for (let index = 0; index < unique.length; index++) {
    const url = unique[index]
    if (
      Date.now() - started > 30_000 ||
      inputBytes >= MAX_INPUT_BYTES ||
      outputBytes >= MAX_OUTPUT_BYTES ||
      images.length >= MAX_TILES
    ) {
      warnings.push(
        `이미지 분석 한도에 도달해 ${unique.length - index}개를 읽지 못했습니다. 남은 상세 내용은 PDF·Markdown 자료로 보완해주세요.`
      )
      break
    }
    try {
      const fetched = await safeFetchBinary(url, {
        maxBytes: Math.min(8 * 1024 * 1024, MAX_INPUT_BYTES - inputBytes),
      })
      inputBytes += fetched.bytes.length
      const source = sharp(fetched.bytes, { limitInputPixels: 40_000_000, animated: false })
      const meta = await source.metadata()
      if (!meta.width || !meta.height || meta.width < 16 || meta.height < 16) continue
      const width = Math.min(meta.width, 1200)
      const resized = await source
        .resize({ width, withoutEnlargement: true })
        .toBuffer({ resolveWithObject: true })
      let complete = true
      for (let top = 0; top < resized.info.height; top += TILE_HEIGHT) {
        const data = await sharp(resized.data)
          .extract({
            left: 0,
            top,
            width: resized.info.width,
            height: Math.min(TILE_HEIGHT, resized.info.height - top),
          })
          .jpeg({ quality: 85 })
          .toBuffer()
        if (images.length >= MAX_TILES || outputBytes + data.length > MAX_OUTPUT_BYTES) {
          complete = false
          warnings.push(`이미지 일부를 분석하지 못했습니다: ${url}`)
          break
        }
        outputBytes += data.length
        images.push({ mimeType: 'image/jpeg', data: data.toString('base64') })
      }
      if (complete) readUrls.push(url)
    } catch {
      warnings.push(`이미지를 읽지 못했습니다: ${url}`)
    }
  }
  return { images, readUrls, warnings }
}
