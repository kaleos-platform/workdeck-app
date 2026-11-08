'use client'

// 콘텐츠 소재 연결 — 노션(소재·발행 DB) + 구글 드라이브(Space 전용 서비스 계정).
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Status = {
  notion: {
    sourceDataSourceId: string
    requestDataSourceId: string
    lastPolledAt: string | null
    lastError: string | null
  } | null
  drive: {
    serviceAccountEmail: string
    rootId: string | null
    lastSyncedAt: string | null
    lastError: string | null
  } | null
}

const API = '/api/sc/osmu/connections'

function fmt(iso: string | null) {
  return iso ? new Date(iso).toLocaleString('ko-KR') : '아직 없음'
}

export function OsmuConnections() {
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState('')
  const [sourceDb, setSourceDb] = useState('')
  const [requestDb, setRequestDb] = useState('')
  const [root, setRoot] = useState('')

  const load = useCallback(async () => {
    const res = await fetch(API)
    if (res.ok) setStatus(await res.json())
  }, [])
  useEffect(() => {
    load().catch(() => toast.error('연결 상태를 불러오지 못했습니다'))
  }, [load])

  async function send(method: 'PUT' | 'DELETE', body?: object, done?: string) {
    setBusy(true)
    try {
      const res = await fetch(API, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json.error ?? '요청에 실패했습니다')
        return
      }
      setStatus(json)
      setToken('')
      if (done) toast.success(done)
    } catch {
      toast.error('요청에 실패했습니다')
    } finally {
      setBusy(false)
    }
  }

  const notion = status?.notion
  const drive = status?.drive

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">노션 — 콘텐츠 소재·발행</CardTitle>
          <CardDescription>
            노션에서 내부 통합을 만들고 「콘텐츠 소재」「콘텐츠 발행」 데이터베이스에 연결한 뒤,
            토큰과 두 데이터베이스 링크를 넣으세요. 「콘텐츠 발행」 행의 상태를 「작성 요청」으로
            바꾸면 10분 안에 작성이 시작됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {notion && (
            <p className="text-sm text-muted-foreground">
              연결됨 · 마지막 확인 {fmt(notion.lastPolledAt)}
              {notion.lastError && (
                <span className="block text-destructive">{notion.lastError}</span>
              )}
            </p>
          )}
          <div className="space-y-1">
            <Label htmlFor="osmu-token">통합 토큰{notion && ' (바꿀 때만 입력)'}</Label>
            <Input
              id="osmu-token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ntn_…"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="osmu-source">「콘텐츠 소재」 데이터베이스 링크</Label>
            <Input
              id="osmu-source"
              value={sourceDb}
              onChange={(e) => setSourceDb(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="osmu-request">「콘텐츠 발행」 데이터베이스 링크</Label>
            <Input
              id="osmu-request"
              value={requestDb}
              onChange={(e) => setRequestDb(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button
              disabled={busy || !sourceDb || !requestDb || (!notion && !token)}
              onClick={() =>
                send(
                  'PUT',
                  { kind: 'notion', token: token || undefined, sourceDb, requestDb },
                  '노션을 연결했습니다'
                )
              }
            >
              {notion ? '연결 바꾸기' : '연결하기'}
            </Button>
            {notion && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => send('DELETE', undefined, '노션 연결을 해제했습니다')}
              >
                연결 해제
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">구글 드라이브 — 사진</CardTitle>
          <CardDescription>
            이 워크스페이스 전용 계정을 만든 뒤, 그 이메일을 공유 드라이브 구성원(뷰어)으로 추가하고
            공유 드라이브 링크를 등록하세요. 등록한 드라이브 안의 폴더만 읽습니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!drive ? (
            <Button
              disabled={busy}
              onClick={() => send('PUT', { kind: 'drive-account' }, '드라이브 계정을 만들었습니다')}
            >
              드라이브 계정 만들기
            </Button>
          ) : (
            <>
              <div className="space-y-1">
                <Label>공유 드라이브에 추가할 이메일</Label>
                <div className="flex gap-2">
                  <Input readOnly value={drive.serviceAccountEmail} className="font-mono text-xs" />
                  <Button
                    variant="outline"
                    onClick={() =>
                      navigator.clipboard
                        .writeText(drive.serviceAccountEmail)
                        .then(() => toast.success('복사했습니다'))
                    }
                  >
                    복사
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="osmu-root">공유 드라이브 링크</Label>
                <div className="flex gap-2">
                  <Input
                    id="osmu-root"
                    value={root}
                    onChange={(e) => setRoot(e.target.value)}
                    placeholder={
                      drive.rootId
                        ? `등록됨: ${drive.rootId}`
                        : 'https://drive.google.com/drive/folders/0A…'
                    }
                  />
                  <Button
                    disabled={busy || !root}
                    onClick={() =>
                      send('PUT', { kind: 'drive-root', root }, '공유 드라이브를 등록했습니다')
                    }
                  >
                    등록
                  </Button>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                마지막 동기화 {fmt(drive.lastSyncedAt)}
                {drive.lastError && (
                  <span className="block text-destructive">{drive.lastError}</span>
                )}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
