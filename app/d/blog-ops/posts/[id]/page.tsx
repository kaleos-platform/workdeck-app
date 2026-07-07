import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getUser } from '@/hooks/use-user'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { PostDetailClient } from '@/components/bo/posts/post-detail-client'
import { BLOG_OPS_POSTS_PATH } from '@/lib/deck-routes'

type Props = { params: Promise<{ id: string }> }

export default async function BlogOpsPostDetailPage({ params }: Props) {
  const user = await getUser()
  if (!user) redirect('/login')

  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) redirect('/my-deck')

  const { id } = await params

  const [post, versions] = await Promise.all([
    prisma.boPost.findFirst({
      where: { id, spaceId: resolved.space.id },
      include: { material: { select: { title: true } } },
    }),
    prisma.boPostVersion.findMany({
      where: { postId: id, spaceId: resolved.space.id },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true, note: true, createdAt: true },
    }),
  ])

  if (!post) notFound()

  const serializedPost = {
    id: post.id,
    title: post.title,
    doc: post.doc,
    status: post.status as
      | 'GENERATING'
      | 'DRAFT'
      | 'IN_REVIEW'
      | 'PUBLISH_APPROVED'
      | 'PUBLISHED'
      | 'FAILED'
      | 'ARCHIVED',
    bodyMarkdown: post.bodyMarkdown,
    ctaUrl: post.ctaUrl,
    targetKeyword: post.targetKeyword,
    publishApprovedAt: post.publishApprovedAt?.toISOString() ?? null,
    errorMessage: post.errorMessage,
    material: { title: post.material.title },
  }

  const serializedVersions = versions.map((v) => ({
    versionNumber: v.versionNumber,
    note: v.note,
    createdAt: v.createdAt.toISOString(),
  }))

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      {/* 상단 네비 */}
      <div className="flex items-center gap-2">
        <Link
          href={BLOG_OPS_POSTS_PATH}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← 목록
        </Link>
      </div>

      <PostDetailClient post={serializedPost} versions={serializedVersions} />
    </div>
  )
}
