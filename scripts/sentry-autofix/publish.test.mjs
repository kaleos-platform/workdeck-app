// node --test scripts/sentry-autofix/publish.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as lib from './lib.mjs'
import { acquireLock } from './run.mjs'
import { assertPublishRef, publishRun } from './publish.mjs'

const SECRET = 's'.repeat(40)
const ISSUE = '123456'
const SHORT = 'WORKDECK-APP-1A'
const ID = `20261125-043000-ab12-${SHORT}`
const BRANCH = `autofix/${ID}`
const PR = 'https://github.com/kaleos-platform/workdeck-app/pull/77'
const BASE = 'a'.repeat(40)
const T = Date.parse('2026-11-25T10:00:00Z')
const PATCH =
  'diff --git a/src/a.ts b/src/a.ts\nindex 1111111..2222222 100644\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-a\n+b\n'
const VERCEL = JSON.stringify({ git: { deploymentEnabled: { 'autofix/*': false } } })

// 상태 디렉터리 + pending 묶음 + env 파일. 반환 cfg
function setup({
  title = '🐛 fix: TypeError 수정 — X (autofix)',
  secret = SECRET,
  patch,
  createdAt = new Date(T - 3600_000).toISOString(),
  analysis = '',
  prBody = 'body',
  analysisSha,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-'))
  const stateDir = path.join(root, 'state')
  const dir = path.join(stateDir, 'pending', ID)
  fs.mkdirSync(dir, { recursive: true })
  const content = {
    'patch.diff': patch ?? PATCH,
    'pr-title.txt': title,
    'pr-body.md': prBody,
    'analysis.md': analysis,
    'verify.json': JSON.stringify({ ok: true }),
  }
  const sha256 = {}
  for (const [n, d] of Object.entries(content)) {
    fs.writeFileSync(path.join(dir, n), d)
    sha256[n] = lib.sha256(d)
  }
  if (analysisSha) sha256['analysis.md'] = analysisSha
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({
      runId: ID.slice(0, 20),
      shortId: SHORT,
      status: 'ready',
      createdAt,
      baseCommit: BASE,
      review: { ok: true, verdict: 'approve', blocking: [] },
      sentryIssueId: ISSUE,
      patchSha256: sha256['patch.diff'],
      sha256,
    })
  )
  const envFile = path.join(root, 'env')
  fs.writeFileSync(
    envFile,
    `SENTRY_API_TOKEN=tok\n${secret ? `SENTRY_AUTOFIX_NOTE_SECRET=${secret}\n` : ''}`
  )
  return {
    cfg: {
      stateDir,
      envFile,
      repoUrl: 'https://github.com/kaleos-platform/workdeck-app.git',
      baseBranch: 'develop',
      lockMaxMs: 60_000,
    },
    sha: sha256['patch.diff'].slice(0, 16),
    dir,
  }
}

const approveText = (sha, { issue = ISSUE, id = ID, secret = SECRET, by = 'admin' } = {}) =>
  `autofix:approve id=${id} sha=${sha} by=${by} sig=${lib.noteSig('approve', issue, id, sha, secret)}`
const comment = (text, min = 0) => ({
  data: { text },
  dateCreated: new Date(T - min * 60_000).toISOString(),
})

// gh/git 대역: 호출 기록 + 상태(원격 브랜치·PR 존재 여부)
function fakes({
  comments,
  prs = [],
  remoteBranch = false,
  failOn = {},
  noteFails = 0,
  vercel = VERCEL,
  remoteTree = 'tree1',
  issues = [],
}) {
  const f = { calls: [], notes: [], slack: [], prs, remoteBranch, noteFails, issues, prBody: null }
  f.deps = {
    now: () => T,
    log: () => {},
    fetchJson: async () => comments(f),
    addComment: async (_id, text) => {
      if (f.noteFails > 0 && text.startsWith('autofix:pr')) {
        f.noteFails--
        throw new Error('Sentry API 500')
      }
      f.notes.push(text)
    },
    slack: async (t) => f.slack.push(t),
    run: (cmd, args) => {
      f.calls.push([cmd, ...args])
      const key = [cmd, ...args].find((a) => failOn[a])
      if (key) return { status: 1, stdout: '', stderr: '' }
      const bodyOf = () => fs.readFileSync(args[args.indexOf('--body-file') + 1], 'utf8')
      if (cmd === 'gh' && args[0] === 'issue' && args[1] === 'list')
        return { status: 0, stdout: JSON.stringify(f.issues) }
      if (cmd === 'gh' && args[0] === 'issue' && args[1] === 'create') {
        f.issues.push({ number: 9, body: bodyOf() })
        return {
          status: 0,
          stdout: 'https://github.com/kaleos-platform/kaleos-ax-project/issues/9\n',
        }
      }
      if (cmd === 'gh' && args[1] === 'list')
        return { status: 0, stdout: JSON.stringify(f.prs.map((url) => ({ url }))) }
      if (cmd === 'git' && args[0] === 'ls-remote')
        return { status: 0, stdout: f.remoteBranch ? `abc\trefs/heads/${BRANCH}\n` : '' }
      if (cmd === 'git' && args.includes('show')) return { status: 0, stdout: vercel }
      if (cmd === 'git' && args.includes('ls-files')) return { status: 0, stdout: 'src/a.ts\n' }
      if (cmd === 'git' && args.includes('rev-parse')) {
        const what = args[args.indexOf('rev-parse') + 1]
        const tree = what === 'FETCH_HEAD^{tree}' ? remoteTree : 'tree1'
        return { status: 0, stdout: what.endsWith('^{tree}') ? tree : 'c'.repeat(40) }
      }
      if (cmd === 'git' && args.includes('push')) f.remoteBranch = true
      if (cmd === 'gh' && args[1] === 'create') {
        f.prBody = bodyOf()
        f.prs.push(PR)
        return { status: 0, stdout: `${PR}\n` }
      }
      return { status: 0, stdout: '' }
    },
  }
  return f
}

const withApprove =
  (sha, extra = []) =>
  () => [comment(approveText(sha), 1), ...extra]
const cmdLines = (f) => f.calls.map((c) => c.join(' '))
const created = (f) => f.calls.filter((c) => c[0] === 'gh' && c[1] === 'pr' && c[2] === 'create')

test('assertPublishRef: autofix 형식만 통과', () => {
  assert.equal(assertPublishRef(BRANCH), BRANCH)
  for (const bad of [
    'develop',
    'main',
    'autofix/../main',
    'refs/heads/develop',
    `${BRANCH}/x`,
    '',
    null,
  ])
    assert.throws(() => assertPublishRef(bad), /bad-publish-ref/)
})

test('buildPrTitle: 타입 없으면 ? 를 쓰지 않는다', () => {
  assert.equal(lib.buildPrTitle({ type: '?', shortId: 'A-1' }), '🐛 fix: 오류 수정 — A-1 (autofix)')
  assert.equal(
    lib.buildPrTitle({ type: 'TypeError', shortId: 'A-1' }),
    '🐛 fix: TypeError 수정 — A-1 (autofix)'
  )
})

test('승인 없음·잘못된 서명·다른 issue/id/sha → 아무것도 안 함', async () => {
  const { cfg, sha } = setup()
  const other = 'f'.repeat(16)
  const cases = {
    none: () => [comment(`autofix:ready id=${ID} sha=${sha}`)],
    empty: () => [],
    badSig: () => [comment(`autofix:approve id=${ID} sha=${sha} by=admin sig=${'0'.repeat(32)}`)],
    otherIssue: () => [comment(approveText(sha, { issue: '999' }))],
    otherId: () => [
      comment(
        `autofix:approve id=20261125-043000-ffff-X-1 sha=${sha} by=admin sig=${lib.noteSig('approve', ISSUE, '20261125-043000-ffff-X-1', sha, SECRET)}`
      ),
    ],
    otherSha: () => [comment(approveText(other))], // sig 는 맞지만 patch sha 와 다름 → 재검증 단계 거부
    wrongSecret: () => [comment(approveText(sha, { secret: 'x'.repeat(40) }))],
    approveThenFailed: () => [
      comment(approveText(sha), 5),
      comment('autofix:failed publish-conflict', 1),
    ],
  }
  for (const [name, comments] of Object.entries(cases)) {
    const f = fakes({ comments })
    await publishRun({ cfg, deps: f.deps })
    if (name === 'otherSha') {
      assert.equal(created(f).length, 0, name)
      continue
    }
    assert.deepEqual(f.calls, [], name)
    assert.deepEqual(f.notes, [], name)
  }
})

test('서명 키 없음/짧음 → 아무것도 안 함', async () => {
  for (const secret of ['', 'short']) {
    const { cfg, sha } = setup({ secret })
    const f = fakes({ comments: withApprove(sha) })
    const r = await publishRun({ cfg, deps: f.deps })
    assert.equal(r.exitCode, 0)
    assert.deepEqual(f.calls, [])
    assert.deepEqual(f.notes, [])
  }
})

test('patch 바이트 변조 → publish-mismatch 노트 1번, push 없음', async () => {
  const { cfg, sha, dir } = setup()
  fs.chmodSync(path.join(dir, 'patch.diff'), 0o600)
  fs.writeFileSync(path.join(dir, 'patch.diff'), 'tampered')
  const f = fakes({
    comments: () => [comment(approveText(sha), 1), ...f.notes.map((t) => comment(t))],
  })
  await publishRun({ cfg, deps: f.deps })
  await publishRun({ cfg, deps: f.deps })
  assert.deepEqual(f.notes, ['autofix:failed publish-mismatch'])
  assert.deepEqual(f.calls, [])
  assert.deepEqual(f.slack, [`PR 생성 실패 ${SHORT} publish-mismatch`])
})

test('정상 경로: 명령 순서·push refspec·PR 인자·pr 노트·marker', async () => {
  const { cfg, sha, dir } = setup()
  const f = fakes({ comments: withApprove(sha) })
  const r = await publishRun({ cfg, deps: f.deps })
  const repo = path.join(cfg.stateDir, 'publish', ID, 'repo')
  const title = '🐛 fix: TypeError 수정 — X (autofix)'
  assert.deepEqual(f.calls, [
    [
      'gh',
      'pr',
      'list',
      '--repo',
      'kaleos-platform/workdeck-app',
      '--head',
      BRANCH,
      '--state',
      'all',
      '--json',
      'url',
    ],
    ['git', 'ls-remote', '--heads', cfg.repoUrl, BRANCH],
    ['git', 'clone', '--quiet', '--depth', '1', '--branch', 'develop', cfg.repoUrl, repo],
    ['git', '-C', repo, 'fetch', '--quiet', '--depth', '1', 'origin', BASE],
    ['git', '-C', repo, 'checkout', '--quiet', '--detach', BASE],
    ['git', '-C', repo, 'show', 'HEAD:vercel.json'],
    ['git', '-C', repo, 'ls-files'],
    ['git', '-C', repo, 'apply', '--check', path.join(dir, 'patch.diff')],
    ['git', '-C', repo, 'apply', path.join(dir, 'patch.diff')],
    ['git', '-C', repo, 'add', '-A'],
    [
      'git',
      '-C',
      repo,
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
    ['git', '-C', repo, 'push', 'origin', `HEAD:refs/heads/${BRANCH}`],
    ['git', '-C', repo, 'rev-parse', 'HEAD'],
    [
      'gh',
      'pr',
      'create',
      '--repo',
      'kaleos-platform/workdeck-app',
      '--base',
      'develop',
      '--head',
      BRANCH,
      '--title',
      title,
      '--body-file',
      path.join(cfg.stateDir, 'publish', `${ID}.pr-body.md`),
    ],
  ])
  assert.deepEqual(f.notes, [`autofix:pr ${PR}`])
  assert.deepEqual(f.slack, [`PR 생성 ${SHORT} ${PR}`])
  assert.equal(r.results[0].status, 'pr')
  const mk = JSON.parse(fs.readFileSync(path.join(cfg.stateDir, 'published', `${ID}.json`)))
  assert.equal(mk.url, PR)
  assert.equal(mk.commit, 'c'.repeat(40))
  assert.equal(fs.existsSync(path.join(cfg.stateDir, 'publish', ID)), false) // 클론 정리
  // marker 가 있으면 다음 run 은 아무것도 안 한다
  f.calls.length = 0
  await publishRun({ cfg, deps: f.deps })
  assert.deepEqual(f.calls, [])
})

test('승인 노트 2개 → PR 1개', async () => {
  const { cfg, sha } = setup()
  const f = fakes({
    comments: () => [
      comment(approveText(sha, { by: 'admin' }), 5),
      comment(approveText(sha, { by: 'slack' }), 1),
    ],
  })
  await publishRun({ cfg, deps: f.deps })
  await publishRun({ cfg, deps: f.deps })
  assert.equal(created(f).length, 1)
  assert.equal(f.notes.length, 1)
})

test('복구: PR 이 이미 있으면 노트만', async () => {
  const { cfg, sha } = setup()
  const f = fakes({ comments: withApprove(sha), prs: [PR] })
  await publishRun({ cfg, deps: f.deps })
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0][1], 'pr')
  assert.deepEqual(f.notes, [`autofix:pr ${PR}`])
})

test('복구: 원격 브랜치만 있으면 tree 일치 확인 뒤 PR 생성만(push 없음)', async () => {
  const { cfg, sha } = setup()
  const f = fakes({ comments: withApprove(sha), remoteBranch: true })
  await publishRun({ cfg, deps: f.deps })
  assert.equal(created(f).length, 1)
  assert.ok(!cmdLines(f).some((l) => l.includes(' push ')))
  assert.ok(cmdLines(f).some((l) => l.endsWith(`origin refs/heads/${BRANCH}`)))
  assert.deepEqual(f.notes, [`autofix:pr ${PR}`])
})

test('원격 브랜치 tree 가 baseCommit+patch 와 다르면 publish-mismatch, PR 없음', async () => {
  const { cfg, sha } = setup()
  const f = fakes({ comments: withApprove(sha), remoteBranch: true, remoteTree: 'evil' })
  await publishRun({ cfg, deps: f.deps })
  assert.equal(created(f).length, 0)
  assert.deepEqual(f.notes, ['autofix:failed publish-mismatch'])
})

test('base 의 vercel.json 에 autofix/* 가 꺼져 있지 않으면 publish-preview-unguarded', async () => {
  const off = JSON.stringify({ git: { deploymentEnabled: { 'autofix/*': true } } })
  for (const vercel of ['{}', 'not json', off]) {
    const { cfg, sha } = setup()
    const f = fakes({ comments: withApprove(sha), vercel })
    await publishRun({ cfg, deps: f.deps })
    assert.deepEqual(f.notes, ['autofix:failed publish-preview-unguarded'])
    assert.ok(!cmdLines(f).some((l) => l.includes(' push ')))
    assert.deepEqual(f.slack, [`PR 생성 실패 ${SHORT} publish-preview-unguarded`])
  }
})

test('push 직전 checkPatch: 허용 경로 밖 patch 는 publish-mismatch', async () => {
  const bad = PATCH.replaceAll('src/a.ts', '.github/workflows/x.yml')
  const { cfg, sha } = setup({ patch: bad })
  const f = fakes({ comments: withApprove(sha) })
  await publishRun({ cfg, deps: f.deps })
  assert.deepEqual(f.notes, ['autofix:failed publish-mismatch'])
  assert.ok(!cmdLines(f).some((l) => l.includes(' push ') || l.includes(' apply ')))
})

test('14일 넘은 pending 은 다루지 않는다', async () => {
  const { cfg, sha } = setup({ createdAt: new Date(T - 15 * 86400_000).toISOString() })
  const f = fakes({ comments: withApprove(sha) })
  await publishRun({ cfg, deps: f.deps })
  assert.deepEqual(f.calls, [])
  assert.deepEqual(f.notes, [])
})

test('유효한 approve 뒤의 깨진/위조 ready 노트는 없는 것으로 본다', async () => {
  const { cfg, sha } = setup()
  const forged = `autofix:ready id=${ID} sha=${sha} files=1 lines=1 verify=ok review=approve sig=${'0'.repeat(32)}`
  const f = fakes({
    comments: () => [
      comment(approveText(sha), 5),
      comment('autofix:ready x', 2),
      comment(forged, 1),
    ],
  })
  await publishRun({ cfg, deps: f.deps })
  assert.equal(created(f).length, 1)
})

test('pr 노트 POST 실패 → 다음 run 이 기존 PR 로 노트 작성(PR 생성은 총 1번)', async () => {
  const { cfg, sha } = setup()
  const f = fakes({ comments: withApprove(sha), noteFails: 1 })
  await publishRun({ cfg, deps: f.deps })
  assert.deepEqual(f.notes, [])
  assert.equal(created(f).length, 1)
  const mf = path.join(cfg.stateDir, 'published', `${ID}.json`)
  assert.equal(JSON.parse(fs.readFileSync(mf)).status, 'pr-note-pending')
  await publishRun({ cfg, deps: f.deps })
  assert.equal(created(f).length, 1)
  assert.deepEqual(f.notes, [`autofix:pr ${PR}`])
  assert.equal(JSON.parse(fs.readFileSync(mf)).status, 'pr')
})

test('pr 노트가 계속 실패해도 failed 노트·횟수 상한 없이 재시도', async () => {
  const { cfg, sha } = setup()
  const f = fakes({ comments: withApprove(sha), noteFails: 20 })
  for (let n = 0; n < 10; n++) await publishRun({ cfg, deps: f.deps })
  assert.deepEqual(f.notes, [])
  assert.equal(created(f).length, 1)
  f.noteFails = 0
  await publishRun({ cfg, deps: f.deps })
  assert.deepEqual(f.notes, [`autofix:pr ${PR}`])
})

test('apply 충돌 → publish-conflict 노트·실패 Slack, push 없음', async () => {
  const { cfg, sha } = setup()
  const f = fakes({ comments: withApprove(sha), failOn: { '--check': true } })
  await publishRun({ cfg, deps: f.deps })
  assert.deepEqual(f.notes, ['autofix:failed publish-conflict'])
  assert.deepEqual(f.slack, [`PR 생성 실패 ${SHORT} publish-conflict`])
  assert.ok(!cmdLines(f).some((l) => l.includes(' push ')))
})

test('baseCommit fetch 실패 → publish-base-missing', async () => {
  const { cfg, sha } = setup()
  const f = fakes({ comments: withApprove(sha), failOn: { fetch: true } })
  await publishRun({ cfg, deps: f.deps })
  assert.deepEqual(f.notes, ['autofix:failed publish-base-missing'])
})

test('title 에 "? 수정" 이 있으면 lib 로 다시 만든다', async () => {
  const { cfg, sha } = setup({ title: `🐛 fix: ? 수정 — ${SHORT} (autofix)` })
  const f = fakes({ comments: withApprove(sha) })
  await publishRun({ cfg, deps: f.deps })
  assert.equal(
    created(f)[0][created(f)[0].indexOf('--title') + 1],
    `🐛 fix: 오류 수정 — ${SHORT} (autofix)`
  )
})

test('lock 을 다른 프로세스가 쥐고 있으면 아무 일도 안 함', async () => {
  const { cfg, sha } = setup()
  const held = acquireLock(cfg.stateDir)
  const f = fakes({ comments: withApprove(sha) })
  const r = await publishRun({ cfg, deps: f.deps })
  assert.equal(r.exitCode, 0)
  assert.deepEqual(f.calls, [])
  held.release()
})

const ISSUE_LINK =
  '- 분석: 비공개 기록 https://github.com/kaleos-platform/kaleos-ax-project/issues/9'
const ANALYSIS = '원인: 비밀스러운 분석 문장'
const runOnce = async (opts, fopts = {}) => {
  const { cfg, sha } = setup(opts)
  const f = fakes({ comments: withApprove(sha), ...fopts })
  const r = await publishRun({ cfg, deps: f.deps })
  return { cfg, f, r }
}

test('분석은 비공개 이슈로, PR 본문에는 링크만(분석 문장 없음)', async () => {
  const { f, cfg } = await runOnce({
    analysis: ANALYSIS,
    prBody: '요약\n- 리뷰 결과: approve\nFixes X-1\n',
  })
  assert.equal(f.issues.length, 1)
  assert.equal(f.issues[0].body.split('\n')[0], `수정안 ID: ${ID}`)
  assert.ok(f.issues[0].body.includes(ANALYSIS))
  assert.ok(f.prBody.includes(ISSUE_LINK))
  assert.ok(!f.prBody.includes('비밀스러운'))
  assert.ok(f.prBody.indexOf(ISSUE_LINK) < f.prBody.indexOf('Fixes X-1'))
  assert.equal(fs.readdirSync(path.join(cfg.stateDir, 'publish')).length, 0) // 임시 파일 정리
})

test('옛 묶음(pr-body 안에 ## 분석)도 분석 없이 올린다', async () => {
  const legacy = `요약\n- 리뷰 결과: approve\n## 분석\n\`\`\`\n${ANALYSIS}\n\`\`\`\nFixes X-1\n`
  const { f } = await runOnce({ analysis: ANALYSIS, prBody: legacy })
  assert.ok(!f.prBody.includes('분석\n'))
  assert.ok(!f.prBody.includes('비밀스러운'))
  assert.ok(f.prBody.includes(ISSUE_LINK) && f.prBody.includes('Fixes X-1'))
})

test('분석 안에 Fixes 로 시작하는 줄이 있어도 분석 전체를 지운다', async () => {
  const legacy = `요약\n## 분석\n\`\`\`\nFixes 가짜\n${ANALYSIS}\n\`\`\`\nFixes X-1\n`
  const { f } = await runOnce({ analysis: ANALYSIS, prBody: legacy })
  assert.ok(!f.prBody.includes('비밀스러운'))
  assert.ok(!f.prBody.includes('Fixes 가짜'))
  assert.ok(f.prBody.includes('Fixes X-1'))
})

test('재시도 시 기존 비공개 이슈를 재사용(중복 생성 없음)', async () => {
  const issues = [
    { number: 5, body: `수정안 ID: ${ID}\n\n본문` },
    { number: 6, body: '다른 이슈' },
  ]
  const { f } = await runOnce({ analysis: ANALYSIS }, { issues })
  assert.equal(f.calls.filter((c) => c[1] === 'issue' && c[2] === 'create').length, 0)
  assert.ok(f.prBody.includes('issues/5'))
})

test('gh issue list 실패 → 이슈·PR 만들지 않고 일시 오류', async () => {
  const { f, cfg } = await runOnce({ analysis: ANALYSIS }, { failOn: { issue: true } })
  assert.equal(created(f).length, 0)
  assert.equal(f.issues.length, 0)
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(cfg.stateDir, 'published', `${ID}.json`))).status,
    'retry'
  )
})

test('analysis.md sha 불일치 → publish-mismatch', async () => {
  const { f, r } = await runOnce({ analysis: ANALYSIS, analysisSha: 'f'.repeat(64) })
  assert.equal(created(f).length, 0)
  assert.equal(r.results[0].code, 'publish-mismatch')
})

test('분석이 비어 있으면 이슈·링크 없이 PR', async () => {
  const { f } = await runOnce({ analysis: '' })
  assert.equal(f.issues.length, 0)
  assert.equal(created(f).length, 1)
  assert.ok(!f.prBody.includes('분석: 비공개'))
})
