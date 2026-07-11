import { MAX_UPLOAD_BYTES, UploadTooLargeError, buildStoragePath, extFromMime } from '../storage'

// ─── serviceClient 환경변수 처리 유닛 테스트 ────────────────────────────────────
// 모듈 캐시(cached 변수)를 초기화하기 위해 각 테스트마다 jest.resetModules() + 재임포트

const SUPABASE_URL = 'https://test.supabase.co'
const ANON_KEY = 'anon-key-test'
const SERVICE_KEY = 'service-role-key-test'

describe('serviceClient — 환경변수 처리', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv, NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL }
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    delete process.env.SUPABASE_SERVICE_KEY
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    delete process.env.VERCEL_ENV
    jest.resetModules()
  })

  afterEach(() => {
    process.env = originalEnv
    jest.resetModules()
  })

  it('운영 환경(VERCEL_ENV=production)에서 서비스 키 미설정 시 throw', async () => {
    process.env.VERCEL_ENV = 'production'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY
    jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn().mockReturnValue({}) }))

    const storage = await import('../storage')
    await expect(
      storage.uploadAssetBytes({
        spaceId: 'sp1',
        contentId: 'c1',
        bytes: Buffer.from('test'),
        mimeType: 'image/png',
      })
    ).rejects.toThrow('SUPABASE_SERVICE_ROLE_KEY')
  })

  it('비운영 환경에서 서비스 키 미설정 시 anon 키 폴백 (throw 안 함, 스토리지 에러만)', async () => {
    process.env.VERCEL_ENV = 'preview'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY
    jest.mock('@supabase/supabase-js', () => ({
      createClient: jest.fn().mockReturnValue({
        storage: {
          from: jest.fn().mockReturnValue({
            upload: jest.fn().mockResolvedValue({ error: new Error('bucket not found') }),
          }),
        },
      }),
    }))

    const storage = await import('../storage')
    // anon 폴백으로 클라이언트는 생성됨 — storage 에러(서비스 키 부재 아님)로 실패해야 함
    await expect(
      storage.uploadAssetBytes({
        spaceId: 'sp1',
        contentId: 'c1',
        bytes: Buffer.from('test'),
        mimeType: 'image/png',
      })
    ).rejects.toThrow('Storage upload failed')
  })

  it('SUPABASE_SERVICE_ROLE_KEY 존재 시 서비스 키로 클라이언트 생성', async () => {
    process.env.VERCEL_ENV = 'production'
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
    const mockCreateClient = jest.fn().mockReturnValue({
      storage: {
        from: jest.fn().mockReturnValue({
          upload: jest.fn().mockResolvedValue({ error: null }),
          getPublicUrl: jest.fn().mockReturnValue({ data: { publicUrl: 'https://cdn/img.png' } }),
        }),
      },
    })
    jest.mock('@supabase/supabase-js', () => ({ createClient: mockCreateClient }))

    const storage = await import('../storage')
    const result = await storage.uploadAssetBytes({
      spaceId: 'sp1',
      contentId: 'c1',
      bytes: Buffer.from('test'),
      mimeType: 'image/png',
    })

    expect(result.publicUrl).toBe('https://cdn/img.png')
    expect(mockCreateClient).toHaveBeenCalledWith(SUPABASE_URL, SERVICE_KEY, expect.any(Object))
  })

  it('SUPABASE_SERVICE_KEY(별칭) 존재 시 서비스 키로 클라이언트 생성', async () => {
    process.env.VERCEL_ENV = 'production'
    process.env.SUPABASE_SERVICE_KEY = SERVICE_KEY
    const mockCreateClient = jest.fn().mockReturnValue({
      storage: {
        from: jest.fn().mockReturnValue({
          upload: jest.fn().mockResolvedValue({ error: null }),
          getPublicUrl: jest.fn().mockReturnValue({ data: { publicUrl: 'https://cdn/img.png' } }),
        }),
      },
    })
    jest.mock('@supabase/supabase-js', () => ({ createClient: mockCreateClient }))

    const storage = await import('../storage')
    await storage.uploadAssetBytes({
      spaceId: 'sp1',
      contentId: 'c1',
      bytes: Buffer.from('test'),
      mimeType: 'image/png',
    })

    expect(mockCreateClient).toHaveBeenCalledWith(SUPABASE_URL, SERVICE_KEY, expect.any(Object))
  })
})

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
