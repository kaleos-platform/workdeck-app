jest.mock('@/lib/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/ai/resolve', () => ({ generateTextForSpace: jest.fn() }))
jest.mock('@/lib/supabase/storage', () => ({}))
jest.mock('@vercel/oidc', () => ({ getVercelOidcToken: jest.fn() }))

import { parseDescribe, parseExifTime } from '../media-sync'
import { isPublishable } from '../media-copy'
import { serviceAccountIdFor } from '../drive'

describe('media 판정·SA 이름', () => {
  it('얼굴 판정은 애매하면 게시 불가 쪽으로', () => {
    expect(parseDescribe('{"caption":"키트","tags":["키트"],"face":"none"}').face).toBe('NO_FACE')
    expect(parseDescribe('{"face":"maybe"}').face).toBe('UNKNOWN')
    expect(parseDescribe('not json').face).toBe('UNKNOWN')
    expect(parseExifTime('2026:11:01 14:03:22')?.toISOString()).toBe('2026-11-01T05:03:22.000Z')
    const base = { removedAt: null, md5: 'm1', allowedMd5: null }
    expect(isPublishable({ ...base, faceStatus: 'NO_FACE' })).toBe(true)
    expect(isPublishable({ ...base, faceStatus: 'UNKNOWN' })).toBe(false)
    expect(isPublishable({ ...base, faceStatus: 'FACE' })).toBe(false)
    expect(isPublishable({ ...base, faceStatus: 'FACE', allowedMd5: 'm1' })).toBe(true)
    expect(isPublishable({ ...base, md5: 'm2', faceStatus: 'FACE', allowedMd5: 'm1' })).toBe(false)
  })

  it('SA 이름은 환경 접두 + 30자 이내', () => {
    const id = serviceAccountIdFor('space-1', true)
    expect(id).toMatch(/^wd-p-[0-9a-f]{20}$/)
    expect(serviceAccountIdFor('space-1', false).startsWith('wd-d-')).toBe(true)
  })
})
