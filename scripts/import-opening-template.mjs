// 준비한 고객 템플릿 한 건만 처리한다. 기본 실행은 DB·Storage 쓰기가 없는 계획 출력이다.
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createJiti } from 'jiti'
import { parse } from 'dotenv'
import {
  parseOptions,
  validateDestination,
  verifyPreparedAssets,
} from './import-opening-posting.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
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
  const { planOpeningTemplate, importOpeningTemplate } = await jiti.import(
    '../src/lib/hiring/migration/template-import.ts'
  )
  const plan = planOpeningTemplate(input.packet, input.target)
  const summary = {
    templates: 1,
    contentBlocks: plan.blocks.length,
    excludedDisabled: plan.excludedDisabled.length,
    hasCover: !!plan.cover,
  }
  if (!options.apply) {
    console.log(JSON.stringify({ status: 'PLANNED', writes: 0, ...summary }))
    return
  }
  const env = parse(readFileSync(options.targetEnv))
  const localPath = resolve(root, '.env.local')
  const local = existsSync(localPath) ? parse(readFileSync(localPath)) : {}
  const connectionString = validateDestination(
    env,
    options.projectRef,
    local.NEXT_PUBLIC_SUPABASE_URL,
    options.targetMode
  )
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_KEY
  if (!serviceKey) throw Error('TARGET_STORAGE_KEY_REQUIRED')
  const { createClient } = await import('@supabase/supabase-js')
  const storage = createClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, {
    auth: { persistSession: false },
  })
  const paths = [...plan.blocks, ...(plan.cover ? [{ imagePath: plan.cover.copiedImagePath }] : [])]
  await verifyPreparedAssets(
    { ...input.packet.content, detailImage: plan.cover },
    paths,
    async (path) => {
      const { data, error } = await storage.storage.from('hiring-assets').download(path)
      if (error || !data) throw Error('ASSET_UNAVAILABLE')
      return new Uint8Array(await data.arrayBuffer())
    }
  )
  const { PrismaClient } = await jiti.import('../src/generated/prisma/client.ts')
  const { PrismaPg } = await import('@prisma/adapter-pg')
  const db = new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      ssl: {
        rejectUnauthorized: true,
        ...(env.MIGRATION_CA_FILE ? { ca: readFileSync(env.MIGRATION_CA_FILE, 'utf8') } : {}),
      },
    }),
  })
  try {
    const result = await importOpeningTemplate(db, input.packet, input.target)
    console.log(
      JSON.stringify({
        status: result.status === 'created' ? 'IMPORTED_TEMPLATE' : 'EXISTING_VERIFIED',
        ...summary,
      })
    )
  } finally {
    await db.$disconnect()
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((error) => {
    const message = error instanceof Error ? error.message : ''
    console.error(
      JSON.stringify({
        status: 'BLOCKED',
        code: /^[A-Z][A-Z_]{2,80}$/.test(message) ? message : 'MIGRATION_TEMPLATE_OR_TARGET_FAILED',
      })
    )
    process.exitCode = 1
  })
