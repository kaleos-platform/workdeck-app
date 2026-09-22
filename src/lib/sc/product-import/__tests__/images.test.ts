/** @jest-environment node */
import sharp from 'sharp'
import { prepareProductImages } from '../images'
import { safeFetchBinary } from '@/lib/net/safe-fetch'

jest.mock('@/lib/net/safe-fetch', () => ({ safeFetchBinary: jest.fn() }))
const fetchImage = jest.mocked(safeFetchBinary)

it('세로로 긴 상세 이미지를 잘리지 않게 나누고 실패한 이미지 출처를 반환한다', async () => {
  const bytes = await sharp({
    create: { width: 1000, height: 4200, channels: 3, background: '#fff' },
  })
    .png()
    .toBuffer()
  fetchImage
    .mockResolvedValueOnce({
      finalUrl: 'https://example.com/detail.png',
      bytes,
      mimeType: 'image/png',
    })
    .mockRejectedValueOnce(new Error('차단'))
  const result = await prepareProductImages([
    'https://example.com/detail.png',
    'https://example.com/blocked.png',
  ])
  expect(result.images.length).toBe(3)
  expect(result.readUrls).toEqual(['https://example.com/detail.png'])
  expect(result.warnings.join(' ')).toContain('https://example.com/blocked.png')
  const sizes = await Promise.all(
    result.images.map((i) => sharp(Buffer.from(i.data, 'base64')).metadata())
  )
  expect(sizes.reduce((sum, m) => sum + (m.height ?? 0), 0)).toBe(4200)
})
