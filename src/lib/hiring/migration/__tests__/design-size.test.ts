/** @jest-environment node */
import sharp from 'sharp'
import { resolveUploadMime } from '@/lib/hiring/storage'
import { compressDesignExport, sanitizeScene } from '../opening-sanitize'
import { planOpeningTemplate, type OpeningTemplatePacket } from '../template-import'

// 사진처럼 부드러운 색 변화 + 잡음 — 무손실 PNG는 크고 손실 압축이 잘 듣는다.
async function noisyPng(width = 600, height = 400) {
  const raw = Buffer.alloc(width * height * 3)
  let seed = 1
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (let c = 0; c < 3; c++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff
        const wave = 128 + 90 * Math.sin(x / (9 + c)) * Math.cos(y / 13)
        raw[(y * width + x) * 3 + c] = Math.max(0, Math.min(255, wave + (seed % 17) - 8))
      }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer()
}

describe('디자인 이미지 압축', () => {
  it('scene 내장 PNG는 같은 해상도의 WebP로 줄인다', async () => {
    const png = await noisyPng()
    const scene = await sanitizeScene({
      elements: [{ type: 'image', id: 'i', fileId: 'f' }],
      files: {
        f: { mimeType: 'image/png', dataURL: `data:image/png;base64,${png.toString('base64')}` },
      },
    })
    const file = scene.files.f
    expect(file.mimeType).toBe('image/webp')
    const bytes = Buffer.from(file.dataURL.split(',')[1], 'base64')
    const meta = await sharp(bytes).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 600, 400])
    expect(bytes.length).toBeLessThan(png.length)
  })

  it('scene 내장 GIF는 움직임을 지키려고 형식을 유지한다', async () => {
    const gif = await sharp({
      create: { width: 4, height: 4, channels: 3, background: '#f00' },
    })
      .gif()
      .toBuffer()
    const scene = await sanitizeScene({
      elements: [{ type: 'image', id: 'i', fileId: 'f' }],
      files: {
        f: { mimeType: 'image/gif', dataURL: `data:image/gif;base64,${gif.toString('base64')}` },
      },
    })
    expect(scene.files.f.mimeType).toBe('image/gif')
  })

  it('디자인 내보낸 이미지는 같은 해상도의 JPEG로 줄인다', async () => {
    const png = await noisyPng()
    const out = await compressDesignExport(png)
    expect(out.mimeType).toBe('image/jpeg')
    const meta = await sharp(out.bytes).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 600, 400])
    expect(out.bytes.length).toBeLessThan(png.length)
  })
})

describe('템플릿 디자인 저장 한도', () => {
  const asset = (path: string) => ({
    sourceImageKey: path,
    copiedImagePath: `space/migration/${path}/checksum`,
    verified: true as const,
    sha256: 'b'.repeat(64),
    sizeBytes: 20,
  })
  function packet(text: string): OpeningTemplatePacket {
    const detail = [{ type: 'content', enabled: true, resource_id: '10' }]
    return {
      sourceSpaceId: '1',
      sourceTemplateId: '19',
      sourceWebOrigin: 'https://opening.work',
      template: {
        id: '19',
        brand_id: '1',
        status: 1,
        name: '합성 템플릿',
        created_at: '2023-09-04T00:00:00.000Z',
        updated_at: '2023-09-04T00:00:00.000Z',
        image_key: '',
        data: detail,
      },
      content: {
        detail,
        resources: {
          '10': {
            ...asset('image'),
            sourceSpaceId: '1',
            sourceTemplateId: '19',
            hasSceneSource: true,
            scene: { elements: [{ type: 'text', id: 't', text }], files: {} },
          },
        },
        images: {},
      },
    }
  }
  const target = { sourceSpaceId: '1', spaceId: 'space', ownerUserId: 'owner' }

  it('편집기 저장 한도(4 MiB)를 넘는 디자인은 공고와 같은 오류로 막는다', () => {
    expect(() => planOpeningTemplate(packet('x'.repeat(4 * 1024 * 1024)), target)).toThrow(
      'Migration design exceeds editable size'
    )
  })

  it('한도 안의 디자인은 통과한다', () => {
    expect(() => planOpeningTemplate(packet('x'), target)).not.toThrow()
  })
})

describe('디자인 저장 업로드 형식', () => {
  it('선언과 무관하게 실제 바이트로 형식을 정한다', async () => {
    const jpeg = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#fff' } })
      .jpeg()
      .toBuffer()
    expect(resolveUploadMime(jpeg, undefined)).toBe('image/jpeg')
    expect(resolveUploadMime(jpeg, 'image/png')).toBe('image/jpeg')
    expect(resolveUploadMime(await noisyPng(2, 2), undefined)).toBe('image/png')
  })

  it('이미지가 아니면 선언값, 없으면 기존 기본값(PNG)을 쓴다', () => {
    expect(resolveUploadMime(Buffer.from('%PDF-1.4'), 'application/pdf')).toBe('application/pdf')
    expect(resolveUploadMime(Buffer.from('????'), undefined)).toBe('image/png')
  })
})
