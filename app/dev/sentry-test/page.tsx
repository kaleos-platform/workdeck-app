// TEMP: preview Sentry 검증용 — 머지 전 제거
import { notFound } from 'next/navigation'
import { ClientThrow } from './client-throw'

export default async function Page({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  if (process.env.VERCEL_ENV === 'production') notFound()
  const { kind } = await searchParams
  if (kind === 'server') throw new Error('sentry-test server component hong@example.com 010-1234-5678')
  return <ClientThrow />
}
