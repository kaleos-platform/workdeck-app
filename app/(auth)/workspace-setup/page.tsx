import { sanitizeRedirectPath } from '@/lib/auth-redirect'
import { WorkspaceSetupForm } from '@/components/auth/workspace-setup-form'

export const metadata = {
  title: '워크스페이스 설정',
  description: 'Workdeck 워크스페이스를 만드세요',
}

export default async function WorkspaceSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string }>
}) {
  const { redirectTo } = await searchParams

  return <WorkspaceSetupForm redirectTo={sanitizeRedirectPath(redirectTo)} />
}
