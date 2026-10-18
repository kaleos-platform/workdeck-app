// 운영 키는 서버 안에서만 사용한다. 이 CLI는 기존 서버 인증으로 집계만 요청한다.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from 'dotenv'

const fields = [
  'checked',
  'integrityVerified',
  'integrityFailed',
  'recoveryFailed',
  'scopeFailed',
  'unsupported',
]
const models = ['HiringPosting', 'HiringApplication', 'HiringStore']
const empty = () => Object.fromEntries(fields.map((key) => [key, 0]))

export async function auditRuntimeCustomer(customer, requestPage, assets = false) {
  if (!['ameaning', 'peakpay'].includes(customer)) throw Error('INVALID_CUSTOMER')
  const assetFields = [
    'checked',
    'verified',
    'manifestMissing',
    'manifestInvalid',
    'readFailed',
    'sizeMismatch',
    'checksumMismatch',
  ]
  const assetSum = Object.fromEntries(
    ['images', 'attachments'].map((kind) => [
      kind,
      Object.fromEntries(assetFields.map((key) => [key, 0])),
    ])
  )
  const sum = empty()
  const totals = Object.fromEntries(models.map((model) => [model, empty()]))
  let through, after, total
  const visited = new Set()
  for (let page = 0; page < 1000; page++) {
    const reply = await requestPage({
      customer,
      ...(assets ? { assets: true } : {}),
      ...(through ? { through } : {}),
      ...(after ? { after } : {}),
    })
    if (
      reply.customer !== customer ||
      !Number.isSafeInteger(reply.total) ||
      reply.total < 0 ||
      (total !== undefined && total !== reply.total)
    )
      throw Error('AUDIT_RESPONSE_INVALID')
    total ??= reply.total
    if (page && reply.through !== through) throw Error('AUDIT_BOUNDARY_CHANGED')
    through = reply.through
    if (total && (typeof through !== 'string' || !through)) throw Error('AUDIT_RESPONSE_INVALID')
    for (const key of fields) {
      const value = reply.summary?.[key]
      if (!Number.isSafeInteger(value) || value < 0) throw Error('AUDIT_RESPONSE_INVALID')
      sum[key] += value
    }
    const s = reply.summary
    if (
      s.checked > (assets ? 1 : 25) ||
      s.integrityVerified + s.integrityFailed + s.scopeFailed + s.unsupported !== s.checked ||
      s.recoveryFailed > s.integrityVerified ||
      sum.checked > total
    )
      throw Error('AUDIT_COUNTS_INVALID')
    for (const model of models)
      for (const key of fields) {
        const value = s.models?.[model]?.[key]
        if (!Number.isSafeInteger(value) || value < 0) throw Error('AUDIT_RESPONSE_INVALID')
        totals[model][key] += value
      }
    for (const key of fields) {
      const modelTotal = models.reduce((count, model) => count + s.models[model][key], 0)
      const expected =
        key === 'checked' ? s.checked - s.unsupported : key === 'unsupported' ? 0 : s[key]
      if (modelTotal !== expected) throw Error('AUDIT_COUNTS_INVALID')
    }
    if (assets) {
      for (const kind of ['images', 'attachments']) {
        const stats = reply.assets?.[kind]
        for (const key of assetFields) {
          if (!Number.isSafeInteger(stats?.[key]) || stats[key] < 0)
            throw Error('AUDIT_ASSETS_INVALID')
          assetSum[kind][key] += stats[key]
        }
        if (assetFields.slice(1).reduce((count, key) => count + stats[key], 0) !== stats.checked)
          throw Error('AUDIT_ASSETS_INVALID')
      }
    }
    if (reply.next === null) {
      if (sum.checked !== total) throw Error('AUDIT_INCOMPLETE')
      return {
        customer,
        total,
        pages: page + 1,
        summary: { ...sum, models: totals },
        ...(assets ? { assets: assetSum } : {}),
      }
    }
    if (
      !s.checked ||
      typeof reply.next !== 'string' ||
      visited.has(reply.next) ||
      (after && reply.next <= after) ||
      reply.next > through
    )
      throw Error('AUDIT_CURSOR_INVALID')
    visited.add(reply.next)
    after = reply.next
  }
  throw Error('AUDIT_PAGE_LIMIT')
}

async function main() {
  const options = {}
  const names = { '--env': 'env', '--customer': 'customer' }
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--assets' && !options.assets) {
      options.assets = true
      continue
    }
    const key = names[args[i]]
    if (!key || options[key] || !args[i + 1] || args[i + 1].startsWith('--'))
      throw Error('INVALID_OPTIONS')
    options[key] = args[++i]
  }
  if (!options.env) throw Error('ENV_FILE_REQUIRED')
  const env = parse(readFileSync(options.env))
  if (!env.WORKER_API_KEY) throw Error('SERVER_AUTH_REQUIRED')
  const report = await auditRuntimeCustomer(
    options.customer,
    async (body) => {
      // 인증 헤더가 다른 호스트로 전달되지 않도록 목적지를 고정하고 redirect를 거부한다.
      const response = await fetch('https://app.workdeck.work/api/worker/hiring-migration-audit', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(options.assets ? 60000 : 30000),
        headers: { 'Content-Type': 'application/json', 'x-worker-api-key': env.WORKER_API_KEY },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw Error(`AUDIT_HTTP_${response.status}`)
      return response.json()
    },
    options.assets === true
  )
  console.log(JSON.stringify(report))
  if (
    ['integrityFailed', 'recoveryFailed', 'scopeFailed', 'unsupported'].some(
      (key) => report.summary[key] > 0
    ) ||
    (report.assets &&
      Object.values(report.assets).some((stats) => stats.verified !== stats.checked))
  )
    process.exitCode = 2
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    const code = /^[A-Z_0-9]{3,80}$/.test(error.message ?? '')
      ? error.message
      : 'RUNTIME_AUDIT_FAILED'
    console.error(JSON.stringify({ status: 'BLOCKED', code }))
    process.exitCode = 1
  })
}
