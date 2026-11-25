#!/usr/bin/env node
// Sentry 오류 자동 수정 러너 — dry 경로 전용 오케스트레이터(호스트, LLM 없음).
// Sentry 는 GET 과 이슈 노트(comment) 쓰기만 한다(--no-write 로 끔). 원격 저장소 쓰기·PR 생성 경로는 없다.
// 사용: node run.mjs [--issue <shortId>] [--fixture <json>] [--no-slack] [--no-write]
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import * as lib from './lib.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MIN = 60_000
const GB = 1024 ** 3

export function defaultConfig(env = process.env) {
  const home = os.homedir()
  return {
    stateDir: env.AUTOFIX_STATE_DIR ?? path.join(home, '.local/state/workdeck-autofix'),
    codexDir: path.join(home, '.config/workdeck/autofix-codex'),
    envFile: path.join(home, '.config/workdeck/sentry-autofix.env'),
    repoUrl: 'https://github.com/kaleos-platform/workdeck-app.git',
    baseBranch: 'develop',
    codexImage: 'workdeck-autofix-codex:latest',
    proxyImage: 'workdeck-autofix-proxy:latest',
    extNet: 'workdeck-autofix-ext',
    intNet: 'workdeck-autofix-int',
    model: env.AUTOFIX_MODEL ?? 'gpt-6.1-terra',
    slackChannel: 'C0APP3N44JZ',
    deadlineMs: 45 * MIN, // 이슈당
    maxRetryFix: 2,
    minFreeBytes: 20 * GB, // 사전 점검
    diskKillBytes: 15 * GB, // 실행 중 여유 공간이 이 아래이거나
    diskDropBytes: 15 * GB, // 이슈 시작 대비 이만큼 줄면 이 run 의 컨테이너를 kill
    diskPollMs: 3000,
    proxyMaxRequests: 150, // 이슈당 모델 요청 상한
    authMinHours: 3,
    authWarnHours: 72,
    codexBin: 'codex', // 호스트 Codex CLI(토큰 갱신 전용, 모델 호출 없음)
    authRefreshHours: 7 * 24, // access token 남은 시간이 이 이하일 때 갱신(수명 10일 → 약 3일마다)
    authRefreshTimeoutMs: 120_000,
    lockMaxMs: 4 * 60 * MIN,
    maxFailures: 3,
    triageLimitMs: 10 * MIN, // 판단 배치당
    triageDeadlineMs: 30 * MIN, // 판단 전체
    noWrite: false, // true 면 Sentry 노트를 쓰지 않는다(--no-write 와 동일)
  }
}

// ---------- 안전한 파일 읽기: 심볼릭 링크·FIFO·비일반 파일·과대 파일 거부 ----------
export function readSafeBuf(file, maxBytes) {
  let fd
  try {
    // O_NONBLOCK: FIFO 를 열다 영구 정지하지 않게 한다(비일반 파일은 아래 isFile 에서 즉시 거부)
    fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK
    )
    const st = fs.fstatSync(fd)
    if (!st.isFile() || st.size > maxBytes) return null
    return fs.readFileSync(fd)
  } catch {
    return null
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

// 문자열 버전. UTF-8 이 아니면 null(fatal 디코드)
export function readSafe(file, maxBytes) {
  const buf = readSafeBuf(file, maxBytes)
  return buf === null ? null : decodeUtf8(buf)
}

export function decodeUtf8(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf)
  } catch {
    return null
  }
}

// ---------- docker run 인자 조립(모든 컨테이너 공통 하드닝) ----------
export function buildRunArgs({
  name,
  runId,
  net,
  image,
  mounts = [],
  env = {},
  tmpfs = [],
  memory,
  cpus,
  workdir,
  cmd = [],
  detach = false,
  keepLogs = false,
  envFile,
  stateTag,
}) {
  const a = [
    'run',
    detach ? '-d' : '--init',
    '--rm',
    '--name',
    name,
    '--label',
    `workdeck.autofix=${runId}`,
    ...(stateTag ? ['--label', `workdeck.autofix.state=${stateTag}`] : []),
    '--network',
    net,
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--read-only',
    '--user',
    'node',
    '--memory',
    memory,
    '--memory-swap',
    memory,
    '--cpus',
    String(cpus),
    '--pids-limit',
    '1024',
    '--tmpfs',
    '/tmp:rw,exec,nosuid,size=3g',
  ]
  // 출력은 attach 로 받고 호스트 로그 파일(무제한 증가)은 남기지 않는다. 프록시만 로그를 유지
  if (!keepLogs) a.push('--log-driver', 'none')
  else a.push('--log-opt', 'max-size=1m', '--log-opt', 'max-file=1')
  // 비밀값은 프로세스 목록(docker 인자)에 보이지 않게 0600 env 파일로만 넘긴다
  if (envFile) a.push('--env-file', envFile)
  for (const t of tmpfs) a.push('--tmpfs', t)
  for (const m of mounts) a.push('-v', `${m.host}:${m.ctr}${m.ro ? ':ro' : ''}`)
  for (const [k, v] of Object.entries(env)) a.push('-e', `${k}=${v}`)
  if (workdir) a.push('-w', workdir)
  a.push(image, ...cmd)
  return a
}

// ---------- 실제 의존성(테스트에서는 대역으로 교체) ----------
// 모든 외부 프로세스에 timeout 과 비대화형 git 환경을 건다
export function sh(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    ...opts,
  })
}

// dir 는 호출마다 새로 만든 빈 디렉터리(우리가 쓴 고정 파일명만)라 저장소의 .gitleaks.toml·.gitleaksignore 는 없다.
// patch 안의 `gitleaks:allow` 주석으로 우회되지 않게 --ignore-gitleaks-allow, 설정 환경 변수는 비운다
export function gitleaksScan(dir) {
  return sh(
    'gitleaks',
    ['dir', dir, '--no-banner', '--no-color', '--exit-code', '1', '--ignore-gitleaks-allow'],
    { stdio: 'ignore', env: { PATH: process.env.PATH, HOME: os.tmpdir() } }
  ).status
}

// base export 의 텍스트 파일을 한 번 메모리에 읽는다(원문 조각 검사용: includes 정확 일치)
export function loadCorpus(baseDir) {
  const parts = []
  for (const rel of fs.readdirSync(baseDir, { recursive: true })) {
    // 수정 허용 경로의 소스만 — 픽스처·문서·테스트 데이터에 있는 문자열을 "원래 있던 것"으로 보지 않는다
    if (!lib.isAllowedPath(String(rel))) continue
    const f = path.join(baseDir, String(rel))
    try {
      const st = fs.lstatSync(f)
      if (st.isFile() && st.size <= 1024 * 1024) parts.push(fs.readFileSync(f, 'utf8'))
    } catch {}
  }
  return parts.join('\n')
}

// ---------- 전용 Codex 토큰 갱신(호스트) ----------
// `codex app-server` 의 account/read {refreshToken:true} 로 Codex 가 직접 갱신·저장한다.
// 자식 환경은 PATH·HOME·CODEX_HOME 만. stderr 는 버리고 stdout 은 파싱만 한다(email·계정 id 포함) —
// 결과는 고정 코드만 돌려준다.
export function refreshCodexAuth({ codexBin, codexDir, timeoutMs = 120_000 }) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(codexBin, ['app-server'], {
        env: {
          PATH: process.env.PATH ?? '/usr/bin:/bin',
          HOME: os.homedir(),
          CODEX_HOME: codexDir,
        },
        stdio: ['pipe', 'pipe', 'ignore'],
      })
    } catch {
      return resolve({ ok: false, error: 'spawn-failed' })
    }
    let done = false
    let buf = ''
    const finish = (r) => {
      if (done) return
      done = true
      clearTimeout(timer)
      child.stdin.destroy()
      child.kill('SIGTERM')
      // SIGTERM 을 무시하면 강제 종료(러너가 끝나지 않는 일을 막는다)
      setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), 5000).unref()
      resolve(r)
    }
    const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), timeoutMs)
    const send = (m) => child.stdin.write(`${JSON.stringify(m)}\n`)
    child.stdin.on('error', () => {})
    child.on('error', () => finish({ ok: false, error: 'spawn-failed' }))
    child.on('exit', () => finish({ ok: false, error: 'exited' }))
    child.stdout.on('data', (d) => {
      buf += d
      if (buf.length > 1024 * 1024) return finish({ ok: false, error: 'output-too-large' })
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        let m
        try {
          m = JSON.parse(line)
        } catch {
          continue
        }
        if (m?.id === 1) {
          if (m.error) return finish({ ok: false, error: 'initialize-error' })
          send({ method: 'initialized' })
          send({ id: 2, method: 'account/read', params: { refreshToken: true } })
        } else if (m?.id === 2) {
          return finish(m.error ? { ok: false, error: 'refresh-error' } : { ok: true })
        }
      }
    })
    send({
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'workdeck-autofix', version: '1' } },
    })
  })
}

export function realDeps(cfg, { noSlack }) {
  const deps = {
    refreshAuth: () =>
      refreshCodexAuth({
        codexBin: cfg.codexBin,
        codexDir: cfg.codexDir,
        timeoutMs: cfg.authRefreshTimeoutMs,
      }),
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    freeBytes: () => {
      fs.mkdirSync(cfg.stateDir, { recursive: true, mode: 0o700 })
      const s = fs.statfsSync(cfg.stateDir)
      return s.bavail * s.bsize
    },
    docker: (args, { timeoutMs = 60_000, name } = {}) =>
      new Promise((resolve) => {
        const p = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] })
        let out = ''
        let err = ''
        let timedOut = false
        // 로그는 끝부분만 보존(디버깅용, 호스트 로컬 파일로만 남는다)
        p.stdout.on('data', (d) => (out = (out + d).slice(-8192)))
        p.stderr.on('data', (d) => (err = (err + d).slice(-8192)))
        const t = setTimeout(() => {
          timedOut = true
          if (name) sh('docker', ['kill', name], { stdio: 'ignore', timeout: 30_000 })
          p.kill('SIGKILL')
        }, timeoutMs)
        p.on('error', () => {
          clearTimeout(t)
          resolve({ code: 127, stdout: out, stderr: err, timedOut })
        })
        p.on('close', (code) => {
          clearTimeout(t)
          resolve({ code: code ?? 1, stdout: out, stderr: err, timedOut })
        })
      }),
    // Sentry 조회 — GET 만(메서드 인자를 받지 않는다). Link 헤더(페이지 이동)도 돌려준다
    fetchPage: async (url, token) => {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) throw new Error(`Sentry API ${res.status}`)
      return { body: await res.json(), link: res.headers.get('link') }
    },
    fetchJson: async (url, token) => (await deps.fetchPage(url, token)).body,
    // Sentry 이슈 노트 쓰기 — 이 호출이 Sentry 쓰기의 유일한 경로
    addComment: async (issueId, text) => {
      const env = parseEnvFile(cfg.envFile) ?? {}
      const org = encodeURIComponent(env.SENTRY_ORG ?? 'kaleos')
      const res = await fetch(
        `https://sentry.io/api/0/organizations/${org}/issues/${encodeURIComponent(issueId)}/comments/`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.SENTRY_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text }),
          signal: AbortSignal.timeout(10_000),
        }
      )
      if (!res.ok) throw new Error(`Sentry API ${res.status}`)
    },
    slack: async (text) => {
      if (noSlack) return void console.log(text)
      const r = sh('slack-post', ['--account', 'karls', '--channel', cfg.slackChannel], {
        input: text,
        timeout: 30_000,
      })
      if (r.status !== 0) console.error('slack-post 실패')
    },
    gitleaks: (dir) => gitleaksScan(dir),
    // 호스트에서 git 을 쓰는 곳은 여기뿐 — 컨테이너가 만진 적 없는 새 클론에서만 실행한다
    prepareSource: async ({ repoDir, baseDir, label }) => {
      const run = (args) => {
        const r = sh('git', args, { timeout: 300_000 })
        if (r.status !== 0) throw new Error(`git ${args[0]} 실패`)
        return r.stdout.trim()
      }
      run(['clone', '--quiet', '--depth', '1', '--branch', cfg.baseBranch, cfg.repoUrl, repoDir])
      const baseCommit = run(['-C', repoDir, 'rev-parse', 'HEAD'])
      // 로그 라벨 위치 찾기: 호스트에서 고정 문자열 검색(셸 없음). 줄 본문은 버리고 path·line 만 남긴다
      let labelHits
      if (label) {
        const g = sh('git', [
          '-C',
          repoDir,
          '-c',
          'core.quotePath=false',
          'grep',
          '-z',
          '-n',
          '-F',
          '-e',
          label,
        ])
        labelHits = g.status === 1 ? [] : g.status === 0 ? lib.parseGrepOutput(g.stdout) : null
      }
      fs.mkdirSync(baseDir, { recursive: true })
      const ar = sh(
        'sh',
        ['-c', 'git -C "$1" archive HEAD | tar -x -C "$2"', 'sh', repoDir, baseDir],
        {
          timeout: 300_000,
        }
      )
      if (ar.status !== 0) throw new Error('git archive 실패')
      const corpus = loadCorpus(baseDir)
      return { baseCommit, grep: (w) => corpus.includes(w), labelHits }
    },
    copyDir: (src, dst) => {
      if (sh('cp', ['-cR', src, dst], { timeout: 300_000 }).status !== 0) {
        fs.rmSync(dst, { recursive: true, force: true }) // 부분 복사 흔적(우리가 만든 목적지)
        if (sh('cp', ['-R', src, dst], { timeout: 300_000 }).status !== 0) {
          throw new Error('디렉터리 복사 실패')
        }
      }
    },
  }
  return deps
}

// ---------- 보조 ----------
const pad = (n) => String(n).padStart(2, '0')
export function makeRunId(now) {
  const d = new Date(now)
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}-${crypto.randomBytes(2).toString('hex')}`
}

export function parseArgs(argv) {
  const out = { issue: null, fixture: null, noSlack: false, noWrite: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--no-slack') out.noSlack = true
    else if (a === '--no-write') out.noWrite = true
    else if (a === '--issue' && argv[i + 1]) out.issue = argv[++i]
    else if (a === '--fixture' && argv[i + 1]) out.fixture = argv[++i]
    else throw new Error(`알 수 없는 인자: ${a}`)
  }
  return out
}

export function parseEnvFile(file) {
  const text = readSafe(file, 16384)
  if (text === null) return null
  return Object.fromEntries(
    text
      .split('\n')
      .map((l) =>
        l
          .trim()
          .replace(/^export\s+/, '')
          .match(/^([A-Z_]+)=(.*)$/)
      )
      .filter(Boolean)
      .map((m) => [m[1], m[2].replace(/^['"]|['"]$/g, '')])
  )
}

function readAuth(cfg) {
  const text = readSafe(path.join(cfg.codexDir, 'auth.json'), 65536)
  if (text === null) return null
  try {
    const a = JSON.parse(text)
    return a?.tokens?.account_id ? a : null
  } catch {
    return null
  }
}

const writeJsonAtomic = (file, obj) => {
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 })
  fs.renameSync(tmp, file)
}

// 선정 결과 기록(제목·메시지 없이 shortId·상태·사유 코드만). 기록 실패는 run 을 막지 않는다
function writeSelection(cfg, runId, results, triage = new Map()) {
  try {
    const dir = path.join(cfg.stateDir, 'runs', runId)
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    writeJsonAtomic(
      path.join(dir, 'selection.json'),
      results.map((r) => ({
        shortId: r.shortId,
        status: r.status,
        reason: r.reasons?.[0] ?? null,
        ...triage.get(r.shortId),
      }))
    )
  } catch {}
}

// 공용 장애로 run 전체를 멈춘다(그 이슈의 실패로 기록하지 않는다)
class AbortRun extends Error {}

const NO_SIG_WARN = '서명 키 없음 — ready 메모 생략'
const AUTH_WARN_72H = 'access token 만료 72시간 이내 — 재로그인 예정'
const authExpSec = (cfg) => {
  const a = readAuth(cfg)
  return a ? lib.jwtExp(a.tokens.access_token) : null
}

// ---------- 사전 점검 ----------
export async function preflight(cfg, deps) {
  const problems = []
  const warnings = []
  const info = await deps.docker(['info', '--format', '{{.ServerVersion}}'], { timeoutMs: 20_000 })
  if (info.code !== 0) problems.push('docker 사용 불가(OrbStack 꺼짐?)')
  else {
    for (const img of [cfg.codexImage, cfg.proxyImage]) {
      if ((await deps.docker(['image', 'inspect', img, '--format', '{{.Id}}'])).code !== 0)
        problems.push(`이미지 없음: ${img}`)
    }
    // 망 생성은 우리 이름만 — 이미 있으면 그대로 쓴다
    for (const [net, internal] of [
      [cfg.extNet, false],
      [cfg.intNet, true],
    ]) {
      const ins = await deps.docker(['network', 'inspect', '--format', '{{.Internal}}', net])
      if (ins.code !== 0) {
        const c = await deps.docker(['network', 'create', ...(internal ? ['--internal'] : []), net])
        if (c.code !== 0) problems.push(`망 생성 실패: ${net}`)
      } else if (internal && ins.stdout.trim() !== 'true') {
        problems.push(`내부망이 Internal 이 아님: ${net}`)
      }
    }
  }
  if (deps.gitleaks.available === false) problems.push('gitleaks 없음')
  if (deps.freeBytes() < cfg.minFreeBytes) problems.push('디스크 여유 공간 부족')
  const auth = readAuth(cfg)
  if (!auth) problems.push('전용 Codex 로그인 없음(autofix-codex/auth.json)')
  else if (auth.auth_mode !== 'chatgpt' || (auth.OPENAI_API_KEY ?? null) !== null) {
    problems.push('Codex 로그인이 ChatGPT 모드가 아니거나 API 키가 있음')
  } else {
    const exp = lib.jwtExp(auth.tokens.access_token)
    const hours = exp === null ? null : (exp * 1000 - deps.now()) / 3_600_000
    if (hours === null) problems.push('access token 만료 시각 확인 불가')
    // 만료 임박(authMinHours 미만) 판정은 runDaily 에서 갱신을 시도한 뒤에 한다
    else if (hours < cfg.authWarnHours) warnings.push(AUTH_WARN_72H)
  }
  return { problems, warnings }
}

// ---------- lock (원자적 link, 최대 4시간) ----------
export function acquireLock(stateDir, { maxMs = 4 * 60 * MIN, now = Date.now() } = {}) {
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  const file = path.join(stateDir, 'lock')
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ pid: process.pid, at: now }))
  try {
    for (let i = 0; i < 2; i++) {
      try {
        fs.linkSync(tmp, file) // 이미 있으면 EEXIST — 원자적
        return { release: () => fs.rmSync(file, { force: true }), stale: i > 0 }
      } catch (e) {
        if (e.code !== 'EEXIST') throw e
        let holder = null
        try {
          holder = JSON.parse(fs.readFileSync(file, 'utf8'))
        } catch {}
        let alive = false
        if (holder?.pid) {
          try {
            process.kill(holder.pid, 0)
            alive = true
          } catch (err) {
            alive = err.code === 'EPERM'
          }
        }
        if (alive && now - (holder.at ?? 0) < maxMs) return null
        fs.rmSync(file, { force: true }) // 죽은 pid·4시간 넘은 lock 회수
      }
    }
    return null
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}

// ---------- 컨테이너 단계 ----------
const stateTagOf = (cfg) => lib.sha256(cfg.stateDir).slice(0, 8)

// 비밀값 env 파일(0600)을 만들어 fn 에 경로를 주고, 끝나면(컨테이너 시작 뒤) 삭제한다
async function withSecretEnv(cfg, secrets, fn) {
  if (!secrets) return fn(undefined)
  const dir = path.join(cfg.stateDir, 'envtmp')
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = path.join(dir, crypto.randomBytes(8).toString('hex'))
  fs.writeFileSync(
    file,
    Object.entries(secrets)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') + '\n',
    { mode: 0o600 }
  )
  try {
    return await fn(file)
  } finally {
    fs.rmSync(file, { force: true })
  }
}

function makeStepRunner({ cfg, deps, runId, deadline, issueDir, safeId }) {
  const run = async (step, opts) => {
    const timeoutMs = Math.min(opts.limitMs, deadline - deps.now())
    if (timeoutMs <= 0) throw new Error('deadline')
    const name = `workdeck-autofix-${runId}-${safeId}-${step}`.slice(0, 120)
    const { secretEnv, ...rest } = opts
    const r = await withSecretEnv(cfg, secretEnv, (envFile) =>
      deps.docker(
        buildRunArgs({
          name,
          runId,
          net: 'none',
          memory: '2g',
          cpus: 2,
          stateTag: stateTagOf(cfg),
          envFile,
          ...rest,
        }),
        { timeoutMs, name }
      )
    )
    fs.mkdirSync(path.join(issueDir, 'logs'), { recursive: true })
    fs.writeFileSync(
      path.join(issueDir, 'logs', `${step}.log`),
      `exit=${r.code} timedOut=${r.timedOut}\n${r.stderr ?? ''}\n${r.stdout ?? ''}`
    )
    return r
  }
  return { run }
}

// 커스텀 provider: 컨테이너에는 토큰이 없고 프록시가 인증을 붙인다. 서버 실행 도구(web search)는 끈다
const codexCmd = (cwd, outFile) =>
  [
    'exec codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --ephemeral',
    '-m "$MODEL"',
    `-c 'model_provider="rp"'`,
    `-c 'model_providers.rp.name="rp"'`,
    `-c "model_providers.rp.base_url=\\"$PROXY_URL\\""`,
    `-c 'model_providers.rp.wire_api="responses"'`,
    `-c 'model_providers.rp.requires_openai_auth=false'`,
    `-c 'model_providers.rp.env_http_headers={ "x-autofix-secret" = "AUTOFIX_SECRET" }'`,
    `-c 'web_search="disabled"'`,
    `-C ${cwd} -o ${outFile} -`,
  ].join(' ')
const codexHome = '/codex-home:rw,nosuid,size=64m,uid=1000,gid=1000,mode=700'

const FIX_LIMIT = 25 * MIN
const REVIEW_LIMIT = 10 * MIN

function promptText(name) {
  return fs.readFileSync(path.join(HERE, 'prompts', name), 'utf8')
}

// 검증에서 호스트가 고정 인자로 실행하는 명령
export function verifySteps(files) {
  const lintable = files
    .filter((f) => f.status !== 'deleted' && /\.(?:[cm]?[jt]sx?)$/.test(f.path))
    .map((f) => f.path)
  const steps = []
  if (lintable.length)
    steps.push([
      'eslint',
      ['node', 'node_modules/eslint/bin/eslint.js', '--no-warn-ignored', '--', ...lintable],
    ])
  steps.push([
    'tsc',
    ['node', '--max-old-space-size=6144', 'node_modules/typescript/bin/tsc', '--noEmit'],
  ])
  // 관련 테스트 개수는 별도 --listTests 실행의 결과 파일로 판정한다(컨테이너 출력 파싱 안 함)
  if (lintable.length) {
    steps.push([
      'jest-list',
      [
        'node',
        'node_modules/jest/bin/jest.js',
        '--ci',
        '--listTests',
        '--findRelatedTests',
        '--',
        ...lintable,
      ],
    ])
    // 통과 판정은 종료 코드가 아니라 결과 JSON(numPassedTests≥1·실패 0)으로 한다
    steps.push([
      'jest',
      [
        'node',
        'node_modules/jest/bin/jest.js',
        '--ci',
        '--findRelatedTests',
        '--json',
        '--outputFile=/vout/jest.json',
        '--',
        ...lintable,
      ],
    ])
  }
  return steps
}

// 인증 프록시: 전용 auth.json 을 읽기 전용 파일로 이 컨테이너에만 마운트한다
async function startProxy({ cfg, deps, runId, secret, tag = '' }) {
  const name = `workdeck-autofix-proxy-${runId}${tag}`
  const r0 = await withSecretEnv(cfg, { PROXY_SECRET: secret }, (envFile) =>
    deps.docker(
      buildRunArgs({
        name,
        runId,
        net: cfg.intNet,
        image: cfg.proxyImage,
        memory: '256m',
        cpus: 1,
        detach: true,
        keepLogs: true,
        mounts: [{ host: path.join(cfg.codexDir, 'auth.json'), ctr: '/auth/auth.json', ro: true }],
        env: { PROXY_MODEL: cfg.model, PROXY_MAX_REQUESTS: String(cfg.proxyMaxRequests) },
        stateTag: stateTagOf(cfg),
        envFile,
      })
    )
  )
  if (r0.code !== 0) throw new AbortRun('proxy-start-failed')
  if ((await deps.docker(['network', 'connect', cfg.extNet, name])).code !== 0) {
    await deps.docker(['kill', name])
    throw new AbortRun('proxy-connect-failed')
  }
  for (let i = 0; i < 15; i++) {
    if ((await deps.docker(['logs', '--tail', '20', name])).stdout.includes('listening'))
      return name
    await deps.sleep(1000)
  }
  await deps.docker(['kill', name])
  throw new AbortRun('proxy-not-ready')
}

// 이 run 의 컨테이너만 이름으로 kill (전역 prune·이름 없는 삭제 금지)
export async function killRun(deps, runId) {
  const ps = await deps.docker([
    'ps',
    '--filter',
    `label=workdeck.autofix=${runId}`,
    '--format',
    '{{.Names}}',
  ])
  for (const name of ps.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('workdeck-autofix-'))) {
    await deps.docker(['kill', name])
  }
}

// 라벨 workdeck.autofix 이면서 이름이 workdeck-autofix- 로 시작하는 이전 run 의 잔재만 이름으로 kill
async function killResidue(cfg, deps) {
  const ps = await deps.docker([
    'ps',
    '-a',
    '--filter',
    `label=workdeck.autofix.state=${stateTagOf(cfg)}`,
    '--format',
    '{{.Names}}',
  ])
  for (const name of ps.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('workdeck-autofix-'))) {
    await deps.docker(['kill', name])
  }
}

// 컨테이너가 만진 디렉터리는 호스트가 지우지 않는다(chmod 000·깊은 중첩에서 rmSync 가 멈출 수 있음).
// 망 없는 컨테이너에서 시간 제한을 두고 정리한다. logs 는 남긴다. 성공 여부 반환
let cleanSeq = 0
async function cleanDir({ cfg, deps, runId, dir }) {
  try {
    const name = `workdeck-autofix-${runId}-clean-${++cleanSeq}`
    const r = await deps.docker(
      buildRunArgs({
        name,
        runId,
        net: 'none',
        image: cfg.codexImage,
        memory: '512m',
        cpus: 1,
        stateTag: stateTagOf(cfg),
        mounts: [{ host: dir, ctr: '/w' }],
        cmd: [
          'sh',
          '-c',
          'chmod -R u+rwX /w 2>/dev/null; find /w -mindepth 1 -maxdepth 1 ! -name logs -exec rm -rf {} +',
        ],
      }),
      { timeoutMs: 180_000, name }
    )
    return r.code === 0
  } catch {
    return false
  }
}

const baseRel = (baseDir) =>
  fs.readdirSync(baseDir, { recursive: true }).map((p) => String(p).split(path.sep).join('/'))

// ---------- 이슈 1건 처리 ----------
export async function processIssue({ cfg, deps, runId, deadline, issue, event }) {
  const facts = lib.extractFacts(issue, event)
  const res = {
    shortId: facts.shortId,
    type: facts.type,
    route: facts.route,
    status: 'failed',
    reasons: [],
  }
  if (!/^[A-Za-z0-9-]{3,40}$/.test(facts.shortId)) return { ...res, reasons: ['bad-shortid'] }
  const cls = lib.classifyEvent(issue, event)
  if (!cls.usable && !cls.label) return { ...res, status: 'insufficient', reasons: [cls.reason] }
  let locator = null

  const safeId = facts.shortId
  const issueDir = path.join(cfg.stateDir, 'runs', runId, safeId)
  const d = Object.fromEntries(
    ['repo', 'base', 'inst', 'nm', 'fix', 'fixnm', 'ctx'].map((k) => [k, path.join(issueDir, k)])
  )
  fs.mkdirSync(issueDir, { recursive: true, mode: 0o700 })
  for (const k of ['nm', 'fixnm', 'ctx']) fs.mkdirSync(d[k])
  const steps = makeStepRunner({ cfg, deps, runId, deadline, issueDir, safeId })
  const auth = readAuth(cfg)
  // 컨테이너에는 토큰이 없지만 호스트 검사는 이중 안전장치로 auth.json 의 모든 문자열 값을 대조한다
  const windows = lib.tokenWindows(auth ? [auth] : [])
  let proxy = null
  let abort = null
  let cleanupFailed = false
  const work = {}
  let out
  try {
    out = await (async () => {
      const prep = await deps.prepareSource({ repoDir: d.repo, baseDir: d.base, label: cls.label })
      if (!cls.usable) {
        const j = lib.judgeLabelHits(prep.labelHits)
        if (j.reason) return { ...res, status: 'insufficient', reasons: [j.reason] }
        locator = j.locator
        res.locator = true
      }
      const rels = baseRel(d.base)
      const baseLower = new Set(rels.map((p) => p.toLowerCase()))
      // .env 류 파일이 export 에 있으면 중단(예시 파일 제외)
      if (rels.some((f) => /(^|\/)\.env/.test(f) && !/\.(example|sample|template)$/.test(f)))
        return { ...res, reasons: ['env-file-in-export'] }
      deps.copyDir(d.base, d.inst)
      // 읽기 전용 /w 에는 docker 가 마운트 지점을 못 만든다 — node_modules 지점을 미리 만든다
      fs.mkdirSync(path.join(d.inst, 'node_modules'), { recursive: true })

      const mountsInst = (ro) => [
        { host: d.inst, ctr: '/w', ro },
        { host: d.nm, ctr: '/w/node_modules' },
      ]
      // 1) 설치(외부망, 비밀값 없음, 스크립트 미실행). 공용 장애는 run 중단
      let r = await steps.run('install', {
        net: cfg.extNet,
        image: cfg.codexImage,
        memory: '4g',
        cpus: 4,
        limitMs: 10 * MIN,
        workdir: '/w',
        mounts: mountsInst(false),
        env: { HOME: '/tmp', npm_config_cache: '/tmp/npm-cache' },
        cmd: ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'],
      })
      if (r.code !== 0) throw new AbortRun('install-failed')
      // 2) patch-package(망 없음, 실패 시 중단)
      r = await steps.run('patchpkg', {
        image: cfg.codexImage,
        limitMs: 5 * MIN,
        workdir: '/w',
        mounts: mountsInst(true),
        cmd: ['node', 'node_modules/patch-package/index.js', '--error-on-fail'],
      })
      if (r.code !== 0) throw new AbortRun('patch-package-failed')

      // 3) 수정 작업본(.git 없는 export 복사 + node_modules 복사)
      deps.copyDir(d.base, d.fix)
      fs.rmSync(d.fixnm, { recursive: true }) // 방금 만든 빈 디렉터리
      deps.copyDir(d.nm, d.fixnm)
      fs.writeFileSync(path.join(d.ctx, 'review-prompt.md'), promptText('review.md'))
      // run 마다 임의 비밀값: 프록시와 codex 는 env 파일로만 받고, 프록시는 헤더 불일치를 403 으로 거부한다
      const secret = crypto.randomBytes(32).toString('hex')
      proxy = await startProxy({ cfg, deps, runId, secret })
      const proxyUrl = `http://${proxy}:8080/v1`
      const codexEnv = {
        CODEX_HOME: '/codex-home',
        HOME: '/tmp',
        MODEL: cfg.model,
        PROXY_URL: proxyUrl,
      }

      let feedback = []
      for (let attempt = 1; attempt <= cfg.maxRetryFix; attempt++) {
        // 시도마다 결과를 초기화한다(이전 시도의 verify/review 가 남지 않게)
        for (const k of [
          'verify',
          'review',
          'patch',
          'patchBuf',
          'patchSha',
          'analysis',
          'parsed',
          'chk',
        ])
          delete work[k]
        delete res.verify
        delete res.review
        for (const k of ['files', 'lines', 'testsTouched', 'pending']) delete res[k]
        res.status = 'failed'
        res.reasons = []
        // 컨테이너가 쓰는 디렉터리는 시도마다 새로 만든다(지우지 않으므로 chmod 000 등에 막히지 않음)
        const A = path.join(issueDir, `a${attempt}`)
        const dirs = Object.fromEntries(
          ['out', 'pout', 'pin', 'rev', 'rout'].map((k) => [k, path.join(A, k)])
        )
        fs.mkdirSync(A)
        for (const k of Object.keys(dirs)) fs.mkdirSync(dirs[k])
        const context = locator
          ? lib.buildLocatorContext(
              { shortId: facts.shortId, label: cls.label, ...locator, type: facts.type },
              feedback
            )
          : lib.buildContext(facts, feedback)
        fs.writeFileSync(path.join(d.ctx, 'context.md'), context)
        fs.writeFileSync(path.join(d.ctx, 'prompt.md'), `${promptText('fix.md')}\n\n${context}`)

        // 4) 수정(내부망, 프록시만 도달). codex 자체 샌드박스는 컨테이너 안에서 못 쓰므로 우회 플래그를 쓴다
        r = await steps.run(`fix${attempt}`, {
          net: cfg.intNet,
          image: cfg.codexImage,
          memory: '8g',
          cpus: 4,
          limitMs: FIX_LIMIT,
          workdir: '/work/repo',
          mounts: [
            { host: d.fix, ctr: '/work/repo' },
            { host: d.fixnm, ctr: '/work/repo/node_modules' },
            { host: d.ctx, ctr: '/ctx', ro: true },
            { host: dirs.out, ctr: '/out' },
          ],
          tmpfs: [codexHome],
          env: { ...codexEnv, NODE_OPTIONS: '--max-old-space-size=6144' },
          secretEnv: { AUTOFIX_SECRET: secret },
          cmd: ['sh', '-c', `${codexCmd('/work/repo', '/out/last-message.txt')} < /ctx/prompt.md`],
        })
        if (r.code !== 0) {
          await checkProxyHealth(deps, proxy)
          return { ...res, reasons: [r.timedOut ? 'fix-timeout' : 'fix-failed'] }
        }

        // 5) patch 생성(망 없음, 별도 컨테이너) — pristine export 대 수정본
        r = await steps.run(`patch${attempt}`, {
          image: cfg.codexImage,
          limitMs: 5 * MIN,
          mounts: [
            { host: d.base, ctr: '/base', ro: true },
            { host: d.fix, ctr: '/fix', ro: true },
            { host: dirs.pout, ctr: '/out' },
          ],
          env: { HOME: '/tmp', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
          cmd: [
            'sh',
            '-c',
            [
              'set -eu',
              'mkdir /tmp/g',
              'cp -a /base/. /tmp/g/',
              'cd /tmp/g',
              'git init -q',
              'git add -A',
              'git -c user.name=a -c user.email=a@a.a commit -q -m base',
              'git -c safe.directory="*" --git-dir=/tmp/g/.git --work-tree=/fix add -A',
              'git -c safe.directory="*" --git-dir=/tmp/g/.git diff --cached --binary --no-renames --no-color HEAD > /out/patch.diff',
            ].join('\n'),
          ],
        })
        if (r.code !== 0) return { ...res, reasons: ['patch-gen-failed'] }

        // 바이트로 읽어 fatal UTF-8 디코드. 이후 검증·리뷰·pending 은 모두 이 한 벌의 바이트를 쓴다
        const patchBuf = readSafeBuf(path.join(dirs.pout, 'patch.diff'), 2 * 1024 * 1024)
        const analysisBuf = readSafeBuf(path.join(dirs.out, 'analysis.md'), 64 * 1024)
        if (patchBuf === null)
          return { ...res, status: 'blocked', reasons: ['patch-unsafe-or-too-large'] }
        const patch = decodeUtf8(patchBuf)
        const analysis = analysisBuf === null ? null : decodeUtf8(analysisBuf)
        Object.assign(work, {
          patchBuf,
          patch: patch ?? '',
          patchSha: lib.sha256(patchBuf),
          analysis: analysis ?? '',
        })
        const reasons = []
        if (patch === null) reasons.push('patch-invalid-utf8')
        if (analysisBuf === null) reasons.push('analysis-missing-or-unsafe')
        else if (analysis === null) reasons.push('analysis-invalid-utf8')
        const parsed = lib.parsePatch(patch ?? '')
        const chk = lib.checkPatch(parsed, { baseLower, patchText: patch ?? '' })
        reasons.push(...chk.reasons)
        for (const x of lib.checkText(analysis ?? '', { analysis: true }))
          reasons.push(`analysis-${x}`)
        Object.assign(res, {
          files: parsed.files.map((f) => f.path),
          lines: parsed.lineCount,
          testsTouched: chk.touchedTests.length > 0,
        })
        Object.assign(work, { parsed, chk })
        reasons.push(
          ...(await scanTexts({
            deps,
            issueDir,
            windows,
            facts,
            grep: prep.grep,
            texts: { 'patch.diff': patch ?? '', 'analysis.md': analysis ?? '' },
            files: parsed.files.map((f) => f.path).filter((f) => inBase(d.base, f)),
          }))
        )
        if (reasons.length) {
          res.status = reasons.some((x) => x.startsWith('token-leak')) ? 'quarantined' : 'blocked'
          res.reasons = reasons
          break
        }

        // 6) 독립 검증 — 새 export + patch(같은 바이트), 망 없음, 토큰 없음. 판정은 종료 코드·결과 파일
        fs.writeFileSync(path.join(dirs.pin, 'patch.diff'), patchBuf)
        sameBytes(path.join(dirs.pin, 'patch.diff'), work.patchSha)
        const verify = {}
        for (const [k, cmd] of verifySteps(parsed.files)) {
          if (k === 'jest' && verify['jest-list'] === 0 && verify.testCount === 0) {
            verify.jest = 'no-tests'
            continue
          }
          if (k === 'jest' && verify['jest-list'] !== 0) continue
          const needOut = k === 'jest-list' || k === 'jest'
          const vdir = path.join(A, `verify-${k}`)
          const vout = path.join(A, `vout-${k}`)
          deps.copyDir(d.base, vdir)
          fs.mkdirSync(vout)
          const vr = await steps.run(`verify-${k}`, {
            image: cfg.codexImage,
            memory: '8g',
            cpus: 4,
            limitMs: 10 * MIN,
            workdir: '/w',
            mounts: [
              { host: vdir, ctr: '/w' },
              { host: d.nm, ctr: '/w/node_modules', ro: true },
              { host: dirs.pin, ctr: '/patch', ro: true },
              ...(needOut ? [{ host: vout, ctr: '/vout' }] : []),
            ],
            env: {
              HOME: '/tmp',
              CI: '1',
              NODE_OPTIONS: '--max-old-space-size=6144',
              GIT_CONFIG_GLOBAL: '/dev/null',
            },
            cmd: [
              'sh',
              '-c',
              k === 'jest-list'
                ? 'git apply /patch/patch.diff && exec "$@" > /vout/tests.txt'
                : 'git apply /patch/patch.diff && exec "$@"',
              'sh',
              ...cmd,
            ],
          })
          verify[k] = vr.code
          if (k === 'jest-list' && vr.code === 0) {
            const listed = readSafe(path.join(vout, 'tests.txt'), 64 * 1024)
            if (listed === null) verify[k] = 1
            else verify.testCount = listed.split('\n').filter((l) => l.startsWith('/w/')).length
          }
          if (k === 'jest' && vr.code === 0) {
            // 결과 파일이 없거나 통과 0개·실패 있으면 실패
            let j = null
            try {
              j = JSON.parse(readSafe(path.join(vout, 'jest.json'), 5 * 1024 * 1024))
            } catch {}
            verify.jestPassed = j?.numPassedTests ?? 0
            if (!(j && j.numPassedTests >= 1 && j.numFailedTests === 0 && j.success === true))
              verify.jest = 1
          }
        }
        verify.ok = Object.entries(verify).every(
          ([k, v]) =>
            k === 'testCount' || k === 'jestPassed' || k === 'ok' || v === 0 || v === 'no-tests'
        )
        work.verify = verify
        res.verify = {
          ok: verify.ok,
          noTests: verify.jest === 'no-tests',
          notRun: ['eslint', 'jest'].filter((k) => verify[k] === undefined),
        }
        if (!verify.ok) {
          res.status = 'blocked'
          res.reasons = ['verify-failed']
          break
        }

        // 7) 리뷰 — 새 컨테이너·새 세션(repo 없음), JSON 스키마 검사, 파싱 실패 = blocking
        fs.writeFileSync(path.join(dirs.rev, 'patch.diff'), patchBuf)
        sameBytes(path.join(dirs.rev, 'patch.diff'), work.patchSha)
        fs.copyFileSync(path.join(d.ctx, 'context.md'), path.join(dirs.rev, 'context.md'))
        fs.copyFileSync(path.join(d.ctx, 'review-prompt.md'), path.join(dirs.rev, 'prompt.md'))
        r = await steps.run(`review${attempt}`, {
          net: cfg.intNet,
          image: cfg.codexImage,
          limitMs: REVIEW_LIMIT,
          workdir: '/review',
          mounts: [
            { host: dirs.rev, ctr: '/review', ro: true },
            { host: dirs.rout, ctr: '/out' },
          ],
          tmpfs: [codexHome],
          env: codexEnv,
          secretEnv: { AUTOFIX_SECRET: secret },
          cmd: ['sh', '-c', `${codexCmd('/review', '/out/review.json')} < /review/prompt.md`],
        })
        if (r.code !== 0) await checkProxyHealth(deps, proxy)
        const review =
          r.code === 0
            ? lib.parseReview(readSafe(path.join(dirs.rout, 'review.json'), 64 * 1024) ?? '')
            : { ok: false, verdict: 'needs-attention', blocking: ['review-run-failed'] }
        work.review = review
        res.review = review.verdict
        if (review.blocking.length === 0) {
          res.status = 'ready'
          res.reasons = []
          break
        }
        feedback = review.blocking
        res.status = 'blocked'
        res.reasons = ['review-blocking']
      }

      if (work.patch !== undefined)
        await finalize({
          cfg,
          deps,
          runId,
          issueDir,
          windows,
          facts,
          prep,
          res,
          work,
          issue,
          baseDir: d.base,
        })
      return res
    })()
  } catch (e) {
    if (e instanceof AbortRun) {
      abort = e
      e.shortId = facts.shortId // 공용 장애도 그 이슈의 실패 횟수에 센다
    }
    out = {
      ...res,
      status: 'failed',
      // 예외 메시지는 Slack·manifest 에 싣지 않고 호스트 로컬 로그에만 남긴다
      reasons: [e.message === 'deadline' ? 'deadline' : 'error:exception'],
    }
    try {
      fs.mkdirSync(path.join(issueDir, 'logs'), { recursive: true })
      fs.writeFileSync(path.join(issueDir, 'logs', 'error.txt'), String(e.stack ?? e.message))
    } catch {}
  } finally {
    if (proxy) {
      // 프록시 로그(요청·상태·도구 종류만, 본문 없음)를 보존하고 이름으로 kill
      try {
        const l = await deps.docker(['logs', '--tail', '300', proxy])
        fs.mkdirSync(path.join(issueDir, 'logs'), { recursive: true })
        fs.writeFileSync(path.join(issueDir, 'logs', 'proxy.log'), `${l.stdout}\n${l.stderr}`)
      } catch {}
      await deps.docker(['kill', proxy])
    }
    // 작업 export 는 컨테이너에서 정리(호스트 rmSync 금지). 실패해도 결과·pending 기록은 계속된다
    if (!(await cleanDir({ cfg, deps, runId, dir: issueDir }))) {
      cleanupFailed = true
      try {
        fs.writeFileSync(path.join(cfg.stateDir, 'cleanup-failed.txt'), `${issueDir}\n`, {
          flag: 'a',
        })
      } catch {}
    }
  }
  if (abort) throw abort
  if (cleanupFailed) out.cleanupFailed = true
  // patch 없이 끝난 실패도 상태·사유만 담은 기록을 남겨 매일 재시도로 사용량을 태우지 않게 한다
  if (!out.pending && out.reasons.some((r) => RECORD_REASONS.has(r)))
    writeStatusRecord({ cfg, deps, runId, out, issue })
  return out
}

// 공용 장애(업스트림 401/403/429/5xx·upstream 오류·프록시 사라짐)는 이슈 탓이 아니므로 run 중단.
// 우리 쪽 request-cap(DENY ... request-cap)은 이슈 실패로 남긴다
async function checkProxyHealth(deps, proxy) {
  const alive = await deps.docker(['inspect', '--format', '{{.State.Running}}', proxy])
  if (alive.code !== 0 || alive.stdout.trim() !== 'true') throw new AbortRun('proxy-gone')
  const l = await deps.docker(['logs', '--tail', '300', proxy])
  if (
    /^(?:POST|GET) \/v1\/\S+ (?:401|403|429|5\d\d) /m.test(l.stdout) ||
    /^DENY .* upstream:/m.test(l.stdout)
  )
    throw new AbortRun('upstream-failed')
}

// 읽어 다시 해시해 같은 바이트인지 확인(검증·리뷰 입력)
function sameBytes(file, sha) {
  if (lib.sha256(fs.readFileSync(file)) !== sha) throw new Error('patch-bytes-changed')
}

const RECORD_REASONS = new Set([
  'fix-failed',
  'fix-timeout',
  'patch-gen-failed',
  'env-file-in-export',
  'patch-unsafe-or-too-large',
])

function writeStatusRecord({ cfg, deps, runId, out, issue }) {
  const dir = path.join(cfg.stateDir, 'pending', `${runId}-${out.shortId}`)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const manifest = {
    runId,
    shortId: out.shortId,
    status: out.status,
    reasons: out.reasons,
    createdAt: new Date(deps.now()).toISOString(),
    sentryIssueId: String(issue?.id ?? ''),
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), {
    mode: 0o400,
  })
  fs.chmodSync(dir, 0o500)
  out.pending = dir
}

// base export 에 이미 있던 일반 파일인지(새 파일 이름은 조각 검사 허용 목록에서 제외)
function inBase(baseDir, f) {
  try {
    return fs.lstatSync(path.join(baseDir, f)).isFile()
  } catch {
    return false
  }
}

// 텍스트들을 토큰 조각·원문 조각·gitleaks 로 검사 → 사유 목록
async function scanTexts({ deps, issueDir, windows, facts, grep, texts, files = [] }) {
  const reasons = []
  const raws = [...facts.rawMessages, facts.message]
  // 템플릿으로 어차피 공개되는 값(예외 타입·shortId·경로·프레임·base 에 있던 변경 파일)은 조각 검사에서 제외
  const allowed = [
    ...files,
    facts.type,
    facts.shortId,
    facts.route,
    ...facts.frames.flatMap((f) => [f.file, f.fn]),
  ]
  const known = (w) => allowed.some((a) => a.includes(w)) || grep(w)
  const scanDir = path.join(issueDir, `scan-${crypto.randomBytes(3).toString('hex')}`)
  fs.mkdirSync(scanDir, { mode: 0o700 }) // 새 빈 디렉터리(이미 있으면 예외)
  for (const [name, text] of Object.entries(texts)) {
    if (lib.hasTokenLeak(text, windows)) reasons.push(`token-leak:${name}`)
    if (lib.findFragments([text], raws, known).length) reasons.push(`source-fragment:${name}`)
    fs.writeFileSync(path.join(scanDir, name), text)
  }
  const g = deps.gitleaks(scanDir)
  if (g === 1) reasons.push('gitleaks-found')
  else if (g !== 0) reasons.push('gitleaks-error')
  fs.rmSync(scanDir, { recursive: true, force: true }) // 호스트가 만든 파일만 든 디렉터리
  return reasons
}

// pending 에 읽기 전용으로 기록(manifest 포함). 토큰 조각 검출 시 격리 디렉터리에 둔다
async function finalize({
  cfg,
  deps,
  runId,
  issueDir,
  windows,
  facts,
  prep,
  res,
  work,
  issue,
  baseDir,
}) {
  const files = res.files ?? []
  const title = lib.buildPrTitle(facts)
  const body = lib.buildPrBody({
    facts,
    analysis: work.analysis,
    verify: work.verify,
    reviewVerdict: work.review?.verdict ?? '미실행',
    files,
    touchedTests: work.chk?.touchedTests ?? [],
    touchedConfigs: work.chk?.touchedConfigs ?? [],
  })
  const extra = await scanTexts({
    deps,
    issueDir,
    windows,
    facts,
    grep: prep.grep,
    texts: { 'pr-title.txt': title, 'pr-body.md': body },
    files: files.filter((f) => inBase(baseDir, f)),
  })
  // auth 이상·누수가 시도 도중 생겼다면 res 에 이미 반영돼 있다
  if (extra.length) {
    res.reasons = [...new Set([...res.reasons, ...extra])]
    if (res.status === 'ready')
      res.status = extra.some((x) => x.startsWith('token-leak')) ? 'quarantined' : 'blocked'
    else if (extra.some((x) => x.startsWith('token-leak'))) res.status = 'quarantined'
  }
  const id = `${runId}-${facts.shortId}`
  const dir = path.join(cfg.stateDir, 'pending', id)
  const target = res.status === 'quarantined' ? path.join(dir, 'quarantine') : dir
  fs.mkdirSync(target, { recursive: true, mode: 0o700 })
  const content = {
    'patch.diff': work.patchBuf, // 검증·리뷰에 쓴 것과 같은 바이트
    'pr-title.txt': title,
    'pr-body.md': body,
    'analysis.md': work.analysis ?? '',
    'verify.json': JSON.stringify(work.verify ?? null, null, 2),
  }
  const manifest = {
    runId,
    shortId: facts.shortId,
    status: res.status,
    reasons: res.reasons,
    baseCommit: prep.baseCommit,
    createdAt: new Date(deps.now()).toISOString(),
    testsTouched: work.chk?.touchedTests ?? [],
    configsTouched: work.chk?.touchedConfigs ?? [],
    review: work.review ?? null,
    sentryIssueId: String(issue?.id ?? ''),
    patchSha256: work.patchSha,
  }
  if (res.status !== 'quarantined') manifest.sha256 = {}
  for (const [name, data] of Object.entries(content)) {
    fs.writeFileSync(path.join(target, name), data, { mode: 0o400 })
    if (manifest.sha256) manifest.sha256[name] = lib.sha256(data)
  }
  if (manifest.sha256 && manifest.sha256['patch.diff'] !== work.patchSha)
    throw new Error('patch-bytes-changed')
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), {
    mode: 0o400,
  })
  fs.chmodSync(target, 0o500)
  res.pending = dir
}

// ---------- AI 판단(triage) ----------
// 45분 같은 시간 한도 + 디스크 감시를 걸고 fn(deadline) 실행. 디스크가 모자라 kill 했으면 diskLow=true
async function watched(cfg, deps, runId, ms, fn) {
  const deadline = deps.now() + ms
  const timer = setTimeout(() => killRun(deps, runId), ms)
  timer.unref?.()
  let diskLow = false
  const baseline = deps.freeBytes()
  const watch = setInterval(() => {
    const free = deps.freeBytes()
    if (free < cfg.diskKillBytes || baseline - free > cfg.diskDropBytes) {
      diskLow = true
      killRun(deps, runId)
    }
  }, cfg.diskPollMs)
  watch.unref?.()
  let value
  try {
    value = await fn(deadline)
  } finally {
    clearTimeout(timer)
    clearInterval(watch)
  }
  return { value, diskLow }
}

// 이슈 전체를 40건 이하 배치로 Codex 에 판단시킨다(수정 단계와 같은 격리: 내부망·인증 프록시·토큰 없음·repo 없음).
// 실패한 배치는 판단 없음(run 은 계속). 반환 Map(shortId → {p,cat,act})
async function runTriage({ cfg, deps, runId, deadline, issues, warnings }) {
  const triage = new Map()
  const inputs = issues
    .filter((i) => /^[A-Za-z0-9-]{3,40}$/.test(i.shortId))
    .map((i) => lib.triageInput(i))
  if (!inputs.length) return triage
  const triageDir = path.join(cfg.stateDir, 'runs', runId, 'triage')
  fs.mkdirSync(triageDir, { recursive: true, mode: 0o700 })
  const steps = makeStepRunner({
    cfg,
    deps,
    runId,
    deadline,
    issueDir: triageDir,
    safeId: 'triage',
  })
  const secret = crypto.randomBytes(32).toString('hex')
  let proxy = null
  try {
    try {
      proxy = await startProxy({ cfg, deps, runId, secret, tag: '-triage' })
    } catch (e) {
      if (!(e instanceof AbortRun)) throw e
      warnings.push(`판단 프록시 기동 실패(${e.message})`)
      return triage
    }
    const codexEnv = {
      CODEX_HOME: '/codex-home',
      HOME: '/tmp',
      MODEL: cfg.model,
      PROXY_URL: `http://${proxy}:8080/v1`,
    }
    fs.writeFileSync(path.join(triageDir, 'prompt.md'), promptText('triage.md'))
    for (let n = 0, b = 1; n < inputs.length; n += lib.TRIAGE_BATCH, b++) {
      const batch = inputs.slice(n, n + lib.TRIAGE_BATCH)
      const A = path.join(triageDir, `b${b}`)
      const dirIn = path.join(A, 'in')
      const dirOut = path.join(A, 'out')
      fs.mkdirSync(dirIn, { recursive: true })
      fs.mkdirSync(dirOut)
      fs.writeFileSync(path.join(dirIn, 'input.json'), JSON.stringify(batch))
      fs.copyFileSync(path.join(triageDir, 'prompt.md'), path.join(dirIn, 'prompt.md'))
      try {
        const r = await steps.run(`triage${b}`, {
          net: cfg.intNet,
          image: cfg.codexImage,
          limitMs: cfg.triageLimitMs,
          workdir: '/in',
          mounts: [
            { host: dirIn, ctr: '/in', ro: true },
            { host: dirOut, ctr: '/out' },
          ],
          tmpfs: [codexHome],
          env: codexEnv,
          secretEnv: { AUTOFIX_SECRET: secret },
          cmd: ['sh', '-c', `${codexCmd('/in', '/out/triage.json')} < /in/prompt.md`],
        })
        if (r.code !== 0) continue
        const text = readSafe(path.join(dirOut, 'triage.json'), 64 * 1024) ?? ''
        for (const [k, v] of lib.parseTriageOutput(
          text,
          batch.map((x) => x.shortId)
        ))
          triage.set(k, v)
      } catch (e) {
        if (e.message === 'deadline') break // 남은 배치는 판단 없음
        throw e
      }
    }
  } finally {
    if (proxy) {
      try {
        const l = await deps.docker(['logs', '--tail', '300', proxy])
        fs.writeFileSync(path.join(triageDir, 'logs', 'proxy.log'), `${l.stdout}\n${l.stderr}`)
      } catch {}
      await deps.docker(['kill', proxy])
    }
    if (!(await cleanDir({ cfg, deps, runId, dir: triageDir }))) warnings.push('정리 실패: triage')
  }
  return triage
}

// ---------- 메인 ----------
export async function runDaily({ argv, cfg, deps }) {
  const args = parseArgs(argv)
  const runId = makeRunId(deps.now())
  const fixture = args.fixture ? JSON.parse(fs.readFileSync(args.fixture, 'utf8')) : null
  const results = []
  const warnings = []
  let triage = new Map()
  let triageCounts
  const report = (extra) =>
    deps.slack(lib.buildSlackSummary({ runId, results, warnings, triage: triageCounts, ...extra }))
  // Sentry 노트 쓰기: 픽스처·--no-write 는 쓰지 않고 로그만. 실패는 Slack 경고로 모아 run 은 계속
  const canWrite = !fixture && !args.noWrite && !cfg.noWrite
  const log = deps.log ?? console.log
  let writeFails = 0
  let writeWarnAt = -1
  const putNote = async (issueId, text) => {
    if (fixture) return
    if (!canWrite) return void log(`[no-write] ${issueId}: ${text}`)
    try {
      await deps.addComment(issueId, text)
    } catch {
      writeFails++
      if (writeWarnAt < 0) writeWarnAt = warnings.push('') - 1
      warnings[writeWarnAt] = `노트 쓰기 실패 ${writeFails}건`
    }
  }

  const pre = await preflight(cfg, deps)
  const problems = [...pre.problems]
  if (!fixture && !parseEnvFile(cfg.envFile)?.SENTRY_API_TOKEN)
    problems.push('SENTRY_API_TOKEN 없음')
  warnings.push(...pre.warnings)
  if (problems.length) {
    await report({ failure: `사전 점검 실패 — ${problems.join(' / ')}` })
    return { exitCode: 1, results, runId }
  }
  const lock = acquireLock(cfg.stateDir, { maxMs: cfg.lockMaxMs, now: deps.now() })
  if (!lock) {
    await report({ failure: '이전 실행이 아직 진행 중(lock)' })
    return { exitCode: 0, results, runId }
  }
  if (lock.stale) warnings.push('오래된 lock 을 회수했다')
  // 종료 신호: 이 run 의 컨테이너만 이름으로 정리하고 lock 을 푼다
  const onSignal = async (sig) => {
    await killRun(deps, runId).catch(() => {})
    lock.release()
    process.exit(sig === 'SIGINT' ? 130 : 143)
  }
  process.on('SIGTERM', onSignal)
  process.on('SIGINT', onSignal)
  // 처리 결과 노트: ready → ready 노트(manifest 기준), 기록이 남은 실패 → failed 노트. 그 외(insufficient 등)는 없음
  const putOutcomeNote = async (issue, r) => {
    let text
    try {
      if (r.status === 'ready' && r.pending) {
        const secret = parseEnvFile(cfg.envFile)?.SENTRY_AUTOFIX_NOTE_SECRET
        if (!secret || secret.length < 32) {
          if (!fixture) {
            log('서명 키 없음 — ready 메모 생략')
            if (!warnings.includes(NO_SIG_WARN)) warnings.push(NO_SIG_WARN)
          }
          return
        }
        const m = JSON.parse(readSafe(path.join(r.pending, 'manifest.json'), 1 << 20))
        const id = path.basename(r.pending)
        const sha = String(m.sha256?.['patch.diff']).slice(0, 16)
        text = lib.readyNote({
          id,
          sha,
          sig: lib.noteSig('ready', issue.id, id, sha, secret),
          files: r.files?.length,
          lines: r.lines,
          verify: r.verify?.ok ? 'ok' : 'fail',
          review: r.review === 'approve' ? 'approve' : 'blocking',
        })
      } else if (
        (r.status === 'failed' || r.status === 'blocked') &&
        (r.pending || r.reasons.some((x) => RECORD_REASONS.has(x)))
      )
        text = lib.failedNote(r.reasons[0])
    } catch {
      return // 노트를 만들 수 없으면(코드 형식 위반 등) 쓰지 않는다
    }
    if (text) await putNote(issue.id, text)
  }
  const failFile = path.join(cfg.stateDir, 'failures.json')
  let failures = {}
  try {
    failures = JSON.parse(fs.readFileSync(failFile, 'utf8'))
  } catch {}
  // 실패 횟수: { n, at }. (예전 형식의 숫자도 읽는다)
  const fOf = (v) => (typeof v === 'number' ? { n: v, at: 0 } : (v ?? { n: 0, at: 0 }))
  const bump = (key) => {
    failures[key] = { n: fOf(failures[key]).n + 1, at: deps.now() }
    writeJsonAtomic(failFile, failures)
  }
  try {
    // 전용 Codex 토큰 갱신: run lock 아래·프록시 기동 전. 실패해도 남은 시간이 있으면 계속한다
    const expBefore = authExpSec(cfg)
    if (expBefore !== null && expBefore * 1000 - deps.now() <= cfg.authRefreshHours * 3_600_000) {
      let r
      try {
        r = await deps.refreshAuth()
      } catch {
        r = { ok: false, error: 'exception' }
      }
      const expAfter = authExpSec(cfg)
      if (r.ok && expAfter !== null && expAfter > expBefore) {
        const i = warnings.indexOf(AUTH_WARN_72H)
        if (i >= 0) warnings.splice(i, 1)
      } else {
        warnings.push(
          `토큰 자동 갱신 실패(${r.ok ? 'not-extended' : r.error}) — 재로그인이 필요할 수 있음`
        )
      }
    }
    const expNow = authExpSec(cfg)
    if (expNow === null || (expNow * 1000 - deps.now()) / 3_600_000 < cfg.authMinHours) {
      await report({ failure: '사전 점검 실패 — access token 만료 임박(재로그인 필요)' })
      return { exitCode: 1, results, runId }
    }
    await killResidue(cfg, deps) // lock 을 쥔 지금은 다른 run 이 없다 — 이전 run 의 잔재 컨테이너만 이름으로 정리
    const token = fixture ? null : parseEnvFile(cfg.envFile).SENTRY_API_TOKEN
    const org = encodeURIComponent(parseEnvFile(cfg.envFile)?.SENTRY_ORG ?? 'kaleos')
    const project = encodeURIComponent(parseEnvFile(cfg.envFile)?.SENTRY_PROJECT ?? 'workdeck-app')
    const get = (p) => deps.fetchJson(`https://sentry.io/api/0${p}`, token)
    // fetchPage 가 없는 대역은 Link 헤더 없는 단일 페이지로 본다
    const getPage = async (p) =>
      deps.fetchPage
        ? deps.fetchPage(`https://sentry.io/api/0${p}`, token)
        : { body: await get(p), link: null }
    const notesOf = async (id) =>
      (await get(`/organizations/${org}/issues/${id}/comments/`)).map((c) => ({
        text: c.data?.text ?? '',
        dateCreated: c.dateCreated,
      }))

    // 후보 수집: 픽스처 / --issue / 일일 선정
    let candidates
    const getEvent = async (issue) =>
      fixture ? fixture.event : get(`/organizations/${org}/issues/${issue.id}/events/latest/`)
    if (fixture) candidates = [fixture.issue]
    else if (args.issue) {
      const sid = await get(`/organizations/${org}/shortids/${encodeURIComponent(args.issue)}/`)
      // 수동 실행도 운영자의 skip 노트는 존중한다
      const j = lib.judgeIssue(lib.parseNotes(await notesOf(sid.group.id)), deps.now())
      if (j.why === 'skip') {
        results.push({
          shortId: String(sid.group.shortId),
          status: 'skipped',
          reasons: ['autofix-skip-note'],
        })
        candidates = []
      } else candidates = [sid.group]
    } else {
      const q = new URLSearchParams({
        query: 'is:unresolved environment:production lastSeen:-14d',
        statsPeriod: '14d',
        sort: 'user',
        limit: '100',
      })
      // Link 헤더의 다음 cursor 를 따라 수집(같은 query, 상한 200건)
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
      if (raw.length > lib.MAX_ISSUES_COLLECT || cursor)
        warnings.push(`미해결 이슈가 ${lib.MAX_ISSUES_COLLECT}건을 넘어 일부만 수집`)
      const issues = raw.slice(0, lib.MAX_ISSUES_COLLECT).map((i) => ({
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
      // skip 우선 판단을 위해 최근 노트 하나가 아니라 전체 노트를 본다
      // 한 이슈의 댓글 조회가 실패해도 그 이슈만 건너뛴다(개수는 Slack 경고)
      const settled = []
      for (let n = 0; n < issues.length; n += 10)
        settled.push(
          ...(await Promise.all(
            issues.slice(n, n + 10).map(async (i) => [i, await notesOf(i.id).catch(() => null)])
          ))
        )
      const notesById = new Map(settled.filter(([, n]) => n).map(([i, n]) => [i.id, n]))
      const commentFail = settled.length - notesById.size
      if (commentFail) warnings.push(`댓글 조회 실패 ${commentFail}건`)
      issues.splice(0, issues.length, ...issues.filter((i) => notesById.has(i.id)))
      const pendingDir = path.join(cfg.stateDir, 'pending')
      const done = fs.existsSync(pendingDir) ? fs.readdirSync(pendingDir) : []
      // 값 = 그 이슈 최신 pending 기록 시각(ms). manifest 를 못 읽거나 실패 3회면 true(영구 제외)
      const processed = {}
      for (const i of issues) {
        const f = fOf(failures[i.shortId])
        // 마지막 실패보다 뒤의 autofix:request 는 실패 횟수를 초기화한다
        const lastReq = Math.max(
          0,
          ...lib
            .parseNotes(notesById.get(i.id))
            .filter((n) => n.kind === 'request')
            .map((n) => Date.parse(n.at))
        )
        if (f.n && lastReq > f.at) {
          delete failures[i.shortId]
          writeJsonAtomic(failFile, failures)
        } else if (f.n >= cfg.maxFailures) {
          processed[i.shortId] = true
          continue
        }
        const dirs = done.filter((d) => d.endsWith(`-${i.shortId}`))
        if (!dirs.length) continue
        const times = dirs.map((d) => {
          try {
            return Date.parse(
              JSON.parse(readSafe(path.join(pendingDir, d, 'manifest.json'), 1 << 20)).createdAt
            )
          } catch {
            return NaN
          }
        })
        processed[i.shortId] = times.every(Number.isFinite) ? Math.max(...times) : true
      }
      // AI 판단: 선정과 별개로 수집한 모든 이슈를 판단한다. 배치 실패 이슈는 판단 없음
      const t = await watched(cfg, deps, runId, cfg.triageDeadlineMs, (deadline) =>
        runTriage({ cfg, deps, runId, deadline, issues, warnings })
      )
      if (t.diskLow) throw new AbortRun('disk-low')
      triage = t.value
      if (issues.length)
        triageCounts = {
          p1: [...triage.values()].filter((x) => x.p === 'P1').length,
          p2: [...triage.values()].filter((x) => x.p === 'P2').length,
          p3: [...triage.values()].filter((x) => x.p === 'P3').length,
          failed: issues.length - triage.size,
        }
      for (const i of issues) {
        const t = triage.get(i.shortId)
        if (t && lib.shouldWriteTriage(notesById.get(i.id), t, deps.now()))
          await putNote(i.id, lib.triageNote(t))
      }
      const picked = lib.pickCandidates({
        issues,
        notesById,
        processed,
        now: deps.now(),
        max: Infinity,
      })
      for (const i of picked)
        if (!triage.has(i.shortId)) log(`판단 없음 — 기존 방식으로 후보 유지: ${i.shortId}`)
      candidates = lib.selectFixCandidates({ picked, notesById, triage })
    }

    let worked = 0
    let labelTries = 0
    for (const issue of candidates) {
      if (!fixture && !args.issue && worked >= lib.MAX_ISSUES_PER_RUN) break
      let event
      try {
        event = await getEvent(issue)
      } catch {
        results.push({ shortId: issue.shortId, status: 'failed', reasons: ['event-fetch-failed'] })
        continue
      }
      const cls = lib.classifyEvent(issue, event)
      if (!cls.usable && cls.label && labelTries++ >= lib.MAX_LABEL_TRIES_PER_RUN) {
        results.push({
          shortId: issue.shortId,
          status: 'insufficient',
          reasons: ['insufficient-label-cap'],
        })
        continue
      }
      // 45분 한도는 이슈 단위 — 넘으면 이 run 의 컨테이너만 이름으로 kill. 디스크가 모자라도 kill
      const { value: r, diskLow } = await watched(cfg, deps, runId, cfg.deadlineMs, (deadline) =>
        processIssue({ cfg, deps, runId, deadline, issue, event })
      )
      if (diskLow) throw Object.assign(new AbortRun('disk-low'), { shortId: issue.shortId })
      if (r.cleanupFailed) warnings.push(`정리 실패: ${r.shortId}`)
      results.push(r)
      await putOutcomeNote(issue, r)
      if (r.status !== 'insufficient') worked++
      // 일시 오류(deadline·error)는 횟수를 세어 3회면 제외한다
      const key = r.shortId
      if (
        r.status === 'failed' &&
        r.reasons.some((x) => x === 'deadline' || x.startsWith('error:'))
      )
        bump(key)
      else if (r.status !== 'failed') {
        delete failures[key]
        writeJsonAtomic(failFile, failures)
      }
    }
    writeSelection(cfg, runId, results, triage)
    await pruneRuns(cfg, deps, runId)
    await report({})
    return { exitCode: 0, results, runId }
  } catch (e) {
    writeSelection(cfg, runId, results, triage)
    // 공용 장애는 고정 코드만 알린다(예외 메시지를 싣지 않는다)
    if (e instanceof AbortRun && /^[A-Za-z0-9-]{3,40}$/.test(e.shortId ?? '')) bump(e.shortId)
    await report({
      failure:
        e instanceof AbortRun
          ? `run 중단: ${e.message}${e.shortId ? ` (${e.shortId})` : ''}`
          : '실행 오류(예외 발생)',
    })
    return { exitCode: 1, results, runId }
  } finally {
    process.off('SIGTERM', onSignal)
    process.off('SIGINT', onSignal)
    await killRun(deps, runId).catch(() => {})
    lock.release()
  }
}

// 최근 3개 run 의 로그만 남긴다. 컨테이너가 만진 잔재는 호스트가 지우지 않고 컨테이너로 정리한다
async function pruneRuns(cfg, deps, keepRunId) {
  const runs = path.join(cfg.stateDir, 'runs')
  if (!fs.existsSync(runs)) return
  const names = fs
    .readdirSync(runs)
    .filter((n) => /^\d{8}-\d{6}-[0-9a-f]{4}$/.test(n))
    .sort()
  const old = names.slice(0, Math.max(0, names.length - 3)).filter((n) => n !== keepRunId)
  for (const n of names) {
    try {
      const p = path.join(runs, n)
      if (!fs.existsSync(p)) continue
      for (const issueName of fs.readdirSync(p)) {
        const ip = path.join(p, issueName)
        const leftovers = fs.readdirSync(ip).filter((x) => x !== 'logs')
        if (leftovers.length && !(await cleanDir({ cfg, deps, runId: keepRunId, dir: ip })))
          continue
        if (old.includes(n)) fs.rmSync(path.join(ip, 'logs'), { recursive: true, force: true })
        if (old.includes(n) && fs.readdirSync(ip).length === 0) fs.rmdirSync(ip)
      }
      if (fs.readdirSync(p).length === 0) fs.rmdirSync(p)
    } catch {
      // 정리 실패는 다음 실행에서 다시 시도한다
    }
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
  const cfg = defaultConfig()
  const deps = realDeps(cfg, { noSlack: args.noSlack })
  deps.gitleaks.available =
    sh('gitleaks', ['version'], { stdio: 'ignore', timeout: 20_000 }).status === 0
  runDaily({ argv: process.argv.slice(2), cfg, deps }).then(
    (r) => process.exit(r.exitCode),
    () => {
      console.error('실행 오류')
      process.exit(1)
    }
  )
}
