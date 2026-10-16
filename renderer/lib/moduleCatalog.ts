import type { ComponentType } from 'react'
import type { ModuleType } from './types'
import { coreBlockCatalogue, type CoreCategory } from '../../shared/contributionRegistry'
import type { HostIcon } from '../../shared/version'
import { AlertIcon, CalendarIcon, ChartIcon, CodeIcon, ImageIcon, NoteIcon, CheckIcon } from '../components/icons'

export type ModuleCategory = CoreCategory

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

// Trusted native icon adapters only: descriptors never carry renderer code/SVG.
const CORE_CATALOGUE_ICONS: Partial<Record<HostIcon, ModuleCatalogEntry['icon']>> = {
  alert: AlertIcon, calendar: CalendarIcon, chart: ChartIcon, code: CodeIcon,
  image: ImageIcon, note: NoteIcon, check: CheckIcon,
}
export const MODULE_CATALOG: ModuleCatalogEntry[] = coreBlockCatalogue().map(entry => ({
  type: entry.id, title: entry.name, description: entry.description,
  category: entry.category, icon: CORE_CATALOGUE_ICONS[entry.icon] ?? NoteIcon, kind: entry.insertion,
}))

export const MODULE_CATEGORY_COUNTS: Record<ModuleCategory, number> = MODULE_CATEGORY_ORDER.reduce(
  (acc, cat) => {
    acc[cat] = MODULE_CATALOG.filter((e) => e.category === cat).length
    return acc
  },
  {} as Record<ModuleCategory, number>
)
