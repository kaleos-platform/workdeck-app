// 네이버 블로그 Aside 퍼블리셔 — 맥미니 Aside 브라우저(로그인 세션 유지)로 스마트에디터 ONE 을 조작한다.
// 흐름(2026-11-04 PoC 확정):
//   1) 웹앱이 승인 시점에 고정한 publishSnapshot(제목·html 블록·사진·카테고리·태그)만 게시한다
//   2) 게시 데이터는 파일로 넘긴다 — repl 코드에 본문을 이어 붙이지 않는다(스크립트 주입 방지)
//   3) 본문·사진은 input_buffer iframe 에 paste 이벤트로 넣는다(서식·업로드 유지)
//   4) 「작성 중인 글」 복원 팝업이 뜨면 사람의 자동저장일 수 있어 멈춘다
//   5) autoPublish=false(리허설)면 임시저장까지만
//   6) 최종 발행 직전 publish-attempt 로 배포당 1회만 통과 — 그 뒤 결과가 불명확하면 재시도 없이 사람 확인
//
// aside repl 은 stdin 대화형으로 띄워 한 세션에서 단계별로 실행한다(입력 1개당 120초 제한).

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Publisher, PublishContext, PublishResult } from './index.js'
import { markPublishAttempt } from '../job-poller.js'

type SnapshotBlock =
  | { kind: 'html'; html: string }
  | { kind: 'photo'; index: number; label: string; assetId?: string | null }

type PublishSnapshot = {
  version: 1
  title: string
  blocks: SnapshotBlock[]
  category: string | null
  tags: string[]
  autoPublish: boolean
}

type AsideConfig = { blogId?: string; account?: string }

export interface ReplSession {
  /** 한 줄짜리 코드를 실행하고 출력과 성공 여부를 돌려준다. */
  run(code: string, timeoutMs?: number): Promise<{ ok: boolean; out: string }>
  close(): Promise<void>
}

export type AsideDeps = {
  openRepl: (account: string) => Promise<ReplSession>
  markPublishAttempt: (jobId: string) => Promise<boolean>
  fetchImage: (url: string) => Promise<Buffer>
  // Aside repl 의 fs 는 계정 폴더(~/.aside/u/<n>) 밖을 읽지 못한다 — 그 안에 둔다.
  jobDir: (jobId: string, account: string) => string
}

const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const ANSI = /\x1b\[[0-9;]*m/g

/** 붙여 넣을 html 의 글자 수(공백 제외) — 에디터에 본문이 실제로 들어갔는지 비교한다. */
export function htmlTextLength(html: string): number {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39);/g, 'x')
    .replace(/\s+/g, '').length
}

function isSnapshot(v: unknown): v is PublishSnapshot {
  const s = v as PublishSnapshot | null
  return !!s && s.version === 1 && typeof s.title === 'string' && Array.isArray(s.blocks)
}

/** 출력에서 `@@KEY {json}` 줄을 찾는다. */
export function readMarker<T>(out: string, key: string): T | null {
  const line = out.split('\n').find((l) => l.startsWith(`@@${key} `))
  if (!line) return null
  try {
    return JSON.parse(line.slice(key.length + 3)) as T
  } catch {
    return null
  }
}

// repl 에 보내는 코드. 사람이 쓴 값은 J(파일에서 읽은 JSON)로만 들어간다.
// 한 입력 = 한 줄이어야 해서 줄바꿈 없이 쓴다.
const STEP = {
  load: (path: string) =>
    `globalThis.J = JSON.parse(await fs.readFile(${JSON.stringify(path)}, 'utf8')); console.log('@@LOADED ' + JSON.stringify({ blocks: J.blocks.length }))`,
  open: () =>
    `globalThis.W = await openTab('https://blog.naver.com/PostWriteForm.naver?blogId=' + encodeURIComponent(J.blogId)); await sleep(5000); { const s = await snapshot(W); console.log('@@STATE ' + JSON.stringify({ url: W.url(), autosave: /작성 중인 글이 있습니다/.test(s.tree), editor: (await W.locator('.se-documentTitle .se-text-paragraph').count()) > 0 })) }`,
  title: () =>
    `{ const h = W.getByRole('button', { name: '닫기' }); if (await h.count()) await h.first().click().catch(() => {}); } await W.locator('.se-documentTitle .se-text-paragraph').first().click(); await W.keyboard.type(J.title); await W.locator('.se-component.se-text .se-text-paragraph').first().click(); await sleep(500); console.log('@@TITLE {}')`,
  // input_buffer iframe body 에 paste 이벤트. html 은 J 에서 꺼낸다.
  html: (i: number) =>
    `await W.evaluate((h) => { const b = document.querySelector('iframe[id^=input_buffer]').contentDocument.body; const dt = new DataTransfer(); dt.setData('text/html', h); dt.setData('text/plain', ''); b.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, J.blocks[${i}].html); await sleep(1500); console.log('@@BLOCK ' + JSON.stringify({ i: ${i} }))`,
  photo: (i: number) =>
    `{ const before = await W.locator('.se-component.se-image img[src*="pstatic"]').count(); const b64 = (await fs.readFile(J.dir + '/' + J.blocks[${i}].file)).toString('base64'); await W.evaluate(async ([data, type]) => { const bin = atob(data); const u = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k); const dt = new DataTransfer(); dt.items.add(new File([u], 'photo.' + (type.split('/')[1] || 'jpg').replace('jpeg', 'jpg'), { type })); document.querySelector('iframe[id^=input_buffer]').contentDocument.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, [b64, J.blocks[${i}].mimeType]); let n = before; for (let t = 0; t < 60 && n <= before; t++) { await sleep(500); n = await W.locator('.se-component.se-image img[src*="pstatic"]').count(); } await W.keyboard.press('ArrowDown').catch(() => {}); console.log('@@BLOCK ' + JSON.stringify({ i: ${i}, images: n })) }`,
  verify: () =>
    `console.log('@@VERIFY ' + JSON.stringify(await W.evaluate(() => { const body = [...document.querySelectorAll('.se-component.se-text')].map((c) => c.innerText).join(' '); return { images: document.querySelectorAll('.se-component.se-image img[src*="pstatic"]').length, placeholder: body.includes('[사진:'), textLength: body.replace(/\s+/g, '').length, title: document.querySelector('.se-documentTitle')?.innerText.trim() ?? '' }; })))`,
  saveDraft: () =>
    `{ const before = (await snapshot(W)).tree.match(/임시저장된 글 보기, (\\d+)개/)?.[1]; await W.getByRole('button', { name: '저장', exact: true }).click(); await sleep(3000); const after = (await snapshot(W)).tree.match(/임시저장된 글 보기, (\\d+)개/)?.[1]; console.log('@@DRAFT ' + JSON.stringify({ before: Number(before), after: Number(after) })) }`,
  // 발행 설정창: 카테고리·전체공개·태그. data-click-area 는 클래스 해시보다 안정적이다.
  settings: () =>
    `{ await W.evaluate(() => document.querySelector('[data-click-area="tpb.publish"]').click()); await sleep(1500); const r = await W.evaluate(async ([category, tags]) => { const L = document.querySelector('[class^="layer_publish"],[class*=" layer_publish"]'); if (!L) return { panel: false }; let categoryOk = true; if (category) { L.querySelector('[data-click-area="tpb*i.category"]').click(); await new Promise((r) => setTimeout(r, 700)); const lab = [...L.querySelectorAll('label')].find((l) => l.textContent.trim() === category); if (lab) lab.click(); else categoryOk = false; } const pub = L.querySelector('[data-click-area="tpb*i.all"]'); if (pub && !pub.checked) pub.click(); return { panel: true, categoryOk, public: !!pub?.checked, current: L.querySelector('[data-click-area="tpb*i.category"]')?.textContent.trim() }; }, [J.category, J.tags]); for (const tag of J.tags) { await W.locator('[data-click-area="tpb*i.tag"]').click(); await W.keyboard.type(tag); await W.keyboard.press('Enter'); await sleep(200); } console.log('@@SETTINGS ' + JSON.stringify(r)) }`,
  publish: () =>
    `{ await W.evaluate(() => document.querySelector('[data-click-area="tpb*i.publish"]').click()); let u = ''; for (let t = 0; t < 60; t++) { await sleep(1000); u = W.url(); if (new RegExp('blog\\\\.naver\\\\.com/' + J.blogId + '/\\\\d+').test(u) || /logNo=\\d+/.test(u)) break; } console.log('@@PUBLISHED ' + JSON.stringify({ url: u })) }`,
  // 방금 우리가 만든 자동저장(15분 이내)만 지운다. 더 오래된 것은 사람이 쓰던 글일 수 있어 둔다.
  discardOwnAutosave: () =>
    `{ await W.goto('https://blog.naver.com/PostWriteForm.naver?blogId=' + encodeURIComponent(J.blogId)); await sleep(5000); const t = (await snapshot(W)).tree; const m = /(\\d+)일 (오전|오후) (\\d+)시 (\\d+)분에 작성중이던/.exec(t); let discarded = false; if (m) { const now = new Date(); let h = Number(m[3]) % 12; if (m[2] === '오후') h += 12; const at = new Date(now.getFullYear(), now.getMonth(), Number(m[1]), h, Number(m[4])); if (Math.abs(now - at) < 15 * 60 * 1000) { await W.getByRole('button', { name: '취소', exact: true }).first().click(); await sleep(800); discarded = true; } } console.log('@@AUTOSAVE ' + JSON.stringify({ found: !!m, discarded })) }`,
  closeTab: () => `await closeTab(W).catch(() => {}); console.log('@@CLOSED {}')`,
}

export const ASIDE_STEPS = STEP

/** `aside repl` 대화형 프로세스. 입력마다 `[ok | ` / `[error | ` 줄로 끝난다. */
export async function openAsideRepl(account: string, cwd: string): Promise<ReplSession> {
  const child: ChildProcessWithoutNullStreams = spawn('aside', ['repl', '--account', account], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let buffer = ''
  child.stdout.on('data', (d) => (buffer += String(d)))
  child.stderr.on('data', (d) => (buffer += String(d)))

  return {
    run(code, timeoutMs = 115_000) {
      const start = buffer.length
      child.stdin.write(code.replace(/\n/g, ' ') + '\n')
      return new Promise((resolve) => {
        const deadline = Date.now() + timeoutMs
        const tick = () => {
          const out = buffer.slice(start).replace(ANSI, '')
          const done = /\[(ok|error) \| \d+ms\]/.exec(out)
          if (done) return resolve({ ok: done[1] === 'ok', out })
          if (child.exitCode !== null || Date.now() > deadline) return resolve({ ok: false, out })
          setTimeout(tick, 200)
        }
        tick()
      })
    },
    async close() {
      child.stdin.end('exit\n')
      setTimeout(() => child.kill(), 3000).unref()
    },
  }
}

async function fetchImageBytes(url: string): Promise<Buffer> {
  const u = new URL(url)
  if (u.protocol !== 'https:') throw new Error('이미지 주소는 https 만 허용합니다')
  const allowed = (process.env.SC_ASSET_HOSTS ?? '.supabase.co').split(',').map((h) => h.trim())
  if (!allowed.some((h) => (h.startsWith('.') ? u.hostname.endsWith(h) : u.hostname === h))) {
    throw new Error(`허용되지 않은 이미지 호스트: ${u.hostname}`)
  }
  const res = await fetch(u, { redirect: 'error', signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`이미지를 받지 못했습니다(${res.status})`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_IMAGE_BYTES) throw new Error('이미지가 20MB 를 넘습니다')
  return buf
}

const realDeps: AsideDeps = {
  openRepl: (account) => openAsideRepl(account, homedir()),
  markPublishAttempt,
  fetchImage: fetchImageBytes,
  jobDir: (jobId, account) =>
    join(
      homedir(),
      '.aside',
      'u',
      /^u(\d+)$/.exec(account)?.[1] ?? '1',
      'sc-jobs',
      jobId.replace(/[^A-Za-z0-9_-]/g, '')
    ),
}

const review = (errorMessage: string): PublishResult => ({
  ok: false,
  errorCode: 'NEEDS_REVIEW',
  errorMessage,
})

export class NaverBlogAsidePublisher implements Publisher {
  readonly name = 'naver-blog-aside'
  constructor(private readonly deps: AsideDeps = realDeps) {}

  async publish(ctx: PublishContext): Promise<PublishResult> {
    const snapshot = ctx.deployment.publishSnapshot
    if (!isSnapshot(snapshot)) {
      return { ok: false, errorCode: 'VALIDATION', errorMessage: '고정된 게시본(publishSnapshot)이 없습니다' }
    }
    const config = ((ctx.channel.config as { aside?: AsideConfig } | null)?.aside ?? {}) as AsideConfig
    if (!config.blogId) {
      return { ok: false, errorCode: 'VALIDATION', errorMessage: '채널 설정에 블로그 ID 가 없습니다' }
    }
    if (!ctx.jobId) return { ok: false, errorCode: 'VALIDATION', errorMessage: 'job id 가 없습니다' }
    // 이전 시도가 최종 발행까지 갔다면 게시됐을 수 있다 — 다시 누르지 않는다.
    if (ctx.deployment.publishAttemptedAt) {
      return review('이전 자동 게시 시도의 결과를 확인해야 합니다. 블로그에 글이 올라갔는지 확인해 주세요')
    }
    if (snapshot.blocks.some((b) => b.kind === 'photo' && !b.assetId)) {
      return { ok: false, errorCode: 'VALIDATION', errorMessage: '채워지지 않은 사진 자리가 있습니다' }
    }

    const account = config.account ?? 'u1'
    const dir = this.deps.jobDir(ctx.jobId, account)
    await mkdir(dir, { recursive: true })
    let repl: ReplSession | null = null
    try {
      // 게시 데이터·사진을 파일로 준비한다.
      const blocks = []
      for (const [i, b] of snapshot.blocks.entries()) {
        if (b.kind === 'html') {
          blocks.push({ kind: 'html', html: b.html })
          continue
        }
        const asset = ctx.assets.find((a) => a.id === b.assetId)
        if (!asset) return { ok: false, errorCode: 'VALIDATION', errorMessage: `사진 ${b.index + 1}번을 찾을 수 없습니다` }
        const mimeType = asset.mimeType?.startsWith('image/') ? asset.mimeType : 'image/jpeg'
        const file = `photo-${i}`
        await writeFile(join(dir, file), await this.deps.fetchImage(asset.url))
        blocks.push({ kind: 'photo', file, mimeType })
      }
      const expectedImages = blocks.filter((b) => b.kind === 'photo').length
      const expectedText = snapshot.blocks.reduce(
        (n, b) => n + (b.kind === 'html' ? htmlTextLength(b.html) : 0),
        0
      )
      await writeFile(
        join(dir, 'job.json'),
        JSON.stringify({
          dir,
          blogId: config.blogId,
          title: snapshot.title,
          blocks,
          category: snapshot.category,
          tags: snapshot.tags.slice(0, 30),
        })
      )

      repl = await this.deps.openRepl(account)
      const step = async (code: string) => {
        const r = await repl!.run(code)
        if (process.env.SC_ASIDE_DEBUG) console.log('[aside]', r.out.slice(-600))
        if (!r.ok) throw new StepError(r.out.slice(-500))
        return r.out
      }

      await step(STEP.load(join(dir, 'job.json')))
      const state = readMarker<{ url: string; autosave: boolean; editor: boolean }>(await step(STEP.open()), 'STATE')
      if (!state || /nid\.naver\.com|nidlogin/.test(state.url)) {
        return { ok: false, errorCode: 'AUTH_FAILED', errorMessage: '네이버 로그인이 풀렸습니다. 맥미니 Aside 에서 다시 로그인해 주세요' }
      }
      if (state.autosave) {
        return review('네이버 글쓰기에 작성 중인 글이 남아 있어 멈췄습니다. 이어서 쓰던 글이 아니면 정리한 뒤 다시 시도해 주세요')
      }
      if (!state.editor) throw new StepError('에디터를 찾지 못했습니다')

      await step(STEP.title())
      for (const [i, b] of blocks.entries()) {
        await step(b.kind === 'html' ? STEP.html(i) : STEP.photo(i))
      }
      const v = readMarker<{ images: number; placeholder: boolean; textLength: number; title: string }>(
        await step(STEP.verify()),
        'VERIFY'
      )
      // 붙여넣기가 조용히 실패하면 빈 본문이 발행된다 — 글자 수가 크게 모자라면 멈춘다.
      if (
        !v ||
        v.images !== expectedImages ||
        v.placeholder ||
        v.title !== snapshot.title ||
        v.textLength < expectedText * 0.9
      ) {
        // 아직 발행 전 — 에디터에 남은 자동저장 때문에 재시도는 사람 확인으로 넘어간다.
        return review(`본문을 확인하지 못했습니다(사진 ${v?.images ?? '?'}/${expectedImages}). 네이버 글쓰기의 작성 중인 글을 정리해 주세요`)
      }

      if (!snapshot.autoPublish) {
        const d = readMarker<{ before: number; after: number }>(await step(STEP.saveDraft()), 'DRAFT')
        if (!d || !(d.after > d.before)) return review('임시저장 여부를 확인하지 못했습니다')
        await repl.run(STEP.discardOwnAutosave()).catch(() => null)
        return { ok: true, draftSaved: true }
      }

      const s = readMarker<{ panel: boolean; categoryOk: boolean; public: boolean }>(await step(STEP.settings()), 'SETTINGS')
      if (!s?.panel) throw new StepError('발행 설정창이 열리지 않았습니다')
      if (!s.categoryOk) return review(`블로그에 「${snapshot.category}」 카테고리가 없습니다`)
      if (!s.public) return review('전체공개로 설정하지 못했습니다')

      if (!(await this.deps.markPublishAttempt(ctx.jobId))) {
        return review('이미 발행을 시도한 배포라 다시 발행하지 않았습니다')
      }
      // 여기부터는 실제로 게시됐을 수 있다 — 실패는 모두 사람 확인.
      try {
        const p = readMarker<{ url: string }>(await step(STEP.publish()), 'PUBLISHED')
        const url = p?.url ?? ''
        if (new RegExp(`blog\\.naver\\.com/${config.blogId}/\\d+`).test(url) || /logNo=\d+/.test(url)) {
          await repl.run(STEP.discardOwnAutosave()).catch(() => null)
          return { ok: true, platformUrl: url }
        }
        return review('발행 버튼을 눌렀지만 글 주소를 확인하지 못했습니다. 블로그에 올라갔는지 확인해 주세요')
      } catch (err) {
        return review(`발행 중 오류: ${err instanceof Error ? err.message : String(err)}`)
      }
    } catch (err) {
      // 발행 전 단계의 실패 — 다음 시도는 작성 중인 글 팝업에서 사람 확인으로 넘어간다.
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, errorCode: 'PLATFORM_ERROR', errorMessage: `Aside 게시 실패: ${message}` }
    } finally {
      if (repl) {
        await repl.run(STEP.closeTab(), 10_000).catch(() => null)
        await repl.close().catch(() => {})
      }
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

class StepError extends Error {}
