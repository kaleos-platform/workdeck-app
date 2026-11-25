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

const READY =
  /^autofix:ready id=(\S+) sha=([0-9a-f]{16}) files=\d+ lines=\d+ verify=(?:ok|fail) review=(?:approve|blocking) sig=([0-9a-f]{32})$/
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

// ready·approve 는 형식이 맞고 서명이 유효한 것만 인정한다(앱 파서와 같은 규칙 — 위조·깨진 노트는 없는 것으로 본다)
function validState(text, issueId, secret) {
  const line = text.trim().split('\n')[0]
  const kind = line.match(/^autofix:(ready|approve)(\s|$)/)?.[1]
  if (!kind) return true
  const mm = line.match(kind === 'ready' ? READY : APPROVE)
  return !!mm && lib.verifyNoteSig(kind, issueId, mm[1], mm[2], secret, mm[3])
}

// 최신 상태 노트(KNOWN)의 첫 줄
function latestNoteLine(comments, issueId, secret) {
  const known = comments
    .filter((c) => lib.KNOWN.test(c.text.trim()) && validState(c.text, issueId, secret))
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
      if (marker && marker.status !== 'retry' && marker.status !== 'pr-note-pending') continue
      const dir = path.join(pendingRoot, id)
      let m
      try {
        m = JSON.parse(readSafe(path.join(dir, 'manifest.json'), 1 << 20))
      } catch {
        continue
      }
      if (
        marker?.status !== 'pr-note-pending' &&
        !(deps.now() - Date.parse(m?.createdAt) < MAX_AGE_MS)
      )
        continue // 14일 넘은 묶음은 다루지 않는다
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
      const line = latestNoteLine(comments, issueId, secret)
      if (!line) continue
      const prDone = line.match(/^autofix:pr (\S+)$/)
      if (prDone && lib.PR_URL.test(prDone[1])) {
        writeMarker(id, { status: 'pr', url: prDone[1] }) // 노트는 있는데 marker 만 없던 경우
        continue
      }
      if (marker?.status === 'pr-note-pending') {
        // PR 은 이미 있다 — 노트만 계속 재시도(실패 처리·횟수 상한 없음)
        try {
          await deps.addComment(issueId, `autofix:pr ${marker.url}`)
          writeMarker(id, { ...marker, status: 'pr' })
        } catch {
          log(`${id}: pr 노트 쓰기 재시도 실패`)
        }
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

        let commit
        const finish = async (url) => {
          if (!lib.PR_URL.test(url ?? '')) throw new Fail('publish-bad-url', { transient: true })
          // PR 이 생긴 뒤의 노트 실패는 autofix:failed 가 아니다 — marker 로 남기고 다음 run 들이 노트를 재시도한다
          writeMarker(id, { status: 'pr-note-pending', url, commit })
          results.push({ id, status: 'pr', url })
          await slack(`PR 생성 ${shortId} ${url}`)
          try {
            await putNote(`autofix:pr ${url}`)
            writeMarker(id, { status: 'pr', url, commit })
          } catch {
            log(`${id}: pr 노트 쓰기 실패 — 다음 run 에서 재시도`)
          }
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
        // (b) 원격 브랜치 유무. 있으면 push 는 건너뛰되, 그 브랜치가 baseCommit+patch 와 같은 tree 인지 확인한다
        const ls = run('git', ['ls-remote', '--heads', cfg.repoUrl, branch])
        if (ls.status !== 0) throw new Fail('publish-git-error', { transient: true })
        const remoteExists = String(ls.stdout).trim() !== ''
        // (c) 새 클론 → apply → commit → (push) → PR. 클론은 host 가 만든 디렉터리라(컨테이너가 만진 적 없음) host rmSync 가 안전하다
        const work = path.join(cfg.stateDir, 'publish', id)
        const repo = path.join(work, 'repo')
        fs.rmSync(work, { recursive: true, force: true })
        fs.mkdirSync(work, { recursive: true, mode: 0o700 })
        try {
          const g = (args, code, transient = false) => {
            const r = run('git', ['-C', repo, ...args])
            if (r.status !== 0) throw new Fail(code, { transient })
            return String(r.stdout).trim()
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
          // PR 브랜치의 Preview 배포가 꺼져 있는 base 에서만 올린다
          let guarded = false
          try {
            const v = JSON.parse(g(['show', 'HEAD:vercel.json'], 'publish-preview-unguarded'))
            guarded = v?.git?.deploymentEnabled?.['autofix/*'] === false
          } catch {}
          if (!guarded) throw new Fail('publish-preview-unguarded')
          // 러너가 쓰는 patch 검사를 push 직전에 다시 한다
          const patch = path.join(dir, 'patch.diff')
          const patchText = bytes['patch.diff'].toString('utf8')
          const baseLower = new Set(
            g(['ls-files'], 'publish-git-error', true)
              .split('\n')
              .map((x) => x.toLowerCase())
          )
          if (lib.checkPatch(lib.parsePatch(patchText), { baseLower, patchText }).reasons.length)
            throw new Fail('publish-mismatch')
          g(['apply', '--check', patch], 'publish-conflict')
          g(['apply', patch], 'publish-conflict')
          g(['add', '-A'], 'publish-conflict')
          g(
            [
              '-c',
              'user.name=workdeck-autofix',
              '-c',
              'user.email=kaleos-dev@users.noreply.github.com',
              '-c',
              'core.hooksPath=/dev/null',
              '-c',
              'commit.gpgsign=false',
              'commit',
              '--no-verify',
              '--quiet',
              '-m',
              title,
            ],
            'publish-commit-failed',
            true
          )
          if (remoteExists) {
            g(
              ['fetch', '--quiet', '--depth', '1', 'origin', `refs/heads/${branch}`],
              'publish-git-error',
              true
            )
            if (
              g(['rev-parse', 'HEAD^{tree}'], 'publish-git-error', true) !==
              g(['rev-parse', 'FETCH_HEAD^{tree}'], 'publish-git-error', true)
            )
              throw new Fail('publish-mismatch')
            commit = g(['rev-parse', 'FETCH_HEAD'], 'publish-git-error', true)
          } else {
            g(['push', 'origin', `HEAD:refs/heads/${branch}`], 'publish-push-failed', true)
            commit = g(['rev-parse', 'HEAD'], 'publish-git-error', true)
          }
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
