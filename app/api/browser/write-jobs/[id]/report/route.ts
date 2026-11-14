import { NextResponse, type NextRequest } from 'next/server'
import { authenticateWorker } from '@/lib/worker-auth'
import { browserWriteReport, reportBrowserWrite } from '@/lib/browser/approved-write'
import { ToolUserError } from '@/lib/agent/tools/errors'

export const runtime = 'nodejs'

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateWorker(request.headers)
    if ('error' in auth) return auth.error
    if (auth.scope.kind !== 'space') {
      return NextResponse.json({ message: 'Space 범위 워커 토큰이 필요합니다' }, { status: 403 })
    }
    const input = browserWriteReport.safeParse(await request.json().catch(() => null))
    if (!input.success)
      return NextResponse.json({ message: '실행 보고 형식이 올바르지 않습니다' }, { status: 400 })
    const { id } = await context.params
    return NextResponse.json(
      await reportBrowserWrite(auth.scope.spaceId, auth.scope.tokenId, id, input.data)
    )
  } catch (error) {
    if (error instanceof ToolUserError)
      return NextResponse.json({ message: error.message }, { status: 409 })
    return NextResponse.json(
      { message: '브라우저 작업 보고를 확인할 수 없습니다. 재실행하지 마세요.' },
      { status: 500 }
    )
  }
}
