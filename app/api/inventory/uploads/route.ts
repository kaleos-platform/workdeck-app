import { NextResponse } from 'next/server'
import { resolveWorkspace } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error

  const uploads = await prisma.inventoryUpload.findMany({
    where: { workspaceId: resolved.workspace.id },
    orderBy: { uploadedAt: 'desc' },
    take: 20,
  })

  return NextResponse.json({ uploads })
}
