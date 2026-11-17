// opening-migrate CLI 와 자동 이전 워커가 함께 쓰는 실행 보조(원본 S3 읽기·packet 폴더 입출력).
import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { PacketSet } from './opening-import'
import type { OpeningObjectReader, PreparedCustomer } from './opening-prepare'

const run = promisify(execFile)

export const readS3: OpeningObjectReader = async ({ bucket, key }) => {
  const profile = process.env.OPENING_AWS_PROFILE ?? 'peak'
  const { stdout } = await run(
    'aws',
    ['--profile', profile, 's3', 'cp', `s3://${bucket}/${key}`, '-'],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }
  )
  return stdout
}

export function writePacketSet(root: string, prepared: PreparedCustomer) {
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

export function readPacketSet(dir: string): PacketSet {
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
