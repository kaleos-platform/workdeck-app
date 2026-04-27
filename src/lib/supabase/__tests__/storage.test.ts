import { MAX_UPLOAD_BYTES, UploadTooLargeError, buildStoragePath, extFromMime } from '../storage'

describe('extFromMime', () => {
  it.each([
    ['image/png', 'png'],
    ['image/jpeg', 'jpg'],
    ['image/jpg', 'jpg'],
    ['image/webp', 'webp'],
    ['image/gif', 'gif'],
    ['application/octet-stream', 'bin'],
  ])('%s → %s', (mime, expected) => {
    expect(extFromMime(mime)).toBe(expected)
  })
})

describe('buildStoragePath', () => {
  it('{spaceId}/content/{contentId}/{uuid}.{ext} 형식', () => {
    const p = buildStoragePath({
      spaceId: 'sp1',
      contentId: 'c1',
      mimeType: 'image/png',
    })
    expect(p).toMatch(
      /^sp1\/content\/c1\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/
    )
  })
  it('mimeType 에 따라 확장자가 달라진다', () => {
    const p1 = buildStoragePath({ spaceId: 'sp1', contentId: 'c1', mimeType: 'image/jpeg' })
    expect(p1.endsWith('.jpg')).toBe(true)
  })
})

describe('UploadTooLargeError', () => {
  it('code 상수 + size/limit 보존', () => {
    const err = new UploadTooLargeError(50_000_000, MAX_UPLOAD_BYTES)
    expect(err.code).toBe('UPLOAD_TOO_LARGE')
    expect(err.size).toBe(50_000_000)
    expect(err.limit).toBe(MAX_UPLOAD_BYTES)
    expect(err).toBeInstanceOf(Error)
  })
})
