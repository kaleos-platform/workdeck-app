// 암호화 원장 한 건을 stdin으로 받아 복구 가능 여부만 출력한다. DB·파일 쓰기는 없다.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { createJiti } from 'jiti'
import { parseOptions } from './import-opening-posting.mjs'

try {
  const options = parseOptions(process.argv.slice(2))
  if (options.apply || options.targetEnv || options.projectRef) throw Error()
  const raw = readFileSync(0, 'utf8')
  if (Buffer.byteLength(raw) > 64 * 1024 * 1024) throw Error()
  const record = JSON.parse(raw)
  record.sourceSnapshotAt = new Date(record.sourceSnapshotAt)
  const root = fileURLToPath(new URL('../', import.meta.url))
  const jiti = createJiti(import.meta.url, { alias: { '@': resolve(root, 'src') } })
  const scope = {
    sourceSpaceId: options.sourceSpace,
    spaceId: options.targetSpace,
  }
  let summary
  if (record.targetModel === 'HiringPosting') {
    const { recoverOpeningPosting } = await jiti.import(
      '../src/lib/hiring/migration/posting-recovery.ts'
    )
    const { packet } = recoverOpeningPosting(record, scope)
    summary = { postings: 1, positions: packet.positions.length, stores: packet.storeIds.length }
  } else if (record.targetModel === 'HiringApplication') {
    const { recoverOpeningApplication } = await jiti.import(
      '../src/lib/hiring/migration/application-recovery.ts'
    )
    const input = recoverOpeningApplication(record, scope)
    summary = { applications: 1, files: input.files.length, stores: input.stores.length }
  } else throw Error()
  console.log(
    JSON.stringify({
      status: 'RECOVERABLE',
      writes: 0,
      ...summary,
    })
  )
} catch {
  console.error(JSON.stringify({ status: 'BLOCKED', code: 'MIGRATION_RECOVERY_FAILED' }))
  process.exitCode = 1
}
