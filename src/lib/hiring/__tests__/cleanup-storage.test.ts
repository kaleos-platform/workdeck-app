/** @jest-environment node */
import { cleanupFetch } from '../cleanup-storage'

it('기존 취소 신호를 보존해 cleanup 요청을 중단한다', async () => {
  const original = global.fetch
  const controller = new AbortController()
  global.fetch = jest.fn((_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(Error('aborted')))
  })) as typeof fetch
  try {
    const result = cleanupFetch('http://localhost/synthetic', { signal: controller.signal })
    controller.abort()
    await expect(result).rejects.toThrow('aborted')
  } finally { global.fetch = original }
})

it('기존 신호가 없어도 cleanup 요청을 제한한다', async () => {
  const original = global.fetch
  global.fetch = jest.fn((_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(Error('timed out')))
  })) as typeof fetch
  try {
    await expect(cleanupFetch('http://localhost/synthetic')).rejects.toThrow('timed out')
  } finally { global.fetch = original }
}, 5000)

it('Request 자체의 취소 신호도 보존한다', async () => {
  const original = global.fetch
  const controller = new AbortController()
  global.fetch = jest.fn((_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(Error('request aborted')))
  })) as typeof fetch
  try {
    const result = cleanupFetch(new Request('http://localhost/synthetic', { signal: controller.signal }))
    controller.abort()
    await expect(result).rejects.toThrow('request aborted')
  } finally { global.fetch = original }
})
