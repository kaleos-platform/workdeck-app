// Workdeck API 클라이언트
const BASE_URL = process.env.WORKDECK_API_URL || 'http://localhost:3000'
const API_KEY = process.env.WORKDECK_API_KEY || ''

const headers = {
  'Content-Type': 'application/json',
  'X-API-Key': API_KEY,
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
