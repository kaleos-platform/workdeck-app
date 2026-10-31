/**
 * Opening → Workdeck 고객 1곳 비PII 이전. 공고·템플릿·매장·직무만 옮기고 지원서·첨부·회원·담당자는 읽지 않는다.
 *
 * 준비(원본 읽기 전용, 기본 집계만 출력):
 *   OPENING_SOURCE_URL=... npx tsx scripts/opening-migrate.ts prepare --brand-id 123
 *   OPENING_SOURCE_URL=... npx tsx scripts/opening-migrate.ts prepare --brand-id 123 \
 *     --out /secure/dir --write-packets
 *   OPENING_AWS_PROFILE(기본 peak)로 S3 이미지·scene을 읽는다. OPENING_WEB_URL 기본 https://opening.work.
 *   --out 은 저장소 밖의 빈 폴더만 허용한다. 이미지 안 글자는 검사하지 못하므로 폴더를 고객 자료로 다룬다.
 *
 * 적재(기본 dry-run, 대상 환경은 .env.local 또는 프로세스 환경변수):
 *   npx tsx scripts/opening-migrate.ts import --packets /secure/dir --target-space <id>
 *   npx tsx scripts/opening-migrate.ts import --packets /secure/dir --target-space <id> --apply
 *   운영 DB면 --confirm-prod <대상 Space id> 가 추가로 필요하다.
 *   --apply 는 SUPABASE_SERVICE_ROLE_KEY(Storage)와 ENCRYPTION_KEY*(원장 스냅샷 암호화)를 쓴다.
 *
 * 출력은 건수와 고정 코드뿐이다. 원문·id·접속 정보는 stdout/stderr에 남기지 않는다.
 */
import { config } from 'dotenv'
config({ path: '.env.local', override: false })

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { parseArgs, promisify } from 'node:util'
import { PrismaPg } from '@prisma/adapter-pg'
import { createClient } from '@supabase/supabase-js'
import { Client } from 'pg'
import { PrismaClient } from '@/generated/prisma/client'
import { HIRING_ASSETS_BUCKET } from '@/lib/hiring/storage'
import {
  assertImportTarget,
  runOpeningImport,
  type PacketSet,
  type TargetStorage,
} from '@/lib/hiring/migration/opening-import'
import {
  prepareOpeningCustomer,
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

// 원본을 읽기 전에 거부한다. 지난 실행의 packet이 섞이지 않게 빈 폴더만 받는다.
function assertOutDir(out: string) {
  const root = resolve(out)
  if (root === repoRoot || root.startsWith(repoRoot + sep)) throw Error('OUT_DIR_INSIDE_REPO')
  if (existsSync(root) && readdirSync(root).length) throw Error('OUT_DIR_NOT_EMPTY')
  return root
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
    },
  })
  const brandId = values['brand-id']
  if (!/^[1-9]\d{0,18}$/.test(brandId ?? '')) throw Error('EXPLICIT_SCOPE_REQUIRED')
  if (values['write-packets'] && !values.out) throw Error('OUT_DIR_REQUIRED')
  const outDir = values['write-packets'] ? assertOutDir(values.out as string) : null
  const connectionString = process.env.OPENING_SOURCE_URL
  if (!connectionString) throw Error('OPENING_SOURCE_URL_REQUIRED')
  const client = new Client({
    connectionString,
    ssl: /sslmode=disable/.test(connectionString) ? false : { rejectUnauthorized: false },
  })
  await client.connect()
  try {
    const prepared = await prepareOpeningCustomer(client, readS3, {
      brandId: brandId as string,
      webOrigin: process.env.OPENING_WEB_URL ?? 'https://opening.work',
    })
    if (outDir) writePacketSet(outDir, prepared)
    console.log(
      JSON.stringify({ status: outDir ? 'PACKETS_WRITTEN' : 'DRY_RUN', ...prepared.summary })
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
      'target-space': { type: 'string' },
      apply: { type: 'boolean', default: false },
      'confirm-prod': { type: 'string' },
    },
  })
  const { packets, apply } = values
  const targetSpace = values['target-space']
  if (!packets || !/^[A-Za-z0-9_-]+$/.test(targetSpace ?? ''))
    throw Error('EXPLICIT_SCOPE_REQUIRED')
  const environment = assertImportTarget(process.env, {
    targetSpace: targetSpace as string,
    confirmProd: values['confirm-prod'],
  })
  const connectionString = (process.env.DIRECT_URL ?? process.env.DATABASE_URL) as string
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString, ssl: { rejectUnauthorized: false } }),
  })
  try {
    const report = await runOpeningImport(db, readPacketSet(packets), {
      spaceId: targetSpace as string,
      apply,
      storage: apply ? supabaseStorage() : undefined,
      readAsset: async (sha256) => readFileSync(join(packets, 'assets', sha256)),
    })
    console.log(JSON.stringify({ environment, ...report }))
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
