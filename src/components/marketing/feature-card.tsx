import { LucideIcon } from 'lucide-react'

interface FeatureCardProps {
  icon: LucideIcon
  title: string
  description: string
}

export function FeatureCard({ icon: Icon, title, description }: FeatureCardProps) {
  return (
    <div className="flex flex-col items-start gap-4">
      <div className="rounded-lg bg-gradient-to-br from-blue-600/20 to-purple-600/20 p-3">
        <Icon className="h-6 w-6 text-blue-600 dark:text-blue-400" />
      </div>
      <div>
        <h3 className="font-semibold text-lg">{title}</h3>
        <p className="text-gray-600 dark:text-gray-400 mt-2">{description}</p>
      </div>
    </div>
  )
}
