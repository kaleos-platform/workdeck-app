// Workdeck API 클라이언트
const BASE_URL = process.env.WORKDECK_API_URL || 'http://localhost:3000'
const API_KEY = process.env.WORKDECK_API_KEY || ''

const headers: Record<string, string> = {
  'Content-Type': 'application/json',
  'X-API-Key': API_KEY,
}

const workerHeaders: Record<string, string> = {
  'Content-Type': 'application/json',
  'x-worker-api-key': API_KEY,
}

export async function get(path: string) {
  const res = await fetch(`${BASE_URL}${path}`, { headers })
  return res.json()
}

export async function post(path: string, body?: unknown) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

export async function patch(path: string, body: unknown) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  })
  return res.json()
}

export async function del(path: string) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'DELETE',
    headers,
  })
  return res.json()
}

/** Worker 인증으로 POST (로그 기록, heartbeat 등) */
export async function workerPost(path: string, body: unknown) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: workerHeaders,
    body: JSON.stringify(body),
  })
  return res.json()
}
