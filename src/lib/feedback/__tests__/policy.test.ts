import {
  adminUpdateSchema,
  attachmentDeleteAt,
  feedbackInputSchema,
  nextClosedAt,
  storageCapBytes,
} from '../policy'

const t = new Date('2026-01-01T00:00:00Z')
const now = new Date('2026-02-01T00:00:00Z')

describe('feedback policy', () => {
  it('attachmentDeleteAt', () => {
    expect(attachmentDeleteAt('DONE', t)).toEqual(new Date('2026-01-31T00:00:00Z'))
    expect(attachmentDeleteAt('ON_HOLD', t)).toEqual(new Date('2026-04-01T00:00:00Z'))
    expect(attachmentDeleteAt('IN_PROGRESS', t)).toBeNull()
    expect(attachmentDeleteAt('NEW', null)).toBeNull()
    expect(attachmentDeleteAt('DONE', null)).toBeNull()
  })

  it('nextClosedAt', () => {
    expect(nextClosedAt('DONE', 'DONE', t, now)).toEqual(t)
    expect(nextClosedAt('DONE', 'ON_HOLD', t, now)).toEqual(now)
    expect(nextClosedAt('DONE', 'IN_PROGRESS', t, now)).toBeNull()
    expect(nextClosedAt('NEW', 'DONE', null, now)).toEqual(now)
    expect(nextClosedAt('NEW', 'IN_PROGRESS', null, now)).toBeNull()
  })

  it('feedbackInputSchema', () => {
    expect(feedbackInputSchema.safeParse({ type: 'BUG', body: '   ' }).success).toBe(false)
    expect(feedbackInputSchema.safeParse({ type: 'BUG', body: 'x'.repeat(5001) }).success).toBe(false)
    expect(feedbackInputSchema.safeParse({ type: 'NOPE', body: 'a' }).success).toBe(false)
    expect(feedbackInputSchema.parse({ type: 'BUG', body: ' a ' }).body).toBe('a')
    expect(feedbackInputSchema.parse({ type: 'BUG', body: 'a', pagePath: '/d/x?token=1#h' }).pagePath).toBe('/d/x')
    expect(feedbackInputSchema.parse({ type: 'BUG', body: 'a' }).pagePath).toBeUndefined()
    expect(feedbackInputSchema.safeParse({ type: 'BUG', body: 'a', pagePath: 'http://x' }).success).toBe(false)
    expect(feedbackInputSchema.safeParse({ type: 'BUG', body: 'a', pagePath: '/' + 'a'.repeat(500) }).success).toBe(false)
  })

  it('adminUpdateSchema', () => {
    expect(adminUpdateSchema.safeParse({ status: 'DONE', memo: null }).success).toBe(true)
    expect(adminUpdateSchema.safeParse({}).success).toBe(true)
    expect(adminUpdateSchema.safeParse({ memo: 'x'.repeat(2001) }).success).toBe(false)
    expect(adminUpdateSchema.safeParse({ status: 'X' }).success).toBe(false)
  })

  it('storageCapBytes', () => {
    expect(storageCapBytes({ FEEDBACK_STORAGE_CAP_MB: '0' })).toBe(0)
    expect(storageCapBytes({})).toBe(500 * 1024 * 1024)
    expect(storageCapBytes({ FEEDBACK_STORAGE_CAP_MB: 'abc' })).toBe(0)
    expect(storageCapBytes({ FEEDBACK_STORAGE_CAP_MB: '-5' })).toBe(0)
    expect(storageCapBytes({ FEEDBACK_STORAGE_CAP_MB: '1.5' })).toBe(0)
    expect(storageCapBytes({ FEEDBACK_STORAGE_CAP_MB: '10' })).toBe(10 * 1024 * 1024)
  })
})
