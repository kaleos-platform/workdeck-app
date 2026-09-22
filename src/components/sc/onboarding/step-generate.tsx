'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import type { OnboardingDraft, OnboardingResourceData } from './types'

type Props = {
  resources: OnboardingResourceData[]
  draft: OnboardingDraft | null
  draftStatus: string | null
  audience: string
  onResourcesChange: (resources: OnboardingResourceData[]) => void
  onGenerated: (draft: OnboardingDraft) => void
  onBusyChange?: (busy: boolean) => void
}

export function StepGenerate({
  resources,
  draft,
  audience,
  onResourcesChange,
  onGenerated,
  onBusyChange,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(
    '저장된 자료부터 이어서 수집하고, 발견한 모든 제품을 분석합니다.'
  )
  const [error, setError] = useState('')
  const [settingsPath, setSettingsPath] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const stop = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      stop.current = true
    }
  }, [])

  async function run() {
    if (busy) return
    stop.current = false
    setBusy(true)
    onBusyChange?.(true)
    setError('')
    setSettingsPath(null)
    async function request(path: string, body?: object) {
      const res = await fetch(
        `/api/sc/onboarding/${path}`,
        body
          ? {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            }
          : undefined
      )
      const json = await res.json()
      if (!res.ok) {
        if (
          mounted.current &&
          typeof json.settingsPath === 'string' &&
          json.settingsPath.startsWith('/') &&
          !json.settingsPath.startsWith('//')
        )
          setSettingsPath(json.settingsPath)
        throw new Error(json.message || '분석 요청에 실패했습니다.')
      }
      return json
    }
    try {
      let current: OnboardingResourceData[] = (await request('resources')).resources
      if (!mounted.current) return
      onResourcesChange(current)
      while (!stop.current && current.some((r) => r.status === 'PENDING')) {
        setMessage(
          `자료 수집 중 · 완료 ${current.filter((r) => r.status === 'DONE').length} / 발견 ${current.length}건`
        )
        const result = await request('collect', {})
        if (!mounted.current) return
        current = result.resources
        onResourcesChange(current)
        if (result.warning) setWarnings((prev) => Array.from(new Set([...prev, result.warning])))
      }
      if (!stop.current && !current.some((r) => r.status === 'DONE'))
        throw new Error(
          '분석 가능한 자료가 없습니다. 실패한 자료를 확인하거나 다른 자료를 추가하세요.'
        )
      while (!stop.current) {
        setMessage((previous) =>
          previous.startsWith('제품 분석') ? previous : '브랜드·제품·고객 분석 중…'
        )
        const result = await request('generate', { audience })
        if (!mounted.current) return
        if (result.done) {
          const failures = current.filter((resource) => resource.status === 'FAILED').length
          const finalDraft: OnboardingDraft = result.draft
          const finalWarnings = Array.from(
            new Set([
              ...(finalDraft.warnings ?? []),
              ...(failures
                ? [
                    `자료 ${failures}건 수집에 실패했습니다. 누락된 제품이 있을 수 있으니 실패 자료를 확인하세요.`,
                  ]
                : []),
            ])
          )
          setMessage(
            finalWarnings.length
              ? '분석 완료 · 확인할 경고가 있습니다. 검토·저장에서 내용을 확인하세요.'
              : '분석이 완료되었습니다. 검토·저장에서 내용을 확인하세요.'
          )
          onGenerated(
            finalWarnings.length ? { ...finalDraft, warnings: finalWarnings } : finalDraft
          )
          return
        }
        if (result.progress)
          setMessage(`제품 분석 중 · ${result.progress.completed} / ${result.progress.total}개`)
      }
      if (mounted.current)
        setMessage('중지되었습니다. 분석 시작·계속을 누르면 저장된 진행 상태에서 이어갑니다.')
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : '분석 실패')
    } finally {
      if (mounted.current) {
        setBusy(false)
        onBusyChange?.(false)
      }
    }
  }

  return (
    <section className="space-y-5">
      <h2 className="text-lg font-semibold">자료에서 제품과 ESG 근거 찾기</h2>
      <p className="text-sm text-muted-foreground">
        등록된 자료 {resources.length}건 · 홈페이지와 블로그의 연결된 제품 자료도 수집합니다. 자료
        수에 따라 시간이 걸릴 수 있습니다.
      </p>
      <p role="status" className="rounded-md border p-4 text-sm">
        {message}
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {warnings.map((warning) => (
        <p key={warning} className="text-sm text-amber-700 dark:text-amber-400">
          {warning}
        </p>
      ))}
      {settingsPath && (
        <Link href={settingsPath} className="text-sm underline">
          AI 설정 확인
        </Link>
      )}
      {resources
        .filter((r) => r.status === 'FAILED')
        .map((r) => (
          <p key={r.id} className="text-sm break-all text-destructive">
            {r.sourceUrl || r.fileName}: {r.errorMessage || '수집 실패'}
          </p>
        ))}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={run}>
          {busy ? '분석 중…' : '자료 분석 시작·계속'}
        </Button>
        {busy && (
          <Button
            variant="outline"
            onClick={() => {
              stop.current = true
              setMessage('현재 요청이 끝나면 중지합니다…')
            }}
          >
            중지
          </Button>
        )}
      </div>
      {draft && (
        <p className="text-sm">
          준비된 초안: 제품 {draft.products.length}개 · 고객 {draft.personas.length}개
        </p>
      )}
    </section>
  )
}
