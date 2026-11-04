import { NextResponse, type NextRequest } from 'next/server'
import {
  MAX_SCENE_BYTES,
  isDevPlanEnabled,
  isExcalidrawScene,
  isPlanName,
  readScene,
  writeScene,
} from '@/lib/dev/plan-files'

type Context = { params: Promise<{ task: string; screen: string }> }

async function resolveParams(context: Context) {
  const { task, screen } = await context.params
  return isDevPlanEnabled() && isPlanName(task) && isPlanName(screen) ? { task, screen } : null
}

export async function GET(_request: NextRequest, context: Context) {
  const params = await resolveParams(context)
  if (!params) return new NextResponse(null, { status: 404 })
  const scene = await readScene(params.task, params.screen).catch(() => null)
  return scene ? NextResponse.json(scene) : new NextResponse(null, { status: 404 })
}

export async function PUT(request: NextRequest, context: Context) {
  const params = await resolveParams(context)
  if (!params) return new NextResponse(null, { status: 404 })
  // JSON 본문은 교차 출처 요청에 preflight 를 강제한다 — CORS 를 열지 않으므로 외부 페이지는 저장할 수 없다.
  if (request.headers.get('content-type') !== 'application/json') {
    return new NextResponse(null, { status: 415 })
  }
  const body = await request.text()
  if (Buffer.byteLength(body) > MAX_SCENE_BYTES) return new NextResponse(null, { status: 413 })
  let scene: unknown = null
  try {
    scene = JSON.parse(body)
  } catch {}
  if (!isExcalidrawScene(scene)) return new NextResponse(null, { status: 400 })
  await writeScene(params.task, params.screen, `${JSON.stringify(scene, null, 2)}\n`)
  return NextResponse.json({ saved: true })
}
