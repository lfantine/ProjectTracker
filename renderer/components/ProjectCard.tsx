import { useRouter } from 'next/router'
import type { Project } from '../lib/types'
import { PROJECT_STATUS_LABEL, statusTone } from '../lib/constants'
import { timeAgo } from '../lib/helpers'
import { Card, StatusPill } from './ui'
import { CodeIcon, VideoIcon } from './icons'

export function ProjectCard({
  project,
  className = '',
}: {
  project: Project
  className?: string
}) {
  const router = useRouter()
  const TypeIcon = project.type === 'video' ? VideoIcon : CodeIcon
  return (
    <Card
      className={className}
      onClick={() => router.push(`/project?id=${project.id}`)}
    >
      <div className="flex justify-between items-center gap-2">
        <span className="flex items-center gap-1.5 text-[14.5px] font-bold min-w-0">
          <TypeIcon size={13} className="text-text-faint flex-shrink-0" />
          <span className="truncate">{project.name}</span>
        </span>
        <StatusPill
          label={PROJECT_STATUS_LABEL[project.status]}
          tone={statusTone(project.status)}
        />
      </div>
      <div className="text-xs text-text-muted">
        {project.category} · {(project.platforms || []).join(', ') || '—'}
      </div>
      <div className="text-[11.5px] text-text-faint mt-0.5">
        Modifié {timeAgo(project.updatedAt)}
      </div>
    </Card>
  )
}
