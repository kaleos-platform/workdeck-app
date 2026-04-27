// Sales Content — End-to-End healthcheck (CI/cron 친화 wrapper).
//
// 내부적으로 smoke-e2e.ts --json 을 실행하고 결과를 파싱해 단일 라인 상태 + exit code 만 반환.
// 운영 회귀 알람용 — Slack 또는 PagerDuty 등에서 exit code 로 판단.
//
// exit codes:
//   0 — PUBLISHED (정상)
//   1 — FAILED (의도적 실패: 세션 만료, 코드 버그 등)
//   2 — INFRA (smoke 실행 자체 오류: webapp/worker 미기동, DB 미접속 등)
//
// 사용:
//   npx tsx scripts/sc/ops/healthcheck.ts --blogId <id> [--spaceId <id>] [--sessionFile <path>] [--silent]

import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

type Args = {
  blogId: string
  spaceId?: string
  sessionFile?: string
  silent: boolean
}

const HELP = `Sales Content E2E healthcheck — smoke-e2e --json wrapper.

Usage:
  npx tsx scripts/sc/ops/healthcheck.ts --blogId <id> [options]

Options:
  --blogId <id>         (필수) Naver 블로그 ID. smoke-e2e 로 그대로 전달.
  --spaceId <id>        (선택) Space ID.
  --sessionFile <path>  (선택) storageState JSON 경로.
  --silent              결과 한 줄만 stdout, smoke 의 진행 로그는 완전 무시.
                        기본은 stderr 로 스트리밍.
  -h, --help            이 도움말.

Exit code: 0=PUBLISHED, 1=FAILED, 2=INFRA error.
`

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log(HELP)
    process.exit(0)
  }
  const get = (flag: string) => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const blogId = get('--blogId')
  if (!blogId) {
    console.error(HELP)
    process.exit(2)
  }
  return {
    blogId,
    spaceId: get('--spaceId'),
    sessionFile: get('--sessionFile'),
    silent: argv.includes('--silent'),
  }
}

type SmokeResult = {
  ok: boolean
  deploymentId: string
  jobId: string
  status: string
  platformUrl: string | null
  errorMessage: string | null
}

async function runSmoke(args: Args): Promise<SmokeResult> {
  const smokePath = resolve(__dirname, 'smoke-e2e.ts')
  const cli = ['tsx', smokePath, '--blogId', args.blogId, '--json']
  if (args.spaceId) cli.push('--spaceId', args.spaceId)
  if (args.sessionFile) cli.push('--sessionFile', args.sessionFile)

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('npx', cli, {
      stdio: ['ignore', 'pipe', args.silent ? 'ignore' : 'inherit'],
    })

    let stdout = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8')
    })

    child.on('error', (err) => rejectPromise(err))
    child.on('close', (code) => {
      // smoke-e2e 가 exit 1 (FAILED) 로 끝나도 stdout 에 결과 JSON 이 있어야 한다.
      const lastLine = stdout.trim().split('\n').at(-1) ?? ''
      try {
        const parsed = JSON.parse(lastLine) as SmokeResult
        resolvePromise(parsed)
      } catch {
        // JSON 파싱 실패 = INFRA 오류. exit code 2 분기에서 처리.
        rejectPromise(
          new Error(
            `smoke-e2e 결과 파싱 실패 (exit=${code}). stdout 마지막 라인: ${lastLine.slice(0, 200)}`
          )
        )
      }
    })
  })
}

async function main() {
  const args = parseArgs()
  const startedAt = new Date()

  let result: SmokeResult
  try {
    result = await runSmoke(args)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(
      JSON.stringify({
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        ok: false,
        kind: 'INFRA',
        errorMessage: msg,
      })
    )
    process.exit(2)
  }

  const finishedAt = new Date().toISOString()
  console.log(
    JSON.stringify({
      startedAt: startedAt.toISOString(),
      finishedAt,
      ok: result.ok,
      kind: result.ok ? 'PUBLISHED' : 'FAILED',
      deploymentId: result.deploymentId,
      platformUrl: result.platformUrl,
      errorMessage: result.errorMessage,
    })
  )
  process.exit(result.ok ? 0 : 1)
}

main()
