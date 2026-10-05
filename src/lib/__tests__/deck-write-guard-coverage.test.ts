/**
 * Phase 3 커버리지 가드 — 소스 스캔(DB·네트워크 무접근).
 *
 * `resolveDeckContext` 는 요청 객체를 받지 않아 HTTP 메서드를 모른다. 따라서 mutation
 * 핸들러가 `{ write: true }` 를 넘겼는지는 호출부에서만 보장되고, 새 라우트를 추가하며
 * 빠뜨리면 아무도 알아채지 못한다. 이 테스트가 그 누락을 잡는다.
 *
 * 규칙(가드 적용 완료 deck 한정):
 *  - POST/PUT/PATCH/DELETE 핸들러의 resolveDeckContext 호출 → `{ write: true }` 필수
 *  - GET 핸들러의 호출 → write 금지 (조회를 막으면 안 된다)
 *
 * deck 별로 PR 이 나뉘므로, 적용을 끝낸 deck 을 GUARDED_DECKS 에 추가해 가며 확장한다.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// 가드 적용을 마친 deck 과 그 deck 의 컨텍스트 호출 패턴. Phase 3 PR 마다 하나씩 추가한다.
// coupang-ads 는 resolveDeckContext 대신 resolveWorkspace() 를 쓴다.
const GUARDED_DECKS: { deck: string; call: string }[] = [
  { deck: 'finance', call: "resolveDeckContext('finance'" },
  { deck: 'recruiting', call: "resolveDeckContext('recruiting'" },
  { deck: 'sales-content', call: "resolveDeckContext('sales-content'" },
]

const API_ROOT = join(process.cwd(), 'app', 'api')
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function routeFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...routeFiles(full))
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

interface Call {
  file: string
  line: number
  handler: string
  hasWrite: boolean
}

// 각 컨텍스트 호출을 감싸는 최상위 export 핸들러 이름과 함께 수집한다.
function collectCalls(call: string): Call[] {
  const calls: Call[] = []
  for (const file of routeFiles(API_ROOT)) {
    const lines = readFileSync(file, 'utf8').split('\n')
    let handler = '<top>'
    lines.forEach((line, idx) => {
      // 최상위 함수 경계(export 여부 무관) — 핸들러 뒤에 선언된 보조 함수의 호출을
      // 앞 핸들러로 잘못 묶지 않게 한다. 보조 함수는 메서드 이름이 아니라 검사 대상에서 빠진다.
      const m = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/.exec(line)
      if (m) handler = m[1]
      if (!line.includes(call)) return
      calls.push({
        file: file.replace(`${process.cwd()}/`, ''),
        line: idx + 1,
        handler,
        hasWrite: /write:\s*true/.test(line),
      })
    })
  }
  return calls
}

describe.each(GUARDED_DECKS)('deck write 가드 커버리지 — $deck', ({ call }) => {
  const calls = collectCalls(call)

  test('스캔 대상이 존재한다 (경로 오타·이동 감지)', () => {
    expect(calls.length).toBeGreaterThan(0)
  })

  test('mutation 핸들러는 전부 { write: true } 를 넘긴다', () => {
    const missing = calls
      .filter((c) => MUTATION_METHODS.has(c.handler) && !c.hasWrite)
      .map((c) => `${c.file}:${c.line} (${c.handler})`)
    expect(missing).toEqual([])
  })

  test('GET 핸들러는 write 를 넘기지 않는다 (조회 차단 방지)', () => {
    const wrong = calls
      .filter((c) => c.handler === 'GET' && c.hasWrite)
      .map((c) => `${c.file}:${c.line}`)
    expect(wrong).toEqual([])
  })
})
