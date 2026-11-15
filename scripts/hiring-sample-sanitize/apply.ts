/* eslint-disable @typescript-eslint/no-explicit-any -- one-off 스크립트: API 응답·manifest 는 any 로 다룸 */
/**
 * 샘플 템플릿 브랜드 정리 반영 도구 (one-off). patch.ts 가 만든 manifest 를 admin 웹 API 로 반영/롤백한다.
 *   node scripts/hiring-sample-sanitize/apply.ts --plan                       # 로그인 없이 작업 목록만 출력
 *   node scripts/hiring-sample-sanitize/apply.ts [--dry-run]                  # 로그인 후 GET 만: 서버 상태를 원본과 전수 대조(쓰기 없음, 불일치 시 exit 1)
 *   node scripts/hiring-sample-sanitize/apply.ts --apply [--only id,id] [--include-masked id,id|all]
 *   node scripts/hiring-sample-sanitize/apply.ts --rollback [--only id,id]    # 대상 = apply 상태가 verified 인 항목 전부(--only 와 교집합)
 * 로그인: headful 크롬(userDataDir /tmp/tplaudit/admin-profile, chmod 700)에서 사람이 로그인·2단계 인증. 비밀번호·쿠키는 읽지도 저장하지도 않는다.
 * 세션은 실행 중에만 프로필에 저장되고 종료 시 프로필 디렉터리를 삭제한다.
 * 상태는 /tmp/tplaudit/out/apply-state.json 에 즉시 기록. 재개 시 verified 도 서버 상태가 기대와 같을 때만 건너뛴다.
 * 쓰기 시작 전에 선택 항목 전체를 한 번 GET 대조해 하나라도 다르면 쓰기 0건으로 종료한다.
 */
import fs from 'node:fs'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'

const AUDIT = '/tmp/tplaudit'
const OUT = `${AUDIT}/out`
const MANIFEST = `${OUT}/patch/manifest.json`
const STATE = `${OUT}/apply-state.json`
const PROFILE = `${AUDIT}/admin-profile`
const ADMIN = 'https://admin.workdeck.work'
const PNG_BASE = 'https://duyteczbadcuvfeawlzu.supabase.co/storage/v1/object/public/hiring-assets/'
const LOGIN_WAIT_MS = 15 * 60 * 1000

// patch.ts 와 같은 canonical 해시(jsonb 키 순서 무관)
const canon = (o: any): any =>
  Array.isArray(o)
    ? o.map(canon)
    : o && typeof o === 'object'
      ? Object.fromEntries(
          Object.keys(o)
            .sort()
            .map((k) => [k, canon(o[k])])
        )
      : o
const sha = (o: any) =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify(canon(o)) ?? 'undefined')
    .digest('hex')
const shaBytes = (b: Uint8Array) => crypto.createHash('sha256').update(b).digest('hex')

// ---------- 인자 ----------
const argv = process.argv.slice(2)
const flag = (n: string) => argv.includes(n)
const list = (n: string): string[] | null => {
  const i = argv.indexOf(n)
  return i < 0 || !argv[i + 1] ? null : argv[i + 1].split(',').filter(Boolean)
}
const MODE: 'plan' | 'dry-run' | 'apply' | 'rollback' = flag('--plan')
  ? 'plan'
  : flag('--apply')
    ? 'apply'
    : flag('--rollback')
      ? 'rollback'
      : 'dry-run'
if (flag('--apply') && flag('--rollback'))
  throw new Error('--apply 와 --rollback 은 함께 쓸 수 없습니다')
const ONLY = list('--only')
const INCLUDE_MASKED = list('--include-masked')

// ---------- manifest / 작업 목록 ----------
type Entry = Record<string, any>
const manifest: Entry[] = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
const keyOf = (e: Entry) => (e.op === 'cover' ? `cover:${e.templateId}` : `${e.op}:${e.contentId}`)
const onlyOk = (e: Entry) => !ONLY || ONLY.includes(e.contentId) || ONLY.includes(e.templateId)

// apply: auto 는 항상, auto-masked 는 --include-masked 로 지정한 것만, review 는 제외. rollback 은 아래 rollbackTargets 로 고른다.
function selectable(e: Entry): { ok: boolean; why?: string } {
  if (e.status === 'review') return { ok: false, why: 'review' }
  if (
    e.status === 'auto-masked' &&
    !(INCLUDE_MASKED && (INCLUDE_MASKED.includes('all') || INCLUDE_MASKED.includes(e.contentId)))
  )
    return { ok: false, why: 'auto-masked(미포함)' }
  if (!onlyOk(e)) return { ok: false, why: '--only 제외' }
  return { ok: true }
}
const blockEntries = manifest.filter((e) => e.op !== 'cover')
const coverEntries = manifest.filter((e) => e.op === 'cover')

function printPlan() {
  const ops = ['patch', 'image', 'delete', 'cover']
  console.log(`manifest: ${MANIFEST} (${manifest.length}건) / 모드: ${MODE}`)
  for (const op of ops) {
    const es = manifest.filter((e) => e.op === op)
    const sel = es.filter((e) => selectable(e).ok)
    const skipped: Record<string, number> = {}
    for (const e of es) {
      const s = selectable(e)
      if (!s.ok) skipped[s.why!] = (skipped[s.why!] ?? 0) + 1
    }
    console.log(`  ${op}: 전체 ${es.length} / 대상 ${sel.length} / 제외 ${JSON.stringify(skipped)}`)
  }
  for (const e of manifest.filter((e) => e.op !== 'cover' && !selectable(e).ok))
    console.log(
      `  제외 [${e.op}] ${e.templateName} #${e.order} ${e.contentId} — ${selectable(e).why}`
    )
  if (MODE === 'rollback')
    console.log('  (rollback 대상은 실행 시 apply 상태가 verified 인 항목 전부 — --only 와 교집합)')
}

// ---------- 상태 ----------
type St = {
  status: 'pending' | 'creating' | 'applied' | 'verified' | 'failed' | 'skipped'
  note?: string
  imagePath?: string
  newContentId?: string
  // apply 기록: manifest 기대값(재개 시 서버 상태와 대조)
  expected?: { sanitizedDataSha256?: string; afterSha256?: string; imagePath?: string }
  ts: string
}
type State = {
  apply: Record<string, St>
  rollback: Record<string, St>
  originals: Record<string, { sha256: string; uploadable: boolean }> // 백업 시 저장한 원본 이미지 바이트 해시
}
const state: State = fs.existsSync(STATE)
  ? { originals: {}, ...JSON.parse(fs.readFileSync(STATE, 'utf8')) }
  : { apply: {}, rollback: {}, originals: {} }
const bucket = () => (MODE === 'rollback' ? state.rollback : state.apply)
const saveState = () => fs.writeFileSync(STATE, JSON.stringify(state, null, 2))
function setState(e: Entry, status: St['status'], extra: Partial<St> = {}) {
  bucket()[keyOf(e)] = { ...bucket()[keyOf(e)], ...extra, status, ts: new Date().toISOString() }
  saveState()
  console.log(`[${status}] ${keyOf(e)} ${e.templateName ?? ''} ${extra.note ?? ''}`)
}
const failFast = (e: Entry, why: string): never => {
  setState(e, 'failed', { note: why })
  throw new Error(`중단: ${keyOf(e)} ${why}`)
}

// ---------- 브라우저 ----------
let page: any
async function api(
  method: string,
  url: string,
  body?: any
): Promise<{ status: number; json: any }> {
  return page.evaluate(
    async ([m, u, b]: [string, string, any]) => {
      const ac = new AbortController()
      const t = setTimeout(() => ac.abort(), 90000)
      try {
        const r = await fetch(u, {
          method: m,
          headers: b ? { 'content-type': 'application/json' } : undefined,
          body: b ? JSON.stringify(b) : undefined,
          credentials: 'same-origin',
          signal: ac.signal,
        })
        let j: any = null
        try {
          j = await r.json()
        } catch {
          /* 본문 없음 */
        }
        return { status: r.status, json: j }
      } catch (err) {
        return { status: 0, json: { error: String(err) } }
      } finally {
        clearTimeout(t)
      }
    },
    [method, url, body] as [string, string, any]
  )
}

const rmProfile = () => fs.rmSync(PROFILE, { recursive: true, force: true })

async function login() {
  const { chromium } = createRequire('/tmp/pwtool/package.json')('playwright-core')
  rmProfile() // 이전 실행 잔여 세션 제거 후 700 권한으로 새로 만든다
  fs.mkdirSync(PROFILE, { recursive: true, mode: 0o700 })
  fs.chmodSync(PROFILE, 0o700)
  console.log(
    '세션은 실행 중에만 프로필(/tmp/tplaudit/admin-profile, 700)에 저장되고 종료 시 삭제됩니다.'
  )
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
    headless: false,
    viewport: null,
  })
  page = ctx.pages()[0] ?? (await ctx.newPage())
  await page.goto(`${ADMIN}/admin/templates`)
  console.log(
    '브라우저에서 로그인·2단계 인증을 완료하세요(최대 15분 대기). 이 스크립트는 비밀번호·쿠키를 읽지 않습니다.'
  )
  const t0 = Date.now()
  let last = 0
  for (;;) {
    let status = 0
    try {
      status = (await api('GET', '/api/admin/hiring-templates')).status
    } catch {
      /* 페이지 이동 중 */
    }
    if (status === 200) break
    if (Date.now() - t0 > LOGIN_WAIT_MS) {
      await ctx.close().catch(() => {}) // 브라우저를 닫아야 finally 의 프로필 삭제가 확실히 된다
      throw new Error('로그인 대기 시간(15분) 초과')
    }
    if (Date.now() - last > 30000) {
      console.log(
        `  대기 중… ${Math.round((Date.now() - t0) / 1000)}s (GET hiring-templates → ${status})`
      )
      last = Date.now()
    }
    await new Promise((r) => setTimeout(r, 3000))
  }
  console.log('로그인 확인됨')
  return ctx
}

type Detail = { template: any; contents: any[] }
const getDetail = async (templateId: string): Promise<Detail> => {
  const r = await api('GET', `/api/admin/hiring-templates/${templateId}`)
  if (r.status !== 200)
    throw new Error(
      `GET 상세 실패 ${templateId}: ${r.status} ${JSON.stringify(r.json)?.slice(0, 200)}`
    )
  return r.json as Detail
}
const audit = (templateId: string) =>
  JSON.parse(fs.readFileSync(`${AUDIT}/${templateId}.json`, 'utf8'))
const afterSha = (e: Entry) => shaBytes(fs.readFileSync(e.afterPng))

// 공개 URL 바이트 해시(저장소 파일 경로 → 실제 바이트). 없으면 null
async function publicSha(path: string): Promise<string | null> {
  const res = await fetch(PNG_BASE + path, { cache: 'no-store' })
  return res.ok ? shaBytes(Buffer.from(await res.arrayBuffer())) : null
}
async function publicBytes(path: string): Promise<Buffer> {
  const res = await fetch(PNG_BASE + path, { cache: 'no-store' })
  if (!res.ok) throw new Error(`다운로드 실패 ${path}: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}
const isImageBytes = (buf: Buffer) =>
  buf[0] === 0x89 ||
  buf[0] === 0xff ||
  buf.subarray(0, 4).toString() === 'RIFF' ||
  buf.subarray(0, 3).toString() === 'GIF'

const detailCache = async () => {
  const m = new Map<string, Detail>()
  return async (id: string) => {
    if (!m.has(id)) m.set(id, await getDetail(id))
    return m.get(id)!
  }
}

// ---------- 서버 상태 분류 ----------
// apply 관점: original(원본과 data·imagePath 일치) / applied(기대 결과와 data·바이트 일치) / mismatch
type Cls = { cls: 'original' | 'applied' | 'mismatch'; why?: string }
async function classifyApply(e: Entry, d: Detail): Promise<Cls> {
  const cur = d.contents.find((c) => c.id === e.contentId)
  if (e.op === 'delete') {
    if (!cur) return { cls: 'applied' }
    return sha(cur.data) === e.originalDataSha256 && cur.imagePath === e.originalImagePath
      ? { cls: 'original' }
      : { cls: 'mismatch', why: '삭제 대상이 원본과 다름' }
  }
  if (!cur) return { cls: 'mismatch', why: '블록 없음' }
  const h = sha(cur.data)
  if (h === e.originalDataSha256 && cur.imagePath === e.originalImagePath)
    return { cls: 'original' }
  if (cur.imagePath !== e.originalImagePath && (e.op === 'image' || h === e.sanitizedDataSha256)) {
    if ((await publicSha(cur.imagePath)) === afterSha(e)) return { cls: 'applied' } // 바이트 해시 일치일 때만
    return { cls: 'mismatch', why: 'imagePath 는 바뀌었으나 이미지 바이트가 기대와 다름' }
  }
  return {
    cls: 'mismatch',
    why: `data/imagePath 불일치(data ${h === e.originalDataSha256 ? '원본' : h === e.sanitizedDataSha256 ? '정리본' : '알 수 없음'})`,
  }
}
function classifyCover(e: Entry, d: Detail): Cls {
  const p = d.template.imagePath
  if (p === e.originalImagePath) return { cls: 'original' }
  const rec = state.apply[keyOf(e)]?.expected?.imagePath
  if (rec && p === rec) return { cls: 'applied' }
  const src = d.contents.find((c) => c.id === e.sourceContentId)
  if (src?.imagePath && p === src.imagePath) return { cls: 'applied' }
  return { cls: 'mismatch', why: `cover 경로 불일치(${p})` }
}

// ---------- dry-run ----------
async function dryRun() {
  const get = await detailCache()
  const rows: string[] = []
  const tally: Record<string, number> = {}
  const note = (res: string, line: string) => {
    tally[res] = (tally[res] ?? 0) + 1
    if (res !== 'original') rows.push(`${res.padEnd(10)} ${line}`)
  }
  for (const e of blockEntries) {
    const c = await classifyApply(e, await get(e.templateId))
    note(c.cls, `[${e.op}/${e.status}] ${e.templateName} #${e.order} ${e.contentId} ${c.why ?? ''}`)
  }
  for (const e of coverEntries) {
    const c = classifyCover(e, await get(e.templateId))
    note(c.cls, `[cover] ${e.templateName} ${e.templateId} ${c.why ?? ''}`)
  }
  console.log(rows.join('\n') || '(모두 원본과 일치)')
  console.log(`dry-run 결과: ${JSON.stringify(tally)}  (쓰기 없음)`)
  if (tally.mismatch) {
    console.error('불일치 있음 → exit 1')
    process.exitCode = 1
  }
}

// ---------- 백업 ----------
async function backupAll(targets: Entry[]) {
  const dir = `${AUDIT}/backup/${new Date().toISOString().replace(/[:.]/g, '-')}`
  fs.mkdirSync(dir, { recursive: true })
  const ids = [...new Set(manifest.map((e) => e.templateId))]
  for (const id of ids) fs.writeFileSync(`${dir}/${id}.json`, JSON.stringify(await getDetail(id)))
  // 원본 이미지 바이트 해시 저장(롤백 검증용). 이미 저장된 값은 덮어쓰지 않는다.
  for (const e of targets.filter((x) => x.op !== 'cover')) {
    if (state.originals[e.contentId]) continue
    const buf = await publicBytes(e.originalImagePath)
    state.originals[e.contentId] = { sha256: shaBytes(buf), uploadable: isImageBytes(buf) }
  }
  saveState()
  fs.writeFileSync(`${dir}/original-bytes.json`, JSON.stringify(state.originals, null, 2))
  console.log(
    `백업 완료: ${dir} (템플릿 ${ids.length}개 상세+커버 imagePath, 원본 이미지 해시 ${Object.keys(state.originals).length}개)`
  )
}

// ---------- apply ----------
const mismatchAbort = (lines: string[]): never => {
  console.error(lines.join('\n'))
  throw new Error(`서버 상태가 기대와 달라 쓰기 0건으로 중단(${lines.length}건)`)
}

// 서버가 apply 기대 결과와 같은지(재개 시 verified 도 이것으로 확인)
async function verifyApplied(e: Entry, d: Detail): Promise<string | null> {
  if (e.op === 'delete')
    return d.contents.some((c) => c.id === e.contentId) ? '삭제되지 않음' : null
  const cur = d.contents.find((c) => c.id === e.contentId)
  if (!cur) return '블록 없음'
  if (e.op === 'patch' && sha(cur.data) !== e.sanitizedDataSha256) return 'data 해시 불일치'
  if (cur.imagePath === e.originalImagePath) return 'imagePath 가 원본 그대로'
  if ((await publicSha(cur.imagePath)) !== afterSha(e)) return '이미지 바이트 해시 불일치'
  return null
}

async function applyBlock(e: Entry) {
  const get = await getDetail(e.templateId)
  const c = await classifyApply(e, get)
  if (c.cls === 'mismatch') return failFast(e, `쓰기 전 대조 불일치: ${c.why}`)
  const cur = get.contents.find((x) => x.id === e.contentId)
  const expected = {
    sanitizedDataSha256: e.sanitizedDataSha256,
    afterSha256: e.op === 'delete' ? undefined : afterSha(e),
    imagePath: cur && c.cls === 'applied' ? cur.imagePath : undefined,
  }
  if (c.cls === 'applied') {
    return setState(e, 'verified', {
      expected,
      imagePath: cur?.imagePath,
      note: '이미 반영됨(서버 상태 대조 일치)',
    })
  }
  setState(e, 'pending', { expected })
  if (e.op === 'delete') {
    const r = await api(
      'DELETE',
      `/api/admin/hiring-templates/${e.templateId}/contents/${e.contentId}`
    )
    const err = await verifyApplied(e, await getDetail(e.templateId))
    if ((r.status === 200 || r.status === 0) && !err) return setState(e, 'verified')
    return failFast(e, `DELETE ${r.status} / 검증: ${err ?? 'ok'}`)
  }
  const body: any = { imageBase64: fs.readFileSync(e.afterPng).toString('base64') }
  if (e.op === 'patch') body.data = JSON.parse(fs.readFileSync(e.scenePath, 'utf8'))
  const r = await api(
    'PATCH',
    `/api/admin/hiring-templates/${e.templateId}/contents/${e.contentId}`,
    body
  )
  if (r.status !== 200 && r.status !== 0)
    return failFast(e, `PATCH ${r.status} ${JSON.stringify(r.json)?.slice(0, 200)}`)
  const after = await getDetail(e.templateId) // 타임아웃(0)이어도 실제 상태 대조
  const err = await verifyApplied(e, after)
  const got = after.contents.find((x) => x.id === e.contentId)
  // (a) 응답 content.imagePath == GET imagePath (b) 공개 URL 바이트 해시 == afterPng 해시(verifyApplied)
  if (!err && r.status === 200 && r.json?.content?.imagePath !== got?.imagePath)
    return failFast(
      e,
      `응답 imagePath(${r.json?.content?.imagePath}) != GET imagePath(${got?.imagePath})`
    )
  if (err) return failFast(e, `PATCH ${r.status} / 검증 실패: ${err}`)
  setState(e, 'verified', {
    imagePath: got.imagePath,
    expected: { ...expected, imagePath: got.imagePath },
    note: r.status === 200 ? '' : '(응답 없음이었으나 서버 상태 일치)',
  })
}

async function applyCover(e: Entry) {
  if (!e.sourceContentId) return setState(e, 'skipped', { note: '원천 블록 없음' })
  const src = manifest.find((m) => m.op !== 'cover' && m.contentId === e.sourceContentId)
  if (src && state.apply[keyOf(src)]?.status !== 'verified')
    return setState(e, 'skipped', { note: `원천 블록(${keyOf(src)}) 미반영 — 커버 건너뜀` })
  const d = await getDetail(e.templateId)
  const block = d.contents.find((c) => c.id === e.sourceContentId)
  if (!block?.imagePath) return failFast(e, '원천 블록 imagePath 없음')
  const p = d.template.imagePath
  if (p === block.imagePath && p !== e.originalImagePath)
    return setState(e, 'verified', { imagePath: p, expected: { imagePath: p }, note: '이미 동일' })
  if (p !== e.originalImagePath)
    return failFast(e, `쓰기 전 커버 경로(${p}) != 원본 경로(${e.originalImagePath})`)
  setState(e, 'pending', { expected: { imagePath: block.imagePath } })
  const r = await api('PATCH', `/api/admin/hiring-templates/${e.templateId}`, {
    imagePath: block.imagePath,
  })
  const after = (await getDetail(e.templateId)).template.imagePath
  if (after !== block.imagePath)
    return failFast(e, `cover PATCH ${r.status} / 경로 불일치(${after})`)
  setState(e, 'verified', { imagePath: after })
}

// ---------- rollback ----------
const rollbackTargets = () =>
  manifest.filter((e) => state.apply[keyOf(e)]?.status === 'verified' && onlyOk(e))

// 서버가 원본 상태(data 해시 + 이미지 바이트 해시)인지
async function verifyRolledBack(e: Entry, blockId: string, d: Detail): Promise<string | null> {
  const cur = d.contents.find((c) => c.id === blockId)
  if (!cur) return '블록 없음'
  const origC = audit(e.templateId).contents.find((c: any) => c.id === e.contentId)
  if (e.op !== 'image' && sha(cur.data) !== sha(origC.data)) return 'data 해시 != 원본'
  if ((await publicSha(cur.imagePath)) !== state.originals[e.contentId]?.sha256)
    return '이미지 바이트 해시 != 원본'
  return null
}

async function rollbackBlock(e: Entry) {
  const key = keyOf(e)
  const orig = state.originals[e.contentId]
  const origC = audit(e.templateId).contents.find((c: any) => c.id === e.contentId)
  const d = await getDetail(e.templateId)
  const rb = state.rollback[key]
  if (rb?.status === 'creating' && !rb.newContentId)
    throw new Error(
      `중단: ${key} — 재생성 POST 후 새 contentId 를 기록하지 못했을 수 있음. admin 에서 블록 중복 여부를 수동 확인하세요`
    )
  if (!orig?.uploadable)
    return setState(e, 'skipped', {
      note: '원본 이미지 바이트가 이미지가 아님(SVG) — 업로드 API 가 거부, 수동 복구 필요',
    })
  const png = await publicBytes(e.originalImagePath)
  if (shaBytes(png) !== orig.sha256)
    return failFast(e, '원본 이미지 바이트 해시가 백업 시점과 다름')
  const patchBody = (): any => ({
    imageBase64: png.toString('base64'),
    ...(e.op === 'image' ? {} : { data: origC.data }),
  })

  if (e.op === 'delete') {
    let newId = rb?.newContentId
    if (!newId) {
      if (d.contents.some((c) => c.id === e.contentId))
        return failFast(e, '삭제 블록이 이미 존재함(예상 밖)')
      setState(e, 'creating', { note: 'POST 전' }) // POST 전에 기록
      const c = await api('POST', `/api/admin/hiring-templates/${e.templateId}/contents`, {
        contentType: origC.contentType,
        sortOrder: origC.sortOrder,
      })
      newId = c.json?.content?.id
      if (c.status !== 201 || !newId)
        return failFast(e, `재생성 POST ${c.status} (새 id 없음 — 수동 확인 필요)`)
      setState(e, 'creating', { newContentId: newId, note: `새 contentId ${newId}` }) // 응답 즉시 기록
    }
    const cur = (await getDetail(e.templateId)).contents.find((c) => c.id === newId)
    if (!cur) return failFast(e, `새 블록 ${newId} 를 서버에서 찾지 못함`)
    if (await verifyRolledBack(e, newId, await getDetail(e.templateId))) {
      const p = await api(
        'PATCH',
        `/api/admin/hiring-templates/${e.templateId}/contents/${newId}`,
        { title: origC.title, data: origC.data, imageBase64: png.toString('base64') }
      )
      if (p.status !== 200 && p.status !== 0) return failFast(e, `재생성 PATCH ${p.status}`)
    }
    const err = await verifyRolledBack(e, newId, await getDetail(e.templateId))
    if (err) return failFast(e, `재생성 검증 실패: ${err}(새 id ${newId})`)
    return setState(e, 'verified', { newContentId: newId, note: `새 contentId ${newId}` })
  }

  const cur = d.contents.find((c) => c.id === e.contentId)
  if (!cur) return failFast(e, '블록 없음')
  if (!(await verifyRolledBack(e, e.contentId, d)))
    return setState(e, 'verified', { note: '이미 원본 상태(data·바이트 일치)' })
  const err0 = await verifyApplied(e, d) // 반영 결과 그대로일 때만 롤백
  if (err0) return failFast(e, `롤백 전 서버 상태가 반영 결과와 다름: ${err0}`)
  setState(e, 'pending')
  const r = await api(
    'PATCH',
    `/api/admin/hiring-templates/${e.templateId}/contents/${e.contentId}`,
    patchBody()
  )
  if (r.status !== 200 && r.status !== 0) return failFast(e, `rollback PATCH ${r.status}`)
  const err = await verifyRolledBack(e, e.contentId, await getDetail(e.templateId))
  if (err) return failFast(e, `롤백 검증 실패: ${err}`)
  setState(e, 'verified')
}

async function rollbackCover(e: Entry) {
  const d = await getDetail(e.templateId)
  const p = d.template.imagePath
  if (p === e.originalImagePath) return setState(e, 'verified', { note: '이미 원래 경로' })
  if (p !== state.apply[keyOf(e)]?.expected?.imagePath && p !== state.apply[keyOf(e)]?.imagePath)
    return failFast(e, `롤백 전 커버 경로(${p})가 반영 결과와 다름`)
  setState(e, 'pending')
  const r = await api('PATCH', `/api/admin/hiring-templates/${e.templateId}`, {
    imagePath: e.originalImagePath,
  })
  if ((await getDetail(e.templateId)).template.imagePath !== e.originalImagePath)
    return failFast(e, `cover rollback ${r.status} / 검증 실패`)
  setState(e, 'verified')
}

// ---------- main ----------
printPlan()
if (MODE === 'plan') process.exit(0)
const cleanup = () => rmProfile()
process.on('SIGINT', () => {
  cleanup()
  process.exit(130)
})
// 로그인 대기 초과·오류로 끝나도 프로필(세션)을 지우도록 login 도 try 안에서 실행
let ctx: Awaited<ReturnType<typeof login>> | undefined
try {
  ctx = await login()
  if (MODE === 'dry-run') await dryRun()
  else if (MODE === 'apply') {
    const blocks = blockEntries.filter((x) => selectable(x).ok)
    const covers = coverEntries.filter((x) => selectable(x).ok)
    // rollback 이 끝난 항목을 다시 apply 하면 이전 세대 기록을 새로 덮어쓴다(리허설 apply→rollback→apply)
    for (const e of [...blocks, ...covers])
      if (state.rollback[keyOf(e)]?.status === 'verified') {
        delete state.apply[keyOf(e)]
        delete state.rollback[keyOf(e)]
        console.log(`[새 세대] ${keyOf(e)} — rollback 완료 기록이 있어 apply 기록을 새로 시작`)
      }
    saveState()
    // 사전 대조: 선택 항목 전체를 한 번 GET 해서 하나라도 다르면 쓰기 0건으로 종료
    const get = await detailCache()
    const bad: string[] = []
    for (const e of blocks) {
      const c = await classifyApply(e, await get(e.templateId))
      if (c.cls === 'mismatch')
        bad.push(`[${e.op}] ${e.templateName} #${e.order} ${e.contentId}: ${c.why}`)
      const st = state.apply[keyOf(e)]
      if (st?.status === 'verified' && c.cls !== 'applied')
        bad.push(`[${e.op}] ${e.contentId}: 상태 파일은 verified 인데 서버는 ${c.cls}`)
    }
    for (const e of covers) {
      const c = classifyCover(e, await get(e.templateId))
      if (c.cls === 'mismatch') bad.push(`[cover] ${e.templateName} ${e.templateId}: ${c.why}`)
    }
    if (bad.length) mismatchAbort(bad)
    await backupAll([...blocks, ...covers])
    for (const e of blocks) await applyBlock(e)
    for (const e of covers) await applyCover(e)
  } else {
    const targets = rollbackTargets()
    const blocks = [...targets.filter((e) => e.op !== 'cover')].reverse()
    const covers = targets.filter((e) => e.op === 'cover')
    console.log(
      `rollback 대상: apply 상태 verified ${targets.length}건 (블록 ${blocks.length} / 커버 ${covers.length})`
    )
    for (const e of blocks) {
      const o = state.originals[e.contentId]
      if (!o)
        throw new Error(`중단: ${e.contentId} 원본 이미지 해시가 상태 파일에 없음(apply 백업 누락)`)
      if (!o.uploadable)
        console.warn(`  경고: ${keyOf(e)} 원본이 SVG 라 롤백 불가 → 수동 복구 필요`)
    }
    // 사전 대조: 모든 대상의 서버 상태가 apply 결과(또는 이미 롤백됨)와 같은지 한 번 GET 해서 확인
    const get = await detailCache()
    const bad: string[] = []
    for (const e of blocks) {
      const d = await get(e.templateId)
      const rb = state.rollback[keyOf(e)]
      if (e.op === 'delete') {
        const there = rb?.newContentId
          ? d.contents.some((c) => c.id === rb.newContentId)
          : d.contents.some((c) => c.id === e.contentId)
        if (!rb && there) bad.push(`[delete] ${e.contentId}: 삭제됐어야 하는데 서버에 존재`)
        if (rb?.status === 'creating' && !rb.newContentId)
          bad.push(`[delete] ${e.contentId}: creating 인데 새 id 없음 — 수동 확인`)
        continue
      }
      const rolled = !(await verifyRolledBack(e, e.contentId, d))
      if (!rolled) {
        const err = await verifyApplied(e, d)
        if (err)
          bad.push(
            `[${e.op}] ${e.templateName} #${e.order} ${e.contentId}: 반영 결과도 원본도 아님(${err})`
          )
      }
    }
    for (const e of covers) {
      const p = (await get(e.templateId)).template.imagePath
      const exp = state.apply[keyOf(e)]
      if (p !== e.originalImagePath && p !== exp?.expected?.imagePath && p !== exp?.imagePath)
        bad.push(`[cover] ${e.templateId}: 커버 경로(${p})가 반영 결과도 원본도 아님`)
    }
    if (bad.length) mismatchAbort(bad)
    await backupAll(targets)
    for (const e of covers) await rollbackCover(e)
    for (const e of blocks) await rollbackBlock(e)
  }
  if (MODE === 'apply' || MODE === 'rollback') {
    const b = bucket()
    const count = (s: string) => Object.values(b).filter((v) => v.status === s).length
    console.log(
      `완료: verified ${count('verified')} / skipped ${count('skipped')} / failed ${count('failed')}`
    )
  }
} finally {
  await new Promise((r) => setTimeout(r, 500))
  await ctx?.close().catch(() => {})
  cleanup()
  console.log('프로필 디렉터리 삭제됨')
}
