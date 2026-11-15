/* eslint-disable @typescript-eslint/no-explicit-any -- one-off 스크립트: scene JSON 은 any 로 다룸 */
/**
 * 샘플 템플릿 브랜드 정리 dry-run (one-off, 운영 쓰기 없음). 사용법은 README.md.
 *   node scripts/hiring-sample-sanitize/sanitize.ts candidates|scenes
 * 입력 /tmp/tplaudit/<templateId>.json, 산출 /tmp/tplaudit/out/. 네트워크: 공개 PNG 다운로드만(scenes 모드).
 */
import fs from 'node:fs'
import crypto from 'node:crypto'

const AUDIT = '/tmp/tplaudit'
const OUT = `${AUDIT}/out`
const PNG_BASE = 'https://duyteczbadcuvfeawlzu.supabase.co/storage/v1/object/public/hiring-assets/'
const DEFAULT_CANVAS_HEIGHT = 480 // build-types.ts 와 동일
const CANVAS_WIDTH = 640

const LOGO_HASHES = new Set(
  `b40acb636c 95e90d108a 2f6bbe5b08 5bdc287565 867cd0009b 3ea5973641 80d035a46d cab74791ee 90de933442 ba51c9904e c48c54d3b9 7518eaf990 715e51d16b 5e53009ace 4c3b595d67 3867f49f6d b7ffcbd4d5 03f2c961d6 20524dc07c c5beed34cb a1f79688e0 e8eb83c7a3 05e1f9bbe1`.split(
    ' '
  )
)

type El = Record<string, any>
type Block = {
  templateId: string
  templateName: string
  order: number
  contentId: string
  title: string
  imagePath: string
  scene: any
}
type Decision = {
  templateId: string
  templateName: string
  contentId: string
  order: number
  title: string
  elementId: string
  original: string
  originalText: string
  proposed: string
  proposedOriginalText: string
  action: 'replace' | 'keep' | 'review'
  note: string
}

function loadBlocks(): Block[] {
  const blocks: Block[] = []
  for (const f of fs
    .readdirSync(AUDIT)
    .filter((f) => /^cm.*\.json$/.test(f))
    .sort()) {
    const d = JSON.parse(fs.readFileSync(`${AUDIT}/${f}`, 'utf8'))
    for (const c of d.contents) {
      if (c.contentType !== 'design') continue
      blocks.push({
        templateId: d.meta.id,
        templateName: d.meta.name,
        order: c.sortOrder,
        contentId: c.id,
        title: c.title,
        imagePath: c.imagePath,
        scene: c.data,
      })
    }
  }
  return blocks
}

// ---------- 후보 탐지(넓은 패턴) + 치환 규칙 ----------
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
const PHONE = /\b0\d{1,2}\s*[-.]\s*\d{2,4}\s*[-.]\s*\d{3,4}\b|\b\d{3}\s*-\s*\d{3}\s*-\s*\d{4}\b/g
const BROAD = /오프닝|오픈샐러드|opening|피크|peak|@\w+|김워크|chat\s*gpt/i
const isCandidate = (t: string) =>
  BROAD.test(t) || (t.match(EMAIL)?.length ?? 0) > 0 || (t.match(PHONE)?.length ?? 0) > 0

// 순서대로 적용(계획 §1)
const RULES: [RegExp, string][] = [
  [EMAIL, 'recruit@example.com'],
  [/010-1234-1234/g, '010-0000-0000'],
  [
    /02\s*-\s*123\s*-\s*1234|02-1234-1234|02\.2023\.2023|02\.0000\.0000|02\.0000\.000(?!\d)/g,
    '02-000-0000',
  ],
  [/@peakdining/g, '@instagram_id'],
  [/오프닝\s*워크(?=\s*(?:스페이스|라운지))/g, 'OO'], // 장소 문맥
  [/오프닝\s*워크|opening\s*work/gi, 'OO기업'],
  [/오프닝호텔/g, 'OO호텔'],
  [/오프닝\s*식당/g, 'OO식당'],
  [/오프닝\s*백화점/g, 'OO백화점'],
  [/오프닝\s*카페/g, 'OO카페'],
  [/Opening\s*Cafe/gi, 'OO Cafe'],
  [/오프닝\s*베이커리/g, 'OO베이커리'],
  [/Opening\s*Bakery/gi, 'OO Bakery'],
  [/오프닝\s*팩토리/g, 'OO팩토리'],
  [/오프닝\s*로지스틱스/g, 'OO로지스틱스'],
  [/오프닝\s*매장/g, 'OO매장'],
  [/OpeningLab Inc\./g, 'OO Inc.'],
  [/\bOPENING\b/g, ''], // 단독 OPENING 제거
  [/오프닝/g, 'OO'],
  [/\bOpening\b/g, 'OO'],
  [/피크\s*다이닝/g, 'OO다이닝'],
  [/피크푸드/g, 'OO푸드'],
  [/피크/g, 'OO'],
  [/오픈샐러드/g, 'OO샐러드'],
  [/OO기업와/g, 'OO기업과'], // 받침 조사 보정(계획의 '조사 그대로' 예외)
  [/OO기업는/g, 'OO기업은'],
]

function applyRules(t: string): string {
  let s = t
  for (const [re, rep] of RULES) s = s.replace(re, rep)
  // 'OPENING' 제거로 생긴 빈 줄·앞뒤 공백 정리
  return !t.includes('OPENING')
    ? s
    : s
        .split('\n')
        .map((l) => l.trim())
        .filter((l, i, a) => l || i < a.length - 1)
        .join('\n')
        .trim()
}

const TIME = /\d{1,2}:\d{2}/
function hasTimeSibling(els: El[], e: El): boolean {
  return els.some(
    (o) =>
      o !== e && o.type === 'text' && !o.isDeleted && Math.abs(o.y - e.y) < 15 && TIME.test(o.text)
  )
}

function decide(block: Block, els: El[], e: El): Decision | null {
  const t: string = e.text ?? ''
  if (!isCandidate(t)) return null
  const base = {
    templateId: block.templateId,
    templateName: block.templateName,
    contentId: block.contentId,
    order: block.order,
    title: block.title,
    elementId: e.id,
    original: t,
    originalText: e.originalText ?? t,
  }
  const mk = (proposed: string, action: Decision['action'], note: string): Decision => ({
    ...base,
    proposed,
    proposedOriginalText:
      applyRules(base.originalText) === applyRules(t) ? proposed : applyRules(base.originalText),
    action,
    note,
  })
  // keep 규칙
  if (t.trim() === '오프닝' && hasTimeSibling(els, e))
    return mk(t, 'keep', '행사 개회 시간표의 일반 단어')
  const stripped = t.replace(/SPEAKER|000-0000-0000|00 - 0000 - 0000/g, '')
  if (stripped !== t && !isCandidate(stripped))
    return mk(t, 'keep', 'SPEAKER 의 PEAK 오탐 / 마스킹된 번호')
  if (/김워크/.test(t) && applyRules(t) === t && !t.match(PHONE))
    return mk(t, 'review', '가상 인물명(결정 대상)')
  if (/chat\s*gpt/i.test(t) && applyRules(t) === t) return mk(t, 'review', '타사 상표(결정 대상)')
  let p = applyRules(t)
  let note = ''
  let action: Decision['action'] = 'replace'
  if (p === t) {
    const phones = t.match(PHONE) ?? []
    if (phones.length > 0 && !/^(?:010-0000-0000|02-000-0000|000-0000-0000)$/.test(t.trim())) {
      p = t.replace(PHONE, '000-0000-0000')
      return mk(p, 'review', '규칙에 없는 전화형 — 제안: 000-0000-0000')
    }
    return mk(t, 'keep', '치환 규칙 해당 없음/이미 중립 값')
  }
  if (/오픈샐러드/.test(t)) {
    action = 'review'
    note = '가상 브랜드 고유명(결정 대상)'
  }
  if (p === '') note = '요소 삭제(단독 OPENING)'
  return mk(p, action, note)
}

function scanCandidates(blocks: Block[]): Decision[] {
  const out: Decision[] = []
  for (const b of blocks) {
    const els: El[] = b.scene.elements ?? []
    for (const e of els) {
      if (e.type !== 'text' || e.isDeleted) continue
      const d = decide(b, els, e)
      if (d) out.push(d)
    }
  }
  return out
}

function modeCandidates() {
  fs.mkdirSync(OUT, { recursive: true })
  const blocks = loadBlocks()
  const ds = scanCandidates(blocks)
  fs.writeFileSync(`${OUT}/decisions.json`, JSON.stringify(ds, null, 2))
  const esc = (s: string) =>
    s
      .replace(/\|/g, '\\|')
      .replace(/\n/g, '⏎')
      .replace(/[\x00-\x1f]/g, '·')
  const cnt = (a: string) => ds.filter((d) => d.action === a).length
  const md = [
    `# 치환 결정표 (요소 단위)\n`,
    `블록 ${new Set(ds.map((d) => d.contentId)).size}개 · 요소 ${ds.length}개 — replace ${cnt('replace')} / keep ${cnt('keep')} / review ${cnt('review')}\n`,
    `| 템플릿 | #순서 제목 | elementId | action | 원문 | 치환안 | 비고 |`,
    `|---|---|---|---|---|---|---|`,
    ...ds.map(
      (d) =>
        `| ${esc(d.templateName)} | #${d.order} ${esc(d.title)} | ${d.elementId} | ${d.action} | ${esc(d.original)} | ${d.proposed === d.original ? '(동일)' : esc(d.proposed) || '(삭제)'} | ${esc(d.note)} |`
    ),
  ].join('\n')
  fs.writeFileSync(`${OUT}/decisions.md`, md)
  console.log(
    `candidates: 블록 ${new Set(ds.map((d) => d.contentId)).size}, 요소 ${ds.length} (replace ${cnt('replace')}, keep ${cnt('keep')}, review ${cnt('review')})`
  )
}

// ---------- 로고 ----------
function decodeDataUrl(u: string): Buffer {
  const m = /^data:[^,]*?(;base64)?,([\s\S]*)$/.exec(u)
  if (!m) return Buffer.alloc(0)
  return m[1] ? Buffer.from(m[2], 'base64') : Buffer.from(decodeURIComponent(m[2]))
}
const sha10 = (u: string) =>
  crypto.createHash('sha1').update(decodeDataUrl(u)).digest('hex').slice(0, 10)

// ---------- 정리 scene 생성 ----------
type Applied = {
  replaced: number
  deleted: number
  logos: string[]
  largeLogo: string[]
  scene: any
}
function sanitizeScene(block: Block, decisions: Decision[]): Applied {
  const scene = structuredClone(block.scene)
  const mine = new Map(
    decisions.filter((d) => d.contentId === block.contentId).map((d) => [d.elementId, d])
  )
  let replaced = 0,
    deleted = 0
  for (const e of scene.elements as El[]) {
    const d = mine.get(e.id)
    // 명시 승인(replace)된 결정만 적용 — review 는 사용자 결정 전까지 원문 유지
    if (!d || d.action !== 'replace' || d.proposed === d.original) continue
    if (d.proposed === '') {
      e.isDeleted = true
      deleted++
      continue
    }
    e.text = d.proposed
    if ('originalText' in e) e.originalText = d.proposedOriginalText
    replaced++
  }
  // 로고 제거
  const files: Record<string, any> = scene.files ?? {}
  const logoIds = new Set(
    Object.entries(files)
      .filter(([, f]) => LOGO_HASHES.has(sha10(f.dataURL)))
      .map(([k]) => k)
  )
  const frame = (scene.elements as El[]).find((e) => e.type === 'frame')
  const frameArea =
    (frame?.width ?? CANVAS_WIDTH) * (frame?.height ?? scene.canvasHeight ?? DEFAULT_CANVAS_HEIGHT)
  const logos: string[] = [],
    largeLogo: string[] = []
  scene.elements = (scene.elements as El[]).filter((e) => {
    if (e.type !== 'image' || !logoIds.has(e.fileId)) return true
    logos.push(`${e.id}:${sha10(files[e.fileId].dataURL)}`)
    const ratio = (e.width * e.height) / frameArea
    if (ratio >= 0.15) largeLogo.push(`${e.id} ${(ratio * 100).toFixed(0)}%`)
    return false
  })
  for (const id of logoIds)
    if (!(scene.elements as El[]).some((e) => e.fileId === id)) delete files[id]
  return { replaced, deleted, logos, largeLogo, scene }
}

async function downloadBefore(b: Block): Promise<void> {
  const f = `${OUT}/png/${b.contentId}.before.png`
  if (fs.existsSync(f) && fs.statSync(f).size > 0) return
  const res = await fetch(PNG_BASE + b.imagePath)
  if (!res.ok) throw new Error(`before 다운로드 실패 ${b.imagePath}: ${res.status}`)
  fs.writeFileSync(f, Buffer.from(await res.arrayBuffer()))
}

// ---------- 잔존 검사(치환 규칙과 별개 코드) ----------
const ALLOWED_TOKENS =
  /SPEAKER|recruit@example\.com|@instagram_id|010-0000-0000|02-000-0000|000-0000-0000|00 - 0000 - 0000/g
function residualScan(blocks: { b: Block; scene: any }[]): string {
  const lines: string[] = ['# 잔존 검사 (정리 scene 전체 재스캔)\n']
  const wide =
    /오프닝|오픈|opening|open|피크|peak|@|김워크|chat\s*gpt|\d{2,3}\s*[-.]\s*\d{2,4}\s*[-.]\s*\d{3,4}/i
  let n = 0,
    logoHits = 0
  for (const { b, scene } of blocks) {
    const els: El[] = scene.elements ?? []
    for (const e of els) {
      if (e.type === 'text' && !e.isDeleted) {
        const t = String(e.text).replace(ALLOWED_TOKENS, '')
        if (!wide.test(t)) continue
        if (
          t.trim() === '오프닝' &&
          els.some(
            (o) =>
              o !== e &&
              o.type === 'text' &&
              !o.isDeleted &&
              Math.abs(o.y - e.y) < 15 &&
              /\d:\d\d/.test(o.text)
          )
        )
          continue
        lines.push(
          `- 텍스트 [${b.templateName}] #${b.order} ${b.title} (${e.id}): ${JSON.stringify(e.text)}`
        )
        n++
      }
    }
    for (const [id, f] of Object.entries<any>(scene.files ?? {})) {
      if (LOGO_HASHES.has(sha10(f.dataURL))) {
        lines.push(`- 로고 해시 [${b.templateName}] #${b.order} ${b.title} file ${id}`)
        logoHits++
      }
    }
  }
  lines.push(
    `\n합계: 텍스트 잔존 ${n}건 / 로고 해시 ${logoHits}건 (allowlist: SPEAKER, 중립 치환값, 마스킹 번호, 시간표 「오프닝」 제외)`
  )
  const titles = blocks
    .filter(({ b }) => /오프닝|오픈샐러드|opening|피크|peak|[\x00-\x08\x0b-\x1f]/i.test(b.title))
    .map(({ b }) => `- 블록 제목 [${b.templateName}] #${b.order}: ${JSON.stringify(b.title)}`)
  lines.push('\n## 블록 제목(PNG 에 안 보임, 참고)\n', ...(titles.length ? titles : ['- 없음']))
  return lines.join('\n')
}

async function modeScenes() {
  // 이전 결정으로 만든 scene 이 남아 patch 대상에 섞이지 않도록 매 실행 초기화
  fs.rmSync(`${OUT}/scenes`, { recursive: true, force: true })
  for (const d of ['scenes', 'png']) fs.mkdirSync(`${OUT}/${d}`, { recursive: true })
  const blocks = loadBlocks()
  const decisions: Decision[] = JSON.parse(fs.readFileSync(`${OUT}/decisions.json`, 'utf8'))
  const cleaned = blocks.map((b) => ({ b, ...sanitizeScene(b, decisions) }))
  const changed = cleaned.filter((c) => c.replaced + c.deleted + c.logos.length > 0)
  for (const c of changed) {
    fs.writeFileSync(`${OUT}/scenes/${c.b.contentId}.json`, JSON.stringify(c.scene))
    await downloadBefore(c.b) // patch.ts 입력(원본 PNG)
  }
  const sum = (f: (c: (typeof cleaned)[number]) => number) => changed.reduce((a, c) => a + f(c), 0)
  const review = decisions.filter((d) => d.action === 'review')
  const report = [
    '# scenes 리포트\n',
    `변경 블록 ${changed.length} / design 블록 ${blocks.length}`,
    `텍스트 치환 요소 ${sum((c) => c.replaced)} · 요소 삭제 ${sum((c) => c.deleted)} · 로고 제거 ${sum((c) => c.logos.length)}`,
    `review 항목 ${review.length}: ${review.map((d) => `[${d.templateName} #${d.order}] ${JSON.stringify(d.original)}`).join(' ; ')}`,
    `large-logo-removed 경고: ${changed.flatMap((c) => c.largeLogo.map((l) => `[${c.b.templateName}] #${c.b.order} ${c.b.title} ${l}`)).join(' ; ') || '없음'}`,
  ].join('\n')
  fs.writeFileSync(`${OUT}/scenes-report.md`, report)
  fs.writeFileSync(
    `${OUT}/residual.md`,
    residualScan(cleaned.map((c) => ({ b: c.b, scene: c.scene })))
  )
  console.log(report)
}

const mode = process.argv[2]
if (mode === 'candidates') modeCandidates()
else if (mode === 'scenes') await modeScenes()
else {
  console.error('usage: sanitize.ts candidates|scenes (픽셀 패치는 patch.ts)')
  process.exit(1)
}
