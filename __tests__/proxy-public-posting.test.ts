/** @jest-environment node */
import { NextRequest, NextResponse } from 'next/server'
import { proxy } from '../proxy'

jest.mock('@/lib/supabase/middleware', () => ({
  updateSession: jest.fn(async () => ({
    supabaseResponse: (await import('next/server')).NextResponse.next(),
    authenticated: false,
  })),
}))

const req = (host: string, path: string) =>
  new NextRequest(`https://${host}${path}`, { headers: { host } })

describe('proxy — 공개 공고 /p 호스트 정책', () => {
  it('마케팅 호스트의 /p/* 는 app 호스트로 308, 쿼리 보존', async () => {
    const res = await proxy(req('workdeck.work', '/p/abc?preview=1&utm_source=x'))
    expect(res.status).toBe(308)
    expect(res.headers.get('location')).toBe(
      'https://app.workdeck.work/p/abc?preview=1&utm_source=x'
    )
  })

  it('www 호스트의 지원 경로도 이동한다', async () => {
    const res = await proxy(req('www.workdeck.work', '/p/abc/apply'))
    expect(res.status).toBe(308)
    expect(res.headers.get('location')).toBe('https://app.workdeck.work/p/abc/apply')
  })

  it('app 호스트의 /p/* 는 그대로 통과', async () => {
    const res = await proxy(req('app.workdeck.work', '/p/abc'))
    expect(res).toBeInstanceOf(NextResponse)
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
  })

  it('마케팅 호스트의 /pricing 은 이동하지 않는다', async () => {
    const res = await proxy(req('workdeck.work', '/pricing'))
    expect(res.headers.get('location')).toBeNull()
  })
})
