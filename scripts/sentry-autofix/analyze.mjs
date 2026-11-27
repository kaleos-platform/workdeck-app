#!/usr/bin/env node
// 운영자의 "분석 요청"(Sentry 노트 autofix:analyze-request)을 받아 코드 수정 없이 원인·영향을 분석하고
// 비공개 저장소 이슈로 게시하는 호스트 poller. launchd 10분 주기, 회당 1건. publish.mjs 와 같은 run lock.
// Sentry 에는 고정 코드 노트(analyzing·analyzed·analyze-failed)만 쓴다. AI 문장은 이슈 본문에만 간다.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as lib from './lib.mjs'
import {
  MIN,
  acquireLock,
  cleanDir,
  codexCmd,
  codexHome,
  decodeUtf8,
  defaultConfig,
  killRun,
  makeRunId,
  makeStepRunner,
  parseArgs,
  parseEnvFile,
  promptText,
  readAuth,
  readSafeBuf,
  realDeps,
  scanTexts,
  sh,
  startProxy,
  watched,
} from './run.mjs'

const ANALYZE_LIMIT = 25 * MIN // 분석 컨테이너
const TOTAL_LIMIT = 30 * MIN // 소스 준비·프록시 포함 전체
const UNTIL_MS = 40 * MIN // analyzing 노트 유효 시간
const MAX_ATTEMPTS = 3 // 일시 오류 연속 횟수(10분 주기)를 넘으면 analyze-failed
const SHORT_ID = /^[A-Za-z0-9-]{3,40}$/

const ISSUE_URL = new RegExp(`^https://github\\.com/${lib.ANALYZE_REPO}/issues/(\\d{1,7})$`)

// 비공개 분석 저장소에서 첫 줄(header)로 이슈를 찾고(검색 색인 지연 회피 — 로컬 비교), 없을 때만 만든다. 이슈 번호 반환.
// 실패는 Error(code) — 호출자가 일시 오류로 다룬다. 조회 오류면 만들지 않는다
export function findOrCreateAnalysisIssue({ run, header, title, body, bodyFile }) {
  const lp = run('gh', [
    'issue',
    'list',
    '--repo',
    lib.ANALYZE_REPO,
    '--label',
    lib.ANALYZE_LABEL,
    '--state',
    'all',
    '--limit',
    '200',
    '--json',
    'number,body',
  ])
  let list
  try {
    if (lp.status !== 0) throw new Error('gh')
    list = JSON.parse(lp.stdout)
    if (!Array.isArray(list)) throw new Error('shape')
  } catch {
    throw new Error('gh-list-failed')
  }
  // ponytail: 최근 200건만 본다 — 이슈가 그보다 쌓이면 nonce 검색(gh search)으로 바꿀 것
  const found = list.find(
    (x) =>
      String(x?.body ?? '')
        .split('\n')[0]
        .replace(/\r$/, '') === header &&
      Number.isInteger(x?.number) &&
      x.number > 0
  )
  if (found) return found.number
  fs.writeFileSync(bodyFile, body, { mode: 0o600 })
  let cr
  try {
    cr = run('gh', [
      'issue',
      'create',
      '--repo',
      lib.ANALYZE_REPO,
      '--label',
      lib.ANALYZE_LABEL,
      '--title',
      title,
      '--body-file',
      bodyFile,
    ])
  } finally {
    fs.rmSync(bodyFile, { force: true })
  }
  if (cr.status !== 0) throw new Error('gh-create-failed')
  const m = String(cr.stdout).trim().split('\n').pop().match(ISSUE_URL)
  if (!m) throw new Error('gh-create-unparsable') // 다음 주기에 검색부터
  return Number(m[1])
}

class Fail extends Error {
  constructor(code, { transient = false } = {}) {
    super(code)
    this.code = code
    this.transient = transient
  }
}

// 일일 러너(04:30, lock 대기 약 5분)를 보호한다: now+40분이 04:25 KST 를 넘는 03:45 부터 06:30 까지 시작하지 않는다
export function inBlackout(now) {
  const kstMin = (Math.floor(now / MIN) + 9 * 60) % (24 * 60)
  return kstMin >= 3 * 60 + 45 && kstMin < 6 * 60 + 30
}

const writeJsonAtomic = (file, obj) => {
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 })
  fs.renameSync(tmp, file)
}

const firstLine = (s) =>
  String(s ?? '')
    .split('\n')[0]
    .replace(/\r$/, '')

export async function analyzeRun({ cfg, deps }) {
  const log = deps.log ?? console.log
  const results = []
  if (inBlackout(deps.now())) return { exitCode: 0, results }
  const lock = acquireLock(cfg.stateDir, { maxMs: cfg.lockMaxMs, now: deps.now() })
  if (!lock) return { exitCode: 0, results } // run·publish 진행 중 — 조용히 종료
  try {
    const env = parseEnvFile(cfg.envFile) ?? {}
    const secret = env.SENTRY_AUTOFIX_NOTE_SECRET
    const token = env.SENTRY_API_TOKEN
    if (!token || !secret || secret.length < 32) {
      log('SENTRY_API_TOKEN 또는 서명 키(SENTRY_AUTOFIX_NOTE_SECRET 32자 이상) 없음 — 건너뜀')
      return { exitCode: 0, results }
    }
    if (!readAuth(cfg)) {
      log('전용 Codex 로그인 없음 — 건너뜀')
      return { exitCode: 0, results }
    }
    const org = encodeURIComponent(env.SENTRY_ORG ?? 'kaleos')
    const project = encodeURIComponent(env.SENTRY_PROJECT ?? 'workdeck-app')
    const stateRoot = path.join(cfg.stateDir, 'analyze')
    fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 })
    const stateFile = (issueId, nonce) => path.join(stateRoot, `${issueId}-${nonce}.json`)
    const readState = (issueId, nonce) => {
      try {
        return JSON.parse(fs.readFileSync(stateFile(issueId, nonce), 'utf8'))
      } catch {
        return null
      }
    }

    const get = (p) => deps.fetchJson(`https://sentry.io/api/0${p}`, token)
    const getPage = async (p) =>
      deps.fetchPage
        ? deps.fetchPage(`https://sentry.io/api/0${p}`, token)
        : { body: await get(p), link: null }
    const notesOf = async (id) =>
      (await get(`/organizations/${org}/issues/${id}/comments/`)).map((c) => ({
        text: c.data?.text ?? '',
        dateCreated: c.dateCreated,
      }))

    // ---- 미해결 이슈 + 코멘트 수집(조회 오류는 이번 주기 중단, 부작용 없음) ----
    let issues
    const comments = new Map()
    try {
      const q = new URLSearchParams({
        query: 'is:unresolved environment:production lastSeen:-14d',
        statsPeriod: '14d',
        sort: 'user',
        limit: '100',
      })
      const raw = []
      let cursor = null
      for (let page = 0; page < 10; page++) {
        const qs = new URLSearchParams(q)
        if (cursor) qs.set('cursor', cursor)
        const res = await getPage(`/projects/${org}/${project}/issues/?${qs}`)
        raw.push(...res.body)
        cursor = lib.nextCursor(res.link)
        if (!cursor || raw.length >= lib.MAX_ISSUES_COLLECT) break
      }
      issues = raw.slice(0, lib.MAX_ISSUES_COLLECT).map((i) => ({
        id: String(i.id),
        shortId: String(i.shortId),
        title: String(i.title),
        culprit: String(i.culprit ?? ''),
        metadata: { type: i.metadata?.type },
        level: i.level,
        firstSeen: i.firstSeen,
        lastSeen: i.lastSeen,
        count: Number(i.count),
        userCount: Number(i.userCount ?? 0),
      }))
      for (let n = 0; n < issues.length; n += 10)
        await Promise.all(
          issues.slice(n, n + 10).map(async (i) => {
            try {
              comments.set(i.id, await notesOf(i.id))
            } catch {} // 그 이슈만 건너뛴다
          })
        )
    } catch {
      log('Sentry 조회 실패 — 이번 주기 중단')
      return { exitCode: 0, results }
    }

    // ---- 선정: 회당 1건 ----
    let issue
    let pick
    for (const i of issues) {
      if (!/^\d{1,20}$/.test(i.id) || !comments.has(i.id)) continue
      pick = lib.pickAnalysis({
        comments: comments.get(i.id),
        issueId: i.id,
        secret,
        now: deps.now(),
        stateOf: (nonce) => readState(i.id, nonce),
      })
      if (pick) {
        issue = i
        break
      }
    }
    if (!issue) return { exitCode: 0, results }
    if (inBlackout(deps.now())) return { exitCode: 0, results } // 수집이 길어져 시간대에 들어왔으면 시작 안 함

    // ---- 처리 ----
    const { nonce } = pick
    const issueId = issue.id
    const shortId = issue.shortId
    const saveState = (st) => writeJsonAtomic(stateFile(issueId, nonce), st)
    let st = readState(issueId, nonce) ?? { stage: 'started' }
    st = { ...st, attempts: (st.attempts ?? 0) + 1 }
    saveState(st)
    const slack = async (text) => {
      try {
        await deps.slack(text)
      } catch {}
    }
    const putNote = async (text) => {
      if (cfg.noWrite) return void log(`[no-write] ${issueId}: ${text}`)
      await deps.addComment(issueId, text)
    }
    const run = (cmd, args) => deps.run(cmd, args, { timeout: 300_000 })

    const fail = async (code) => {
      const c = lib.analyzeFailCode(code)
      try {
        await putNote(lib.analyzeFailedNote(c))
      } catch {
        log(`${shortId}: 실패 노트 쓰기 실패`)
      }
      saveState({ ...st, stage: 'failed', code: c })
      results.push({ shortId, status: 'failed', code: c })
      await slack(`분석 실패 ${shortId} ${c}`)
    }

    try {
      // 1) 분석(이미 결과가 있거나 이슈가 만들어졌으면 건너뜀)
      if (!st.result && st.issueNumber === undefined) {
        if (!SHORT_ID.test(shortId)) throw new Fail('bad-shortid')
        let event
        try {
          event = await get(`/organizations/${org}/issues/${issueId}/events/latest/`)
        } catch {
          throw new Fail('sentry-event-failed', { transient: true })
        }
        try {
          await putNote(
            lib.analyzingNote({
              nonce,
              until: new Date(deps.now() + UNTIL_MS).toISOString(),
            })
          )
        } catch {
          throw new Fail('note-write-failed', { transient: true })
        }
        const out = await runAnalysis({ cfg, deps, issue, event })
        const body = lib.buildAnalysisIssueBody({
          nonce,
          shortId,
          verdict: out.verdict,
          conf: out.conf,
          auto: out.auto,
          analysis: out.analysis,
        })
        st = { ...st, result: { verdict: out.verdict, conf: out.conf, auto: out.auto, body } }
        saveState(st)
      }
      const { verdict, conf, auto, body } = st.result

      // --no-write 는 외부 쓰기(이슈·Sentry 메모·Slack) 전부 끔 — 이슈 본문은 로그로만
      if (cfg.noWrite) {
        log(`[no-write] ${shortId} 이슈 본문:\n${body}`)
        saveState({ ...st, stage: 'done' })
        results.push({ shortId, status: 'no-write' })
        return { exitCode: 0, results }
      }

      // 2) 이슈 게시: 첫 줄 `요청 ID: <nonce>` 로 먼저 찾고(검색 색인 지연 회피 — 로컬 비교), 없을 때만 만든다
      if (st.issueNumber === undefined) {
        const header = `요청 ID: ${nonce}`
        let n
        try {
          n = findOrCreateAnalysisIssue({
            run,
            header,
            title: `[Sentry 분석] ${shortId} ${lib.VERDICT_KO[verdict]}`,
            body,
            bodyFile: path.join(stateRoot, `${issueId}-${nonce}.body.md`),
          })
        } catch (e) {
          throw new Fail(e.message, { transient: true })
        }
        st = { ...st, stage: 'issue-created', issueNumber: n, result: { verdict, conf, auto } } // 본문 사본은 남기지 않는다
        saveState(st) // 생성 직후 기록 — 이후 실패해도 같은 요청으로 이슈가 또 만들어지지 않는다
      }
      const n = st.issueNumber

      // 3) 완료 메모 직전 재조회: 분석 도중 운영자가 skip·request·새 분석 요청을 남겼으면 덮어쓰지 않는다
      let fresh
      try {
        fresh = await notesOf(issueId)
      } catch {
        throw new Fail('sentry-notes-failed', { transient: true })
      }
      const ownStart = fresh
        .filter((c) => lib.ANALYZING.exec(firstLine(c.text))?.[1] === nonce)
        .map((c) => Date.parse(c.dateCreated))
      const boundary = ownStart.length ? Math.max(...ownStart) : Date.parse(pick.requestAt)
      const superseded = fresh.some((c) => {
        if (!(Date.parse(c.dateCreated) > boundary)) return false
        const line = firstLine(c.text).trim()
        if (/^autofix:(skip|request)(\s|$)/.test(line)) return true
        const rq = lib.parseAnalyzeRequest(line, issueId, secret)
        return !!rq && rq.nonce !== nonce
      })
      if (!superseded) {
        const note = lib.analyzedNote({
          nonce,
          verdict,
          conf,
          auto,
          issue: n,
          sig: lib.analyzedSig(issueId, nonce, verdict, conf, auto, n, secret),
        })
        try {
          await putNote(note)
        } catch {
          throw new Fail('note-write-failed', { transient: true })
        }
      }
      saveState({ ...st, stage: 'done' })
      results.push({ shortId, status: superseded ? 'superseded' : 'analyzed', issue: n })
      await slack(`분석 완료 ${shortId} ${lib.VERDICT_KO[verdict]} 이슈 #${n}`)
    } catch (e) {
      const code = e instanceof Fail ? e.code : 'analyze-error'
      const transient = e instanceof Fail ? e.transient : true
      if (!transient || st.attempts >= MAX_ATTEMPTS) await fail(code)
      else log(`${shortId}: 일시 오류 ${code} (${st.attempts}/${MAX_ATTEMPTS})`)
    }
    return { exitCode: 0, results }
  } finally {
    lock.release()
  }
}

// 분석 컨테이너 1회. 소스는 읽기 전용 마운트, 설치·patch·검증 없음. 호스트 검사를 모두 통과해야 결과를 돌려준다
async function runAnalysis({ cfg, deps, issue, event }) {
  const log = deps.log ?? console.log
  const facts = lib.extractFacts(issue, event)
  const cls = lib.classifyEvent(issue, event)
  if (!cls.usable) throw new Fail(cls.reason)
  const runId = makeRunId(deps.now())
  const root = path.join(cfg.stateDir, 'analyze-work', runId)
  const d = Object.fromEntries(['repo', 'base', 'ctx', 'out'].map((k) => [k, path.join(root, k)]))
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  for (const k of ['ctx', 'out']) fs.mkdirSync(d[k])
  const auth = readAuth(cfg)
  const windows = lib.tokenWindows(auth ? [auth] : [])
  let proxy = null
  try {
    const { value: prep, diskLow } = await watched(
      cfg,
      deps,
      runId,
      TOTAL_LIMIT,
      async (deadline) => {
        let prep
        try {
          prep = await deps.prepareSource({ repoDir: d.repo, baseDir: d.base })
        } catch {
          throw new Fail('source-prepare-failed', { transient: true })
        }
        // .env 류가 export 에 있으면 모델이 읽을 수 있다 — 중단(예시 파일 제외)
        const rels = fs.readdirSync(d.base, { recursive: true }).map((p) => String(p))
        if (rels.some((f) => /(^|[\\/])\.env/.test(f) && !/\.(example|sample|template)$/.test(f)))
          throw new Fail('env-file-in-export')
        const context = lib.buildContext(facts)
        fs.writeFileSync(path.join(d.ctx, 'context.md'), context)
        fs.writeFileSync(path.join(d.ctx, 'prompt.md'), `${promptText('analyze.md')}\n\n${context}`)
        // run 마다 임의 비밀값: 프록시와 codex 는 env 파일로만 받는다
        const secret = crypto.randomBytes(32).toString('hex')
        try {
          proxy = await startProxy({ cfg, deps, runId, secret, tag: '-analyze' })
        } catch {
          throw new Fail('proxy-start-failed', { transient: true })
        }
        const steps = makeStepRunner({
          cfg,
          deps,
          runId,
          deadline,
          issueDir: root,
          safeId: 'analyze',
        })
        let r
        try {
          r = await steps.run('analyze', {
            net: cfg.intNet,
            image: cfg.codexImage,
            memory: '4g',
            cpus: 2,
            limitMs: ANALYZE_LIMIT,
            workdir: '/work/repo',
            mounts: [
              { host: d.base, ctr: '/work/repo', ro: true },
              { host: d.ctx, ctr: '/ctx', ro: true },
              { host: d.out, ctr: '/out' },
            ],
            tmpfs: [codexHome],
            env: {
              CODEX_HOME: '/codex-home',
              HOME: '/tmp',
              MODEL: cfg.model,
              PROXY_URL: `http://${proxy}:8080/v1`,
            },
            secretEnv: { AUTOFIX_SECRET: secret },
            cmd: [
              'sh',
              '-c',
              `${codexCmd('/work/repo', '/out/last-message.txt')} < /ctx/prompt.md`,
            ],
          })
        } catch (e) {
          throw new Fail(e?.message === 'deadline' ? 'analyze-timeout' : 'analyze-error', {
            transient: e?.message !== 'deadline',
          })
        }
        if (r.timedOut) throw new Fail('analyze-timeout')
        if (r.code !== 0) throw new Fail('analyze-exec-failed', { transient: true })
        return prep
      }
    )
    if (diskLow) throw new Fail('disk-low', { transient: true })

    // ---- 호스트 검사: 하나라도 걸리면 이슈를 올리지 않는다 ----
    const aBuf = readSafeBuf(path.join(d.out, 'analysis.md'), 64 * 1024)
    const vBuf = readSafeBuf(path.join(d.out, 'verdict.json'), 64 * 1024)
    const reasons = []
    const analysis = aBuf === null ? null : decodeUtf8(aBuf)
    const verdictText = vBuf === null ? null : decodeUtf8(vBuf)
    if (aBuf === null) reasons.push('analysis-missing-or-unsafe')
    else if (analysis === null) reasons.push('analysis-invalid-utf8')
    const parsed = verdictText === null ? null : lib.parseAnalyzeOutput(verdictText)
    if (!parsed) reasons.push('verdict-invalid')
    if (analysis !== null) {
      for (const x of lib.checkText(analysis, { analysis: true })) reasons.push(`analysis-${x}`)
      for (const x of lib.analysisPiiHits(analysis)) reasons.push(`pii-${x}`)
      // 마크다운 백틱은 서식일 뿐이다 — 원문·분석 양쪽에서 빼고 대조한다(`코드` 인용이 조각 검사에 오탐되지 않게)
      const nb = (x) => String(x).replaceAll('`', '')
      reasons.push(
        ...(await scanTexts({
          deps,
          issueDir: root,
          windows,
          facts: {
            ...facts,
            message: nb(facts.message),
            rawMessages: facts.rawMessages.map(nb),
          },
          grep: prep.grep,
          texts: { 'analysis.md': nb(analysis) },
        }))
      )
    }
    if (reasons.length) {
      log(`분석 검사 실패: ${reasons.join(', ')}`)
      throw new Fail(reasons[0])
    }
    return { ...parsed, analysis }
  } finally {
    if (proxy) await deps.docker(['kill', proxy]).catch(() => {})
    await killRun(deps, runId).catch(() => {})
    // 컨테이너가 만진 디렉터리는 호스트가 지우지 않는다 — 컨테이너로 비운 뒤 호스트가 만든 logs 만 지운다
    if (await cleanDir({ cfg, deps, runId, dir: root }))
      fs.rmSync(root, { recursive: true, force: true })
    else log(`정리 실패: ${root}`)
  }
}

const isMain = (() => {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
})()

if (isMain) {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (e) {
    console.error(e.message)
    process.exit(2)
  }
  const cfg = { ...defaultConfig(), noWrite: args.noWrite }
  const deps = { ...realDeps(cfg, { noSlack: args.noSlack }), run: sh }
  deps.gitleaks.available =
    sh('gitleaks', ['version'], { stdio: 'ignore', timeout: 20_000 }).status === 0
  analyzeRun({ cfg, deps }).then(
    (r) => process.exit(r.exitCode),
    () => {
      console.error('실행 오류')
      process.exit(1)
    }
  )
}
