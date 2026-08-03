import type { DeckLandingWorkflowStep } from '@/lib/marketing/types'

interface WorkflowSectionProps {
  steps: DeckLandingWorkflowStep[]
  gradient: string
}

export function WorkflowSection({ steps, gradient }: WorkflowSectionProps) {
  return (
    <section className="border-t px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <h2 className="mb-10 text-center text-2xl font-bold break-keep sm:text-3xl">
          시작은 3단계면 충분합니다
        </h2>
        <div className="grid gap-8 sm:grid-cols-3">
          {steps.map((step) => (
            <div key={step.step} className="flex flex-col items-center gap-3 text-center">
              <div
                className={`flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br ${gradient} text-base font-bold text-white`}
              >
                {step.step}
              </div>
              <div>
                <h3 className="mb-1.5 font-semibold break-keep">{step.title}</h3>
                <p className="text-sm break-keep text-muted-foreground">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
