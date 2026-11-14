import { NextResponse, type NextRequest } from 'next/server'
import { authenticateWorker } from '@/lib/worker-auth'
import { claimBrowserWrite } from '@/lib/browser/approved-write'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateWorker(request.headers)
    if ('error' in auth) return auth.error
    if (auth.scope.kind !== 'space') {
      return NextResponse.json({ message: 'Space 범위 워커 토큰이 필요합니다' }, { status: 403 })
    }
    return NextResponse.json({
      job: await claimBrowserWrite(auth.scope.spaceId, auth.scope.tokenId),
    })
  } catch {
    return NextResponse.json(
      { message: '브라우저 작업 접수 상태를 확인할 수 없습니다. 재실행하지 마세요.' },
      { status: 500 }
    )
  }
}
