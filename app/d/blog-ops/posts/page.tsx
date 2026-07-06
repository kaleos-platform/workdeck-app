import { redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { PostsList } from '@/components/bo/posts/posts-list'

export default async function BlogOpsPostsPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-lg font-semibold">포스트</h1>
        <p className="text-sm text-muted-foreground">
          AI 생성 블로그 포스트를 검토·승인·발행합니다.
        </p>
      </div>

      <PostsList />
    </div>
  )
}
