// TEMP: preview Sentry 검증용 — 머지 전 제거
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  if (process.env.VERCEL_ENV === 'production') return new NextResponse(null, { status: 404 })
  const kind = req.nextUrl.searchParams.get('kind')
  if (kind === 'console-error') {
    try {
      throw new Error('sentry-test api caught kim@example.com')
    } catch (e) {
      console.error('sentry-test 처리 중 오류:', e)
    }
  } else if (kind === 'console-string') {
    console.error('sentry-test 업로드 오류:', JSON.stringify({ name: '홍길동', address: '서울시 강남구 테헤란로 1', phone: '010-9876-5432' }))
  } else if (kind === 'throw') {
    throw new Error('sentry-test route throw')
  }
  return NextResponse.json({ ok: true, kind })
}
