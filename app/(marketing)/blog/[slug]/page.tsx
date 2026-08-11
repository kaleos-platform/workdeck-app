import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CalendarDays, ArrowRight, ArrowLeft } from 'lucide-react'
import { MDXRemote } from 'next-mdx-remote/rsc'
import remarkGfm from 'remark-gfm'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DECK_META } from '@/lib/deck-meta'
import { getAllPostSlugs, getPost } from '@/lib/marketing/blog'
import { buildMarketingMetadata, blogPostingJsonLd, breadcrumbJsonLd } from '@/lib/marketing/seo'
import { JsonLd } from '@/components/marketing/json-ld'

interface BlogDetailPageProps {
  params: Promise<{ slug: string }>
}

export function generateStaticParams() {
  return getAllPostSlugs().map((slug) => ({ slug }))
}

export async function generateMetadata({ params }: BlogDetailPageProps): Promise<Metadata> {
  const { slug } = await params
  const post = getPost(slug)

  if (!post) {
    return buildMarketingMetadata({
      title: '글을 찾을 수 없습니다 — Workdeck 블로그',
      description: '요청하신 블로그 글을 찾을 수 없습니다.',
      path: `/blog/${slug}`,
    })
  }

  return buildMarketingMetadata({
    title: `${post.title} — Workdeck 블로그`,
    description: post.description,
    path: `/blog/${post.slug}`,
    keywords: post.tags,
  })
}

export default async function BlogDetailPage({ params }: BlogDetailPageProps) {
  const { slug } = await params
  const post = getPost(slug)

  if (!post) {
    notFound()
  }

  const deckMeta = post.deck ? DECK_META[post.deck] : undefined

  return (
    <div className="w-full">
      <JsonLd data={blogPostingJsonLd(post)} />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: '홈', path: '/' },
          { name: '블로그', path: '/blog' },
          { name: post.title, path: `/blog/${post.slug}` },
        ])}
      />

      <article className="px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <Link
            href="/blog"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            블로그 목록으로
          </Link>

          <header className="mt-6 space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <CalendarDays className="h-4 w-4" aria-hidden />
              <time dateTime={post.date}>{post.date}</time>
              {deckMeta ? <Badge variant="outline">{deckMeta.name}</Badge> : null}
            </div>
            <h1 className="text-3xl font-bold tracking-tight break-keep sm:text-4xl">
              {post.title}
            </h1>
            <p className="text-lg break-keep text-muted-foreground">{post.description}</p>
            {post.tags.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {post.tags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            ) : null}
          </header>

          <div className="blog-prose mt-10 break-keep">
            <MDXRemote
              source={post.content}
              options={{ mdxOptions: { remarkPlugins: [remarkGfm] } }}
            />
          </div>

          {deckMeta ? (
            <div className="mt-16 rounded-lg border bg-muted/30 p-8 text-center">
              <h2 className="text-xl font-bold break-keep">{deckMeta.name} 더 알아보기</h2>
              <p className="mt-2 break-keep text-muted-foreground">
                베타 기간 동안 모든 기능을 무료로 사용해 보세요.
              </p>
              <Button asChild className="mt-4">
                <Link href={`/${post.deck}`}>
                  {deckMeta.name} 알아보기
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </Button>
            </div>
          ) : null}
        </div>
      </article>
    </div>
  )
}
