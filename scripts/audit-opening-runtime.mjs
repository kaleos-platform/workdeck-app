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

export async function auditRuntimeCustomer(customer, requestPage) {
  if (!['ameaning', 'peakpay'].includes(customer)) throw Error('INVALID_CUSTOMER')
  const sum = empty()
  const totals = Object.fromEntries(models.map((model) => [model, empty()]))
  let through, after, total
  const visited = new Set()
  for (let page = 0; page < 1000; page++) {
    const reply = await requestPage({
      customer,
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
      s.checked > 25 ||
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
    if (reply.next === null) {
      if (sum.checked !== total) throw Error('AUDIT_INCOMPLETE')
      return { customer, total, pages: page + 1, summary: { ...sum, models: totals } }
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
    const key = names[args[i]]
    if (!key || options[key] || !args[i + 1] || args[i + 1].startsWith('--'))
      throw Error('INVALID_OPTIONS')
    options[key] = args[++i]
  }
  if (!options.env) throw Error('ENV_FILE_REQUIRED')
  const env = parse(readFileSync(options.env))
  if (!env.WORKER_API_KEY) throw Error('SERVER_AUTH_REQUIRED')
  const report = await auditRuntimeCustomer(options.customer, async (body) => {
    // 인증 헤더가 다른 호스트로 전달되지 않도록 목적지를 고정하고 redirect를 거부한다.
    const response = await fetch('https://app.workdeck.work/api/worker/hiring-migration-audit', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json', 'x-worker-api-key': env.WORKER_API_KEY },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw Error(`AUDIT_HTTP_${response.status}`)
    return response.json()
  })
  console.log(JSON.stringify(report))
  if (
    ['integrityFailed', 'recoveryFailed', 'scopeFailed', 'unsupported'].some(
      (key) => report.summary[key] > 0
    )
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
