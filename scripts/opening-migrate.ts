/**
 * Opening → Workdeck 고객 1곳 비PII 이전. 공고·템플릿·매장·직무만 옮기고 지원서·첨부·회원·담당자는 읽지 않는다.
 *
 * 준비(원본 읽기 전용, 기본 집계만 출력):
 *   OPENING_CA_FILE=/secure/rds-ca.pem npx tsx scripts/opening-migrate.ts prepare --brand-id 123
 *   OPENING_CA_FILE=/secure/rds-ca.pem npx tsx scripts/opening-migrate.ts prepare --brand-id 123 \
 *     --out /secure/dir --write-packets
 *   OPENING_SOURCE_URL은 명령 기록에 남지 않도록 안전한 환경에서 미리 주입한다.
 *   OPENING_CA_FILE에는 원본 RDS의 신뢰할 CA PEM 파일을 지정한다. 상대 경로는 현재 디렉터리 기준이다.
 *   대상 DB는 기본 시스템 CA를 사용하며 MIGRATION_CA_FILE을 지정하면 해당 PEM을 사용한다.
 *   대상 인증서 발급자에 맞는 CA를 확인한다. 인증서·호스트 불일치는 연결 실패로 처리한다.
 *   DB URL의 SSL 관련 옵션, host, hostaddr, uselibpqcompat는 거부한다. sslmode=require도 제거해야 한다.
 *   DIRECT_URL이 DATABASE_URL보다 우선하며 둘 중 하나가 환경에 있으면 .env.local을 읽지 않는다.
 *   이 경우 OPENING_CA_FILE 등 필요한 값도 환경에 직접 제공한다. 접속 정보는 출력하지 않는다.
 *   OPENING_AWS_PROFILE(기본 peak)로 S3 이미지·scene을 읽는다. OPENING_WEB_URL 기본 https://opening.work.
 *   --out 은 저장소 밖의 빈 폴더만 허용한다. 이미지 안 글자는 검사하지 못하므로 폴더를 고객 자료로 다룬다.
 *
 * 사람 검토(연락처 적중 해제·이미지 확인):
 *   1) prepare ... --review-dir /secure/review  → candidates.json, items/*.json(원문), images/*
 *   2) 내용을 읽고 승인할 것만 담은 파일을 만든다(저장소 밖):
 *      { "sourceSpaceId": "123", "reviewer": "이름", "reviewedAt": "2026-11-01",
 *        "items": [{ "kind": "template", "id": "40", "contentHash": "<candidates.json 값>" }],
 *        "images": ["<sha256>"] }
 *   3) prepare ... --review-file review.json --out /secure/dir --write-packets
 *      승인은 내용 해시에 묶이므로 내용이 바뀌면 다시 검토해야 한다(REVIEW_STALE).
 *   검토 폴더에는 연락처 원문이 있다. 소유자 전용(0700/0600)으로 쓰며 끝나면 지운다.
 *
 * 적재(기본 dry-run. DATABASE_URL/DIRECT_URL을 환경변수로 주면 그 환경만 쓰고, 없으면 .env.local):
 *   npx tsx scripts/opening-migrate.ts import --packets /secure/dir --brand-id 123 --target-space <id>
 *   npx tsx scripts/opening-migrate.ts import --packets /secure/dir --brand-id 123 --target-space <id> \
 *     --review-file review.json --apply
 *   개발 프로젝트로 확인되지 않는 대상은 --confirm-prod <brandId>:<spaceId> 가 추가로 필요하다.
 *   --apply 는 --review-file 이 필수이고, 승인되지 않은 이미지가 있는 항목은 refused.json 에 남기고 뺀다.
 *   충돌이 있으면 쓰기 없이 멈추고 conflicts.json 을 남긴다. --skip-conflicts 를 주면 그 항목만 빼고 진행한다.
 *   --apply 는 SUPABASE_SERVICE_ROLE_KEY(Storage)와 ENCRYPTION_KEY*(원장 스냅샷 암호화)를 쓴다.
 *
 * 출력은 건수와 고정 코드뿐이다. 원문·id·접속 정보는 stdout/stderr에 남기지 않는다.
 */
import { config } from 'dotenv'
import { openingTlsConfig } from '@/lib/hiring/migration/opening-tls'
// 대상을 프로세스 환경변수로 지정하면 .env.local을 읽지 않는다. 개발 키가 운영 실행에 섞이지 않게 한다.
if (!process.env.DATABASE_URL && !process.env.DIRECT_URL) config({ path: '.env.local' })

import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs, promisify } from 'node:util'
import { PrismaPg } from '@prisma/adapter-pg'
import { createClient } from '@supabase/supabase-js'
import { Client } from 'pg'
import { PrismaClient } from '@/generated/prisma/client'
import { HIRING_ASSETS_BUCKET } from '@/lib/hiring/storage'
import {
  assertImportTarget,
  runOpeningImport,
  safeMigrationSummary,
  safeMigrationStatus,
  writeImportIssues,
  type PacketSet,
  type TargetStorage,
} from '@/lib/hiring/migration/opening-import'
import {
  assertOutDir,
  prepareOpeningCustomer,
  writeReviewDir,
  type OpeningObjectReader,
  type PreparedCustomer,
} from '@/lib/hiring/migration/opening-prepare'

const run = promisify(execFile)
const repoRoot = resolve(__dirname, '..')

const readS3: OpeningObjectReader = async ({ bucket, key }) => {
  const profile = process.env.OPENING_AWS_PROFILE ?? 'peak'
  const { stdout } = await run(
    'aws',
    ['--profile', profile, 's3', 'cp', `s3://${bucket}/${key}`, '-'],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }
  )
  return stdout
}

function readReviewFile(path: string | undefined): unknown {
  if (!path) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw Error('REVIEW_FILE_INVALID')
  }
}

function writePacketSet(root: string, prepared: PreparedCustomer) {
  for (const dir of ['postings', 'templates', 'assets'])
    mkdirSync(join(root, dir), { recursive: true, mode: 0o700 })
  const write = (path: string, data: string | Uint8Array) =>
    writeFileSync(join(root, path), data, { mode: 0o600 })
  write('manifest.json', JSON.stringify(prepared.manifest, null, 2))
  write('org.json', JSON.stringify(prepared.org))
  for (const packet of prepared.postings)
    write(`postings/${packet.sourcePostingId}.json`, JSON.stringify(packet))
  for (const packet of prepared.templates)
    write(`templates/${packet.sourceTemplateId}.json`, JSON.stringify(packet))
  for (const [sha256, bytes] of prepared.assets) write(`assets/${sha256}`, bytes)
}

function readPacketSet(dir: string): PacketSet {
  const readJson = (path: string): unknown => JSON.parse(readFileSync(join(dir, path), 'utf8'))
  const readAll = (folder: string) =>
    readdirSync(join(dir, folder))
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => readJson(join(folder, name)))
  return {
    org: readJson('org.json'),
    templates: readAll('templates'),
    postings: readAll('postings'),
  }
}

function supabaseStorage(): TargetStorage {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) throw Error('TARGET_STORAGE_KEY_REQUIRED')
  const bucket = createClient(url, key, { auth: { persistSession: false } }).storage.from(
    HIRING_ASSETS_BUCKET
  )
  return {
    // download 오류는 없는 파일과 권한 오류가 구분되지 않아(StorageUnknownError) 목록으로 먼저 확인한다.
    read: async (path) => {
      const slash = path.lastIndexOf('/')
      const name = path.slice(slash + 1)
      const listed = await bucket.list(path.slice(0, slash), { search: name, limit: 1 })
      if (listed.error) throw Error('TARGET_STORAGE_READ_FAILED')
      if (!listed.data.some((object) => object.name === name)) return null
      const { data, error } = await bucket.download(path)
      if (error) throw Error('TARGET_STORAGE_READ_FAILED')
      return new Uint8Array(await data.arrayBuffer())
    },
    write: async (path, bytes, mimeType) => {
      const { error } = await bucket.upload(path, bytes, { contentType: mimeType, upsert: false })
      if (error) throw Error('TARGET_STORAGE_WRITE_FAILED')
    },
  }
}

async function prepare(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      'brand-id': { type: 'string' },
      out: { type: 'string' },
      'write-packets': { type: 'boolean', default: false },
      'review-dir': { type: 'string' },
      'review-file': { type: 'string' },
    },
  })
  const brandId = values['brand-id']
  if (!/^[1-9]\d{0,18}$/.test(brandId ?? '')) throw Error('EXPLICIT_SCOPE_REQUIRED')
  if (values['write-packets'] && !values.out) throw Error('OUT_DIR_REQUIRED')
  // 원본을 읽기 전에 거부한다.
  const outDir = values['write-packets'] ? assertOutDir(values.out as string, repoRoot) : null
  const reviewDir = values['review-dir'] ? assertOutDir(values['review-dir'], repoRoot) : null
  const review = readReviewFile(values['review-file'])
  const connectionString = process.env.OPENING_SOURCE_URL
  if (!connectionString) throw Error('OPENING_SOURCE_URL_REQUIRED')
  if (!process.env.OPENING_CA_FILE) throw Error('OPENING_CA_FILE_REQUIRED')
  const client = new Client(
    openingTlsConfig(connectionString, readFileSync(process.env.OPENING_CA_FILE, 'utf8'))
  )
  await client.connect()
  try {
    const prepared = await prepareOpeningCustomer(client, readS3, {
      brandId: brandId as string,
      webOrigin: process.env.OPENING_WEB_URL ?? 'https://opening.work',
      review,
    })
    if (outDir) writePacketSet(outDir, prepared)
    if (reviewDir) writeReviewDir(reviewDir, prepared.review)
    console.log(
      JSON.stringify({
        status: outDir ? 'PACKETS_WRITTEN' : 'DRY_RUN',
        ...safeMigrationSummary(prepared.summary),
      })
    )
  } finally {
    await client.end()
  }
}

async function importPackets(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      packets: { type: 'string' },
      'brand-id': { type: 'string' },
      'target-space': { type: 'string' },
      apply: { type: 'boolean', default: false },
      'confirm-prod': { type: 'string' },
      'review-file': { type: 'string' },
      'skip-conflicts': { type: 'boolean', default: false },
    },
  })
  const { packets, apply } = values
  const targetSpace = values['target-space']
  const brandId = values['brand-id']
  if (
    !packets ||
    !/^[1-9]\d{0,18}$/.test(brandId ?? '') ||
    !/^[A-Za-z0-9_-]+$/.test(targetSpace ?? '')
  )
    throw Error('EXPLICIT_SCOPE_REQUIRED')
  const environment = assertImportTarget(process.env, {
    brandId: brandId as string,
    targetSpace: targetSpace as string,
    confirmProd: values['confirm-prod'],
  })
  const connectionString = (process.env.DIRECT_URL || process.env.DATABASE_URL) as string
  const db = new PrismaClient({
    adapter: new PrismaPg(
      openingTlsConfig(
        connectionString,
        process.env.MIGRATION_CA_FILE
          ? readFileSync(process.env.MIGRATION_CA_FILE, 'utf8')
          : undefined
      )
    ),
  })
  try {
    const report = await runOpeningImport(db, readPacketSet(packets), {
      spaceId: targetSpace as string,
      brandId: brandId as string,
      apply,
      storage: apply ? supabaseStorage() : undefined,
      readAsset: async (sha256) => readFileSync(join(packets, 'assets', sha256)),
      review: readReviewFile(values['review-file']),
      skipConflicts: values['skip-conflicts'],
    })
    const { issues, status, ...summary } = report
    writeImportIssues(packets, issues)
    console.log(
      JSON.stringify({
        environment,
        status: safeMigrationStatus(status),
        ...safeMigrationSummary(summary),
      })
    )
    if (report.status === 'CONFLICT_STOPPED') process.exitCode = 1
  } finally {
    await db.$disconnect()
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'prepare') return prepare(args)
  if (command === 'import') return importPackets(args)
  throw Error('UNKNOWN_COMMAND')
}

main().catch((error) => {
  // 접속·검증 오류에 원문과 비밀정보가 섞일 수 있어 고정 코드만 출력한다.
  const message = error instanceof Error ? error.message : ''
  const code = /^[A-Z][A-Z_]{2,80}$/.test(message) ? message : 'OPENING_MIGRATION_FAILED'
  console.error(JSON.stringify({ status: 'BLOCKED', code }))
  process.exitCode = 1
})
