export async function verifyRecovery(
  uploadSessionId: string,
  postingUuid: string
): Promise<boolean> {
  try {
    const res = await fetch(
      `/api/hiring-public/upload-sessions/recover/${encodeURIComponent(uploadSessionId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadSessionId, postingUuid, action: 'verify' }),
      }
    )
    if (!res.ok) return false
    return (await res.json()).status === 'ready'
  } catch {
    return false
  }
}
