/** @jest-environment node */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repo = resolve(__dirname, '../..')
const secret = 'SYNTHETIC_SECRET_DO_NOT_PRINT_123'
const testDir = mkdtempSync(join(tmpdir(), 'opening-cli-test-'))
const ca = join(testDir, 'ca.pem')
const blocker = join(testDir, 'no-network.cjs')
writeFileSync(ca, 'synthetic-ca')
writeFileSync(
  blocker,
  `
const net = require('node:net'); const tls = require('node:tls');
const fail = () => { throw new Error('NETWORK_ATTEMPT_DETECTED'); };
net.connect = fail; net.createConnection = fail; net.Socket.prototype.connect = fail; tls.connect = fail;
`
)
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

function cli(args: string[], extraEnv: Record<string, string> = {}) {
  const result = spawnSync(
    process.execPath,
    [
      join(repo, 'node_modules/jiti/lib/jiti-cli.mjs'),
      join(repo, 'scripts/opening-migrate.ts'),
      ...args,
    ],
    {
      cwd: testDir,
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: testDir,
        NODE_ENV: 'test',
        NODE_OPTIONS: `--require=${blocker}`,
        JITI_ALIAS: JSON.stringify({ '@': join(repo, 'src') }),
        JITI_FS_CACHE: 'false',
        DATABASE_URL: `postgresql://user:${secret}@127.0.0.1:1/db`,
        ...extraEnv,
      },
      encoding: 'utf8',
      timeout: 20000,
    }
  )
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(1)
  expect(result.stdout + result.stderr).not.toContain(secret)
  expect(result.stdout + result.stderr).not.toContain('NETWORK_ATTEMPT_DETECTED')
  expect(result.stdout).toBe('')
  return JSON.parse(result.stderr.trim())
}

it('알 수 없는 명령은 고정 오류와 실패 코드로 종료한다', () => {
  expect(cli([secret])).toEqual({ status: 'BLOCKED', code: 'UNKNOWN_COMMAND' })
})

it('인식되지 않는 옵션에 포함된 입력은 오류에 노출하지 않는다', () => {
  expect(cli(['prepare', '--brand-id', '9', `--${secret}`])).toEqual({
    status: 'BLOCKED',
    code: 'OPENING_MIGRATION_FAILED',
  })
})

it('고객 범위가 없으면 원본 접속 전에 중단한다', () => {
  expect(cli(['prepare', '--brand-id', secret])).toEqual({
    status: 'BLOCKED',
    code: 'EXPLICIT_SCOPE_REQUIRED',
  })
})

it('원본 URL 또는 CA가 없으면 접속 전에 중단한다', () => {
  expect(cli(['prepare', '--brand-id', '9'])).toEqual({
    status: 'BLOCKED',
    code: 'OPENING_SOURCE_URL_REQUIRED',
  })
  expect(
    cli(['prepare', '--brand-id', '9'], {
      OPENING_SOURCE_URL: `postgresql://user:${secret}@127.0.0.1:1/db`,
    })
  ).toEqual({
    status: 'BLOCKED',
    code: 'OPENING_CA_FILE_REQUIRED',
  })
})

it('TLS 우회 URL은 네트워크 접근 전에 차단한다', () => {
  expect(
    cli(['prepare', '--brand-id', '9'], {
      OPENING_SOURCE_URL: `postgresql://user:${secret}@127.0.0.1:1/db?sslmode=disable`,
      OPENING_CA_FILE: ca,
    })
  ).toEqual({ status: 'BLOCKED', code: 'UNSAFE_DATABASE_URL' })
})

it('존재하지 않는 CA 경로와 비밀값을 오류에 노출하지 않는다', () => {
  expect(
    cli(['prepare', '--brand-id', '9'], {
      OPENING_SOURCE_URL: `postgresql://user:${secret}@127.0.0.1:1/db`,
      OPENING_CA_FILE: join(testDir, secret),
    })
  ).toEqual({ status: 'BLOCKED', code: 'OPENING_MIGRATION_FAILED' })
})

it('잘못된 검토 파일 경로는 원본 접근 전에 고정 오류로 처리한다', () => {
  expect(cli(['prepare', '--brand-id', '9', '--review-file', join(testDir, secret)])).toEqual({
    status: 'BLOCKED',
    code: 'REVIEW_FILE_INVALID',
  })
})

it('없는 packet 경로는 비밀 경로를 출력하지 않는다', () => {
  expect(
    cli([
      'import',
      '--packets',
      join(testDir, secret),
      '--brand-id',
      '9',
      '--target-space',
      'space',
      '--confirm-prod',
      '9:space',
    ])
  ).toEqual({
    status: 'BLOCKED',
    code: 'OPENING_MIGRATION_FAILED',
  })
})

it('대상 환경 확인 누락은 DB 접근 전에 차단한다', () => {
  expect(
    cli(['import', '--packets', testDir, '--brand-id', '9', '--target-space', 'space'])
  ).toEqual({
    status: 'BLOCKED',
    code: 'PRODUCTION_CONFIRM_REQUIRED',
  })
})

it('대상 DB 설정이 없으면 DB 접근 전에 차단한다', () => {
  expect(
    cli(['import', '--packets', testDir, '--brand-id', '9', '--target-space', 'space'], {
      DATABASE_URL: '',
    })
  ).toEqual({ status: 'BLOCKED', code: 'TARGET_DATABASE_REQUIRED' })
})
