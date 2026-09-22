import { AsyncLocalStorage } from 'node:async_hooks'

const timings = new AsyncLocalStorage<Map<string, number>>()

// 이름은 호출부의 고정 식별자만 사용하고 사용자 입력이나 SQL을 포함하지 않는다.
export async function measureCoupangAds<T>(name: string, loader: () => Promise<T>): Promise<T> {
  const scope = timings.getStore()
  if (!scope || !/^[a-z][a-z0-9_]*$/.test(name)) return loader()
  const start = performance.now()
  try {
    return await loader()
  } finally {
    scope.set(name, (scope.get(name) ?? 0) + performance.now() - start)
  }
}

export async function withCoupangAdsTiming<T extends Response>(
  handler: () => Promise<T>
): Promise<T> {
  return timings.run(new Map(), async () => {
    const response = await measureCoupangAds('total', handler)
    const header = [...timings.getStore()!]
      .map(([name, duration]) => `${name};dur=${duration.toFixed(1)}`)
      .join(', ')
    response.headers.append('Server-Timing', header)
    return response
  })
}
