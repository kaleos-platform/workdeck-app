'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'

const MIN_PASSWORD_LENGTH = 8

export function AccountSettingsForm() {
  const { user } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < MIN_PASSWORD_LENGTH) {
      toast.error(`비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다`)
      return
    }
    if (password !== confirm) {
      toast.error('새 비밀번호가 서로 다릅니다')
      return
    }

    setSaving(true)
    const { error } = await createClient().auth.updateUser({ password })
    setSaving(false)

    if (error) {
      toast.error(error.message || '비밀번호 변경에 실패했습니다')
      return
    }
    setPassword('')
    setConfirm('')
    toast.success('비밀번호를 변경했습니다')
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>계정 정보</CardTitle>
          <CardDescription>로그인에 사용하는 계정입니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label>이메일</Label>
            <Input value={user?.email ?? ''} disabled />
            <p className="text-xs text-muted-foreground">
              이메일 변경이 필요하면 고객센터로 문의해 주세요.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>비밀번호 변경</CardTitle>
          <CardDescription>{MIN_PASSWORD_LENGTH}자 이상으로 설정하세요.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="max-w-sm space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-password">새 비밀번호</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">새 비밀번호 확인</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={saving || !password || !confirm}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              비밀번호 변경
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
