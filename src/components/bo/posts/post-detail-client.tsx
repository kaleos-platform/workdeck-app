'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { BoEditor } from '@/components/bo/editor/editor'
import { PostStatusBadge } from './post-status-badge'
import { StatusActionBar } from './status-action-bar'
import { VersionPanel } from './version-panel'
import type { BoPostStatus } from './post-status-badge'

// ─── 타입 ─────────────────────────────────────────────────────────────────────

type Version = {
  versionNumber: number
  note: string | null
  createdAt: string
}

type Post = {
  id: string
  title: string
  doc: unknown
  status: BoPostStatus
  bodyMarkdown: string | null
  ctaUrl: string | null
  targetKeyword: string | null
  publishApprovedAt: string | null
  errorMessage: string | null
  material: { title: string }
}

type Props = {
  post: Post
  versions: Version[]
}

// ─── 저장 상태 표시 ───────────────────────────────────────────────────────────

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'idle') return null
  if (state === 'saving')
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        저장 중…
      </span>
    )
  if (state === 'saved')
    return <span className="text-xs text-emerald-600 dark:text-emerald-400">저장됨</span>
  return <span className="text-xs text-destructive">저장 실패</span>
}

// ─── GENERATING 뷰 ────────────────────────────────────────────────────────────

function GeneratingView() {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      <div>
        <p className="text-sm font-medium">포스트를 생성하고 있습니다</p>
        <p className="mt-1 text-xs text-muted-foreground">
          AI가 초안을 작성 중입니다. 잠시 기다려주세요.
        </p>
      </div>
    </div>
  )
}

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export function PostDetailClient({ post: initialPost, versions: initialVersions }: Props) {
  const [post, setPost] = useState<Post>(initialPost)
  const [versions, setVersions] = useState<Version[]>(initialVersions)
  const [title, setTitle] = useState(initialPost.title)
  const [doc, setDoc] = useState<unknown>(initialPost.doc)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [showVersions, setShowVersions] = useState(false)

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMountedRef = useRef(true)

  // ─── 폴링 (GENERATING 상태) ───────────────────────────────────────────────

  const fetchPost = useCallback(async () => {
    if (!isMountedRef.current) return
    try {
      const res = await fetch(`/api/bo/posts/${post.id}`)
      if (!res.ok) return
      const data = (await res.json()) as { post: Post; versions: Version[] }
      if (!isMountedRef.current) return
      setPost(data.post)
      setTitle(data.post.title)
      setDoc(data.post.doc)
      setVersions(data.versions)
    } catch {
      // 폴링 오류는 조용히 무시
    }
  }, [post.id])

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (post.status !== 'GENERATING') {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
      return
    }
    function schedulePoll() {
      pollTimerRef.current = setTimeout(async () => {
        await fetchPost()
        if (isMountedRef.current && post.status === 'GENERATING') schedulePoll()
      }, 5000)
    }
    schedulePoll()
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    }
  }, [post.status, fetchPost])

  // ─── 자동 저장 (디바운스 2초) ─────────────────────────────────────────────

  const save = useCallback(
    async (newTitle: string, newDoc: unknown) => {
      // GENERATING / PUBLISHED / ARCHIVED / FAILED 상태에서는 저장 불가
      if (['GENERATING', 'PUBLISHED', 'ARCHIVED', 'FAILED'].includes(post.status)) return

      setSaveState('saving')
      try {
        const res = await fetch(`/api/bo/posts/${post.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: newTitle, doc: newDoc }),
        })
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { message?: string }
          throw new Error(data.message ?? '저장에 실패했습니다')
        }
        const data = (await res.json()) as { post: { status: BoPostStatus } }
        const returnedStatus = data.post?.status

        // 서버가 PUBLISH_APPROVED → IN_REVIEW 로 되돌린 경우 UI 동기화
        if (returnedStatus && returnedStatus !== post.status) {
          setPost((prev) => ({ ...prev, status: returnedStatus }))
          if (returnedStatus === 'IN_REVIEW' && post.status === 'PUBLISH_APPROVED') {
            toast.info('편집으로 인해 상태가 검토 중으로 변경되었습니다')
          }
        }

        setSaveState('saved')
        setTimeout(() => setSaveState('idle'), 2000)
      } catch (err) {
        setSaveState('error')
        toast.error(err instanceof Error ? err.message : '저장 실패')
      }
    },
    [post.id, post.status]
  )

  function scheduleAutoSave(newTitle: string, newDoc: unknown) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    setSaveState('idle')
    saveTimerRef.current = setTimeout(() => {
      void save(newTitle, newDoc)
    }, 2000)
  }

  function handleTitleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setTitle(val)
    scheduleAutoSave(val, doc)
  }

  function handleDocChange(newDoc: unknown) {
    setDoc(newDoc)
    scheduleAutoSave(title, newDoc)
  }

  // ─── 버전 목록 새로고침 ───────────────────────────────────────────────────

  async function refreshVersions() {
    try {
      const res = await fetch(`/api/bo/posts/${post.id}/versions`)
      if (!res.ok) return
      const data = (await res.json()) as { versions: Version[] }
      setVersions(data.versions)
    } catch {
      // 무시
    }
  }

  async function handleRestored() {
    await fetchPost()
    await refreshVersions()
  }

  // ─── 편집 가능 여부 ───────────────────────────────────────────────────────

  const isEditable = !['GENERATING', 'PUBLISHED', 'ARCHIVED', 'FAILED'].includes(post.status)

  return (
    <div className="space-y-4">
      {/* 헤더: 상태 + 저장 표시 */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <PostStatusBadge status={post.status} />
          {post.targetKeyword && (
            <span className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground">
              {post.targetKeyword}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <SaveIndicator state={saveState} />
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowVersions((v) => !v)}
          >
            {showVersions ? '버전 숨기기' : `버전 ${versions.length}개`}
          </button>
        </div>
      </div>

      {/* 소재 출처 */}
      <p className="text-xs text-muted-foreground">소재: {post.material.title}</p>

      {/* 상태 액션 바 */}
      {!['GENERATING', 'PUBLISHED', 'ARCHIVED'].includes(post.status) && (
        <StatusActionBar
          postId={post.id}
          status={post.status}
          errorMessage={post.errorMessage}
          onStatusChange={(newStatus) => setPost((prev) => ({ ...prev, status: newStatus }))}
        />
      )}

      {/* 생성 중 뷰 */}
      {post.status === 'GENERATING' ? (
        <GeneratingView />
      ) : (
        <>
          {/* 제목 */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">제목</label>
            <Input
              value={title}
              onChange={handleTitleChange}
              disabled={!isEditable}
              className="text-sm"
              placeholder="포스트 제목"
            />
          </div>

          {/* 에디터 */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">본문</label>
            <BoEditor
              key={post.id}
              initialDoc={doc}
              editable={isEditable}
              onChange={handleDocChange}
            />
          </div>
        </>
      )}

      {/* 버전 패널 */}
      {showVersions && (
        <div className="space-y-2 rounded-md border p-4">
          <p className="text-xs font-medium text-muted-foreground">버전 이력</p>
          <VersionPanel
            postId={post.id}
            versions={versions}
            onRestored={() => void handleRestored()}
          />
        </div>
      )}
    </div>
  )
}
