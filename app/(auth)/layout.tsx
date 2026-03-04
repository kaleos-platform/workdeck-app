import { LayoutGrid } from 'lucide-react'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-sky-50 to-cyan-50 px-4 dark:from-gray-950 dark:to-gray-900">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-md bg-gradient-to-br from-blue-600 to-cyan-500">
              <LayoutGrid className="h-7 w-7 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-bold">Workdeck</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Workdeck에 가입하고 필요한 Deck을 추가해 업무를 시작하세요
          </p>
        </div>

        {children}
      </div>
    </div>
  )
}
