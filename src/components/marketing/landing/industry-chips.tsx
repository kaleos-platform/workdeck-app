export function IndustryChips({ industries }: { industries: string[] }) {
  return (
    <section className="border-t px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-6 text-center">
        <h2 className="text-2xl font-bold break-keep sm:text-3xl">이런 현장에서 씁니다</h2>
        <ul className="flex flex-wrap justify-center gap-2">
          {industries.map((industry) => (
            <li key={industry} className="rounded-full border bg-card px-4 py-1.5 text-sm">
              {industry}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
