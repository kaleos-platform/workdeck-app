export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50 dark:from-gray-950 dark:to-gray-900 px-4">
      <div className="w-full max-w-md">
        {/* 로고 및 타이틀 */}
        <div className="mb-8 text-center">
          <div className="flex justify-center mb-4">
            <div className="h-10 w-10 rounded-md bg-gradient-to-br from-blue-600 to-purple-600" />
          </div>
          <h1 className="text-2xl font-bold">SaaS Starter</h1>
        </div>

        {/* 콘텐츠 */}
        {children}
      </div>
    </div>
  )
}
