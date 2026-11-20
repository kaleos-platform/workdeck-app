import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

// UI 계획 와이어프레임 파일 접근 — /dev/plan 전용. 개발 서버에서만 호출된다.
const PLANS_ROOT = path.join(process.cwd(), 'docs/design/plans')
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/
export const MAX_SCENE_BYTES = 5_000_000

export function isPlanName(value: string): boolean {
  return NAME.test(value)
}

function scenePath(task: string, screen: string): string {
  if (!isPlanName(task) || !isPlanName(screen)) throw new Error('잘못된 계획 이름입니다')
  return path.join(PLANS_ROOT, task, `${screen}.excalidraw`)
}

export function isDevPlanEnabled(): boolean {
  return process.env.NODE_ENV === 'development'
}

export function isExcalidrawScene(value: unknown): boolean {
  const scene = value as { type?: unknown; elements?: unknown } | null
  return scene?.type === 'excalidraw' && Array.isArray(scene.elements)
}

export async function listPlan(task: string): Promise<{ screens: string[]; notes: string } | null> {
  if (!isPlanName(task)) return null
  const dir = path.join(PLANS_ROOT, task)
  const entries = await readdir(dir).catch(() => null)
  if (!entries) return null
  const screens = entries
    .filter((name) => name.endsWith('.excalidraw'))
    .map((name) => name.replace(/\.excalidraw$/, ''))
    .filter(isPlanName)
    .sort((a, b) => (a === 'flow' ? -1 : b === 'flow' ? 1 : a.localeCompare(b)))
  const notes = await readFile(path.join(dir, 'plan.md'), 'utf8').catch(() => '')
  return { screens, notes }
}

export async function readScene(task: string, screen: string): Promise<unknown> {
  return JSON.parse(await readFile(scenePath(task, screen), 'utf8'))
}

export async function writeScene(task: string, screen: string, body: string): Promise<void> {
  const file = scenePath(task, screen)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, body, 'utf8')
}
