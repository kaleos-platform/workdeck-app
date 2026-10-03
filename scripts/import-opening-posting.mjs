// 준비된 공고 snapshot 한 건의 검증 적재. 기본값은 계획만 출력하며 고객 원문은 로그에 남기지 않는다.
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { createJiti } from 'jiti'
import { parse } from 'dotenv'
import { createHash } from 'node:crypto'

const root = fileURLToPath(new URL('../', import.meta.url))
export function parseOptions(args) {
  const options = { apply: false }
  const names = {
    '--source-space': 'sourceSpace',
    '--target-space': 'targetSpace',
    '--target-env': 'targetEnv',
    '--expected-project-ref': 'projectRef',
  }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply' && !options.apply) {
      options.apply = true
      continue
    }
    const name = names[args[i]]
    if (!name || options[name] || !args[i + 1] || args[i + 1].startsWith('--'))
      throw Error('INVALID_OPTIONS')
    options[name] = args[++i]
  }
  if (
    !/^[1-9]\d{0,18}$/.test(options.sourceSpace ?? '') ||
    !/^[A-Za-z0-9_-]+$/.test(options.targetSpace ?? '')
  )
    throw Error('EXPLICIT_SCOPE_REQUIRED')
  if (options.apply && (!options.targetEnv || !options.projectRef))
    throw Error('EXPLICIT_TARGET_REQUIRED')
  return options
}

export function validateDestination(env, expectedRef, developmentUrl) {
  if (env.MIGRATION_ENVIRONMENT !== 'validation' || !/^[a-z0-9]{20}$/.test(expectedRef))
    throw Error('VALIDATION_ENVIRONMENT_REQUIRED')
  const projectUrl = new URL(env.NEXT_PUBLIC_SUPABASE_URL)
  if (projectUrl.origin !== `https://${expectedRef}.supabase.co`)
    throw Error('TARGET_PROJECT_MISMATCH')
  if (developmentUrl && new URL(developmentUrl).origin === projectUrl.origin)
    throw Error('DEVELOPMENT_TARGET_FORBIDDEN')
  const database = new URL(env.DIRECT_URL ?? env.DATABASE_URL)
  if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw Error('INVALID_DATABASE_URL')
  const direct = database.hostname === `db.${expectedRef}.supabase.co`
  const pooler =
    database.hostname.endsWith('.pooler.supabase.com') &&
    decodeURIComponent(database.username).endsWith(`.${expectedRef}`)
  if (!direct && !pooler) throw Error('DATABASE_PROJECT_MISMATCH')
  if (!/^[a-f0-9]{64}$/i.test(env.ENCRYPTION_KEY ?? '')) throw Error('ENCRYPTION_KEY_REQUIRED')
  // 연결 문자열의 SSL 옵션이 명시적인 인증서 검증을 덮어쓰지 않게 한다.
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey'])
    database.searchParams.delete(key)
  return database.toString()
}

export async function verifyPreparedAssets(content, blocks, readObject) {
  const paths = [...new Set(blocks.flatMap((block) => (block.imagePath ? [block.imagePath] : [])))]
  const candidates = [
    ...Object.values(content.resources ?? {}),
    ...Object.values(content.images ?? {}),
    ...(content.detailImage ? [content.detailImage] : []),
  ]
  for (const path of paths) {
    const records = candidates.filter((item) => item.copiedImagePath === path)
    if (
      !records.length ||
      records.some(
        (item) =>
          !/^[a-f0-9]{64}$/.test(item.sha256 ?? '') ||
          !Number.isSafeInteger(item.sizeBytes) ||
          item.sizeBytes < 1 ||
          item.sizeBytes > 10 * 1024 * 1024
      )
    )
      throw Error('ASSET_CHECKSUM_MANIFEST_REQUIRED')
    const expected = records[0]
    if (
      records.some(
        (item) => item.sha256 !== expected.sha256 || item.sizeBytes !== expected.sizeBytes
      )
    )
      throw Error('ASSET_MANIFEST_CONFLICT')
    const bytes = await readObject(path)
    if (
      bytes.byteLength !== expected.sizeBytes ||
      createHash('sha256').update(bytes).digest('hex') !== expected.sha256
    )
      throw Error('ASSET_CHECKSUM_MISMATCH')
  }
  return paths.length
}

async function main() {
  const options = parseOptions(process.argv.slice(2))
  const raw = readFileSync(0, 'utf8')
  if (Buffer.byteLength(raw) > 64 * 1024 * 1024) throw Error('PACKET_TOO_LARGE')
  const input = JSON.parse(raw)
  if (
    input.packet?.sourceSpaceId !== options.sourceSpace ||
    input.target?.sourceSpaceId !== options.sourceSpace ||
    input.target?.spaceId !== options.targetSpace
  )
    throw Error('SCOPE_MISMATCH')
  const jiti = createJiti(import.meta.url, { alias: { '@': resolve(root, 'src') } })
  const { planOpeningPosting, importOpeningPosting } = await jiti.import(
    '../src/lib/hiring/migration/posting-import.ts'
  )
  const plan = planOpeningPosting(input.packet, input.target)
  const summary = {
    postings: 1,
    positions: plan.packet.positions.length,
    stores: plan.packet.storeIds.length,
    contentBlocks: plan.content.blocks.length,
    excludedDisabled: plan.content.excludedDisabled.length,
    formFields: plan.form.fields.length,
  }
  if (!options.apply) {
    console.log(JSON.stringify({ status: 'PLANNED', writes: 0, ...summary }))
    return
  }
  const env = parse(readFileSync(options.targetEnv))
  const localFile = resolve(root, '.env.local')
  const local = existsSync(localFile) ? parse(readFileSync(localFile)) : {}
  const connectionString = validateDestination(
    env,
    options.projectRef,
    local.NEXT_PUBLIC_SUPABASE_URL
  )
  const { createClient } = await import('@supabase/supabase-js')
  const storage = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
  )
  await verifyPreparedAssets(input.packet.content, plan.content.blocks, async (path) => {
    const { data, error } = await storage.storage.from('hiring-assets').download(path)
    if (error || !data) throw Error('ASSET_UNAVAILABLE')
    return new Uint8Array(await data.arrayBuffer())
  })
  process.env.ENCRYPTION_KEY = env.ENCRYPTION_KEY
  const { PrismaClient } = await jiti.import('../src/generated/prisma/client.ts')
  const { PrismaPg } = await import('@prisma/adapter-pg')
  const ssl = {
    rejectUnauthorized: true,
    ...(env.MIGRATION_CA_FILE ? { ca: readFileSync(env.MIGRATION_CA_FILE, 'utf8') } : {}),
  }
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, ssl }) })
  try {
    const result = await importOpeningPosting(db, input.packet, input.target)
    console.log(
      JSON.stringify({
        status: result.status === 'created' ? 'IMPORTED_DRAFT' : 'EXISTING_VERIFIED',
        ...summary,
      })
    )
  } finally {
    await db.$disconnect()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    // 검증 라이브러리/접속 오류에 원문과 비밀정보가 포함될 수 있어 정해진 코드만 출력한다.
    const message = error instanceof Error ? error.message : ''
    const code = /^[A-Z][A-Z_]{2,80}$/.test(message) ? message : 'MIGRATION_PACKET_OR_TARGET_FAILED'
    console.error(JSON.stringify({ status: 'BLOCKED', code }))
    process.exitCode = 1
  })
}
