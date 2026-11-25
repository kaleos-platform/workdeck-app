#!/usr/bin/env node
// 승인된 수정안(pending)을 PR 로 올리는 호스트 전용 poller(Codex·docker 없음). launchd 10분 주기.
// push 는 `autofix/<pendingId>` 브랜치로만(assertPublishRef). 승인 = Sentry 노트 `autofix:approve ... sig=<HMAC>`.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as lib from './lib.mjs'
import {
  acquireLock,
  defaultConfig,
  parseEnvFile,
  readSafe,
  readSafeBuf,
  realDeps,
  sh,
} from './run.mjs'

const PUBLISH_REF = /^autofix\/\d{8}-\d{6}-[0-9a-f]{4}-[A-Za-z0-9-]{3,40}$/
const PENDING_ID = /^\d{8}-\d{6}-[0-9a-f]{4}-[A-Za-z0-9-]{3,40}$/
const APPROVE =
  /^autofix:approve id=(\S+) sha=([0-9a-f]{16}) by=(?:admin|slack) sig=([0-9a-f]{32})$/
const MAX_ATTEMPTS = 6 // 일시 오류 연속 횟수(10분 주기 → 약 1시간)를 넘으면 실패로 기록

// push·PR 대상 ref 는 이것만 통과한다(develop·main·경로 탈출 거부)
export function assertPublishRef(ref) {
  if (typeof ref !== 'string' || !PUBLISH_REF.test(ref)) throw new Error('bad-publish-ref')
  return ref
}

class Fail extends Error {
  constructor(code, { transient = false } = {}) {
    super(code)
    this.code = code
    this.transient = transient
  }
}

const repoSlug = (url) => url.match(/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?$/)?.[1]

// 최신 상태 노트(KNOWN)의 첫 줄
function latestNoteLine(comments) {
  const known = comments
    .filter((c) => lib.KNOWN.test(c.text.trim()))
    .sort((a, b) => Date.parse(a.dateCreated) - Date.parse(b.dateCreated))
  return known.length ? known[known.length - 1].text.trim().split('\n')[0] : null
}

export async function publishRun({ cfg, deps }) {
  const log = deps.log ?? console.log
  const lock = acquireLock(cfg.stateDir, { maxMs: cfg.lockMaxMs, now: deps.now() })
  if (!lock) return { exitCode: 0, results: [] } // 04:30 run 진행 중 — 조용히 종료
  const results = []
  try {
    const env = parseEnvFile(cfg.envFile) ?? {}
    const secret = env.SENTRY_AUTOFIX_NOTE_SECRET
    if (!env.SENTRY_API_TOKEN || !secret || secret.length < 32) {
      log('SENTRY_API_TOKEN 또는 서명 키(SENTRY_AUTOFIX_NOTE_SECRET 32자 이상) 없음 — 건너뜀')
      return { exitCode: 0, results }
    }
    const org = encodeURIComponent(env.SENTRY_ORG ?? 'kaleos')
    const pendingRoot = path.join(cfg.stateDir, 'pending')
    const pubDir = path.join(cfg.stateDir, 'published')
    fs.mkdirSync(pubDir, { recursive: true, mode: 0o700 })
    const markerFile = (id) => path.join(pubDir, `${id}.json`)
    const readMarker = (id) => {
      try {
        return JSON.parse(fs.readFileSync(markerFile(id), 'utf8'))
      } catch {
        return null
      }
    }
    const writeMarker = (id, obj) =>
      fs.writeFileSync(
        markerFile(id),
        JSON.stringify({ ...obj, at: new Date(deps.now()).toISOString() }),
        { mode: 0o600 }
      )
    const slack = async (text) => {
      try {
        await deps.slack(text)
      } catch {}
    }
    const run = (cmd, args, opts) => deps.run(cmd, args, { timeout: 300_000, ...opts })

    let ids = []
    try {
      ids = fs
        .readdirSync(pendingRoot)
        .filter((n) => PENDING_ID.test(n))
        .sort()
    } catch {}

    for (const id of ids) {
      const marker = readMarker(id)
      if (marker && marker.status !== 'retry') continue
      const dir = path.join(pendingRoot, id)
      let m
      try {
        m = JSON.parse(readSafe(path.join(dir, 'manifest.json'), 1 << 20))
      } catch {
        continue
      }
      if (m?.status !== 'ready' || !/^\d{1,20}$/.test(String(m.sentryIssueId ?? ''))) continue
      const issueId = String(m.sentryIssueId)
      const shortId = String(m.shortId ?? '')

      let comments
      try {
        comments = (
          await deps.fetchJson(
            `https://sentry.io/api/0/organizations/${org}/issues/${issueId}/comments/`,
            env.SENTRY_API_TOKEN
          )
        ).map((c) => ({ text: c.data?.text ?? '', dateCreated: c.dateCreated }))
      } catch {
        log(`${id}: 노트 조회 실패`)
        continue
      }
      const line = latestNoteLine(comments)
      if (!line) continue
      const prDone = line.match(/^autofix:pr (\S+)$/)
      if (prDone && lib.PR_URL.test(prDone[1])) {
        writeMarker(id, { status: 'pr', url: prDone[1] }) // 노트는 있는데 marker 만 없던 경우
        continue
      }
      const ap = line.match(APPROVE)
      if (!ap || ap[1] !== id || !lib.verifyNoteSig('approve', issueId, id, ap[2], secret, ap[3]))
        continue
      const sha16 = ap[2]

      const putNote = (text) => deps.addComment(issueId, text)
      const fail = async (code) => {
        try {
          await putNote(lib.failedNote(code))
        } catch {
          log(`${id}: 실패 노트 쓰기 실패`)
        }
        writeMarker(id, { status: 'failed', code })
        results.push({ id, status: 'failed', code })
        await slack(`PR 생성 실패 ${shortId} ${lib.OUT_CODE.test(code) ? code : 'unknown'}`)
      }

      try {
        // ---- push 직전 재검증: manifest·바이트·승인 sha 가 모두 일치해야 한다 ----
        const sums = m.sha256 ?? {}
        const bytes = {}
        let ok =
          /^[A-Za-z0-9-]{1,40}$/.test(shortId) &&
          id === `${m.runId}-${shortId}` &&
          m.review?.verdict === 'approve' &&
          (m.review?.blocking ?? []).length === 0 &&
          /^[0-9a-f]{40}$/.test(String(m.baseCommit ?? ''))
        for (const f of ['patch.diff', 'pr-title.txt', 'pr-body.md', 'verify.json']) {
          const b = ok ? readSafeBuf(path.join(dir, f), 1 << 20) : null
          if (!b || lib.sha256(b) !== sums[f]) ok = false
          else bytes[f] = b
        }
        if (ok) {
          try {
            ok = JSON.parse(bytes['verify.json']).ok === true
          } catch {
            ok = false
          }
        }
        if (ok)
          ok = sums['patch.diff'].slice(0, 16) === sha16 && m.patchSha256 === sums['patch.diff']
        if (!ok) throw new Fail('publish-mismatch')

        const branch = assertPublishRef(`autofix/${id}`)
        const slug = repoSlug(cfg.repoUrl)
        if (!slug) throw new Fail('publish-bad-repo')
        let title = bytes['pr-title.txt'].toString('utf8').trim()
        if (!title || title.includes('\n') || title.length > 200 || title.includes('? 수정'))
          title = lib.buildPrTitle({ type: '?', shortId })

        const finish = async (url) => {
          if (!lib.PR_URL.test(url ?? '')) throw new Fail('publish-bad-url', { transient: true })
          await putNote(`autofix:pr ${url}`) // 실패하면 marker 없이 끝나 다음 run 이 PR 을 찾아 다시 쓴다
          writeMarker(id, { status: 'pr', url })
          results.push({ id, status: 'pr', url })
          await slack(`PR 생성 ${shortId} ${url}`)
        }
        const createPr = () => {
          const r = run('gh', [
            'pr',
            'create',
            '--repo',
            slug,
            '--base',
            cfg.baseBranch,
            '--head',
            branch,
            '--title',
            title,
            '--body-file',
            path.join(dir, 'pr-body.md'),
          ])
          if (r.status !== 0) throw new Fail('publish-pr-failed', { transient: true })
          return String(r.stdout).trim().split('\n').pop()
        }

        // (a) 이미 PR 이 있으면 노트만
        const lp = run('gh', [
          'pr',
          'list',
          '--repo',
          slug,
          '--head',
          branch,
          '--state',
          'all',
          '--json',
          'url',
        ])
        if (lp.status !== 0) throw new Fail('publish-gh-error', { transient: true })
        let prs = []
        try {
          prs = JSON.parse(lp.stdout)
        } catch {
          throw new Fail('publish-gh-error', { transient: true })
        }
        const existing = prs.find((p) => lib.PR_URL.test(p?.url ?? ''))
        if (existing) {
          await finish(existing.url)
          continue
        }
        // (b) 원격 브랜치만 있으면 PR 생성부터
        const ls = run('git', ['ls-remote', '--heads', cfg.repoUrl, branch])
        if (ls.status !== 0) throw new Fail('publish-git-error', { transient: true })
        if (String(ls.stdout).trim()) {
          await finish(createPr())
          continue
        }
        // (c) 새 클론 → apply → push → PR. 클론은 host 가 만든 디렉터리라(컨테이너가 만진 적 없음) host rmSync 가 안전하다
        const work = path.join(cfg.stateDir, 'publish', id)
        const repo = path.join(work, 'repo')
        fs.rmSync(work, { recursive: true, force: true })
        fs.mkdirSync(work, { recursive: true, mode: 0o700 })
        try {
          const g = (args, code, transient = false) => {
            if (run('git', ['-C', repo, ...args]).status !== 0) throw new Fail(code, { transient })
          }
          const c = run('git', [
            'clone',
            '--quiet',
            '--depth',
            '1',
            '--branch',
            cfg.baseBranch,
            cfg.repoUrl,
            repo,
          ])
          if (c.status !== 0) throw new Fail('publish-clone-failed', { transient: true })
          g(['fetch', '--quiet', '--depth', '1', 'origin', m.baseCommit], 'publish-base-missing')
          g(['checkout', '--quiet', '--detach', m.baseCommit], 'publish-base-missing')
          const patch = path.join(dir, 'patch.diff')
          g(['apply', '--check', patch], 'publish-conflict')
          g(['apply', patch], 'publish-conflict')
          g(['add', '-A'], 'publish-conflict')
          g(['commit', '--quiet', '-m', title], 'publish-commit-failed', true)
          g(['push', 'origin', `HEAD:refs/heads/${branch}`], 'publish-push-failed', true)
          await finish(createPr())
        } finally {
          fs.rmSync(work, { recursive: true, force: true })
        }
      } catch (e) {
        const code = e instanceof Fail ? e.code : 'publish-error'
        const transient = e instanceof Fail ? e.transient : true
        if (!transient) await fail(code)
        else {
          const attempts = (marker?.attempts ?? 0) + 1
          log(`${id}: 일시 오류 ${code} (${attempts}/${MAX_ATTEMPTS})`)
          if (attempts >= MAX_ATTEMPTS) await fail(code)
          else writeMarker(id, { status: 'retry', attempts })
        }
      }
    }
    return { exitCode: 0, results }
  } finally {
    lock.release()
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
  const cfg = defaultConfig()
  const deps = { ...realDeps(cfg, { noSlack: false }), run: sh }
  publishRun({ cfg, deps }).then(
    (r) => process.exit(r.exitCode),
    () => {
      console.error('실행 오류')
      process.exit(1)
    }
  )
}
