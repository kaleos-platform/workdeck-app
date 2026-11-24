import { redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { prisma } from '@/lib/prisma'
import { findSignupLead, isLeadGateEnabled } from '@/lib/marketing/lead-signup'
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
  if (isLeadGateEnabled()) {
    const user = await getUser()
    if (
      user &&
      !(await prisma.user.findUnique({ where: { id: user.id }, select: { id: true } })) &&
      !(await findSignupLead(user.email ?? ''))
    ) {
      redirect('/signup?blocked=lead')
    }
  }
  const { redirectTo } = await searchParams

  return <WorkspaceSetupForm redirectTo={sanitizeRedirectPath(redirectTo)} />
}
