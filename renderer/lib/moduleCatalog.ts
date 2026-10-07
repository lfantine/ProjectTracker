import type { ComponentType } from 'react'
import type { ModuleType } from './types'
import { AlertIcon, CalendarIcon, ChartIcon, CodeIcon, ImageIcon, NoteIcon } from '../components/icons'

export type ModuleCategory = 'suivi' | 'contenu' | 'liens'

export const MODULE_CATEGORY_LABEL: Record<ModuleCategory, string> = {
  suivi: 'Suivi',
  contenu: 'Contenu',
  liens: 'Liens',
}

export const MODULE_CATEGORY_ORDER: ModuleCategory[] = ['suivi', 'contenu', 'liens']

export interface ModuleCatalogEntry {
  type: ModuleType
  title: string
  description: string
  category: ModuleCategory
  icon: ComponentType<{ size?: number; className?: string }>
  // "direct": adding it just creates the module. "picker": adding it requires
  // choosing a specific note/error to pin, so the caller drills into a sub-view.
  kind: 'direct' | 'picker'
}

export const MODULE_CATALOG: ModuleCatalogEntry[] = [
  {
    type: 'stack',
    title: 'Stack',
    description: 'Liste des technologies utilisées sur ce projet.',
    category: 'suivi',
    icon: CodeIcon,
    kind: 'direct',
  },
  {
    type: 'deadlines',
    title: 'Échéances',
    description: 'Dates clés et deadlines à ne pas manquer.',
    category: 'suivi',
    icon: CalendarIcon,
    kind: 'direct',
  },
  {
    type: 'image',
    title: 'Image / Texte',
    description: 'Bloc libre avec une image et/ou du texte en markdown.',
    category: 'contenu',
    icon: ImageIcon,
    kind: 'direct',
  },
  {
    type: 'chart',
    title: 'Graphique',
    description: 'Graphique simple en barres ou en courbe, à partir de valeurs saisies.',
    category: 'contenu',
    icon: ChartIcon,
    kind: 'direct',
  },
  {
    type: 'note',
    title: 'Note épinglée',
    description: 'Affiche le contenu d’une note liée directement dans le projet.',
    category: 'liens',
    icon: NoteIcon,
    kind: 'picker',
  },
  {
    type: 'error',
    title: 'Erreur épinglée',
    description: 'Affiche une erreur liée directement dans le projet.',
    category: 'liens',
    icon: AlertIcon,
    kind: 'picker',
  },
]

export const MODULE_CATEGORY_COUNTS: Record<ModuleCategory, number> = MODULE_CATEGORY_ORDER.reduce(
  (acc, cat) => {
    acc[cat] = MODULE_CATALOG.filter((e) => e.category === cat).length
    return acc
  },
  {} as Record<ModuleCategory, number>
)
