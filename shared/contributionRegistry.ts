import { isContributionRef, type ContributionRef } from './bindings'
import { CORE_BLOCK_TYPES, CORE_WIDGETS, isCoreBlockType, isCoreWidget, type CoreBlockType, type CoreWidgetId } from './core'
import { CORE_PACKAGE_ID } from './ids'
import type { ContributionType } from './manifest'
import { CORE_VERSION, type HostIcon } from './version'

export type CoreCategory = 'suivi' | 'contenu' | 'liens'
export interface CoreBlockDetails {
  name: string; description: string; category: CoreCategory; icon: HostIcon
  insertion: 'direct' | 'picker'
  /** Tasks remain the existing project section, not an extra addable block. */
  catalogueOrder: number | null
}
export const CORE_BLOCK_DETAILS: Readonly<Record<CoreBlockType, CoreBlockDetails>> = {
  table: { name: 'Table', description: 'Table personnalisable avec un modèle pour suivre les candidatures.', category: 'suivi', icon: 'note', insertion: 'direct', catalogueOrder: 0 },
  stack: { name: 'Stack', description: 'Liste des technologies utilisées sur ce projet.', category: 'suivi', icon: 'code', insertion: 'direct', catalogueOrder: 1 },
  tasks: { name: 'Tâches', description: 'Tâches et sous-tâches du projet.', category: 'suivi', icon: 'check', insertion: 'direct', catalogueOrder: null },
  deadlines: { name: 'Échéances', description: 'Dates clés et deadlines à ne pas manquer.', category: 'suivi', icon: 'calendar', insertion: 'direct', catalogueOrder: 2 },
  image: { name: 'Image / Texte', description: 'Bloc libre avec une image et/ou du texte en markdown.', category: 'contenu', icon: 'image', insertion: 'direct', catalogueOrder: 3 },
  chart: { name: 'Graphique', description: 'Graphique simple en barres ou en courbe, à partir de valeurs saisies.', category: 'contenu', icon: 'chart', insertion: 'direct', catalogueOrder: 4 },
  note: { name: 'Note épinglée', description: 'Affiche le contenu d’une note liée directement dans le projet.', category: 'liens', icon: 'note', insertion: 'picker', catalogueOrder: 5 },
  error: { name: 'Erreur épinglée', description: 'Affiche une erreur liée directement dans le projet.', category: 'liens', icon: 'alert', insertion: 'picker', catalogueOrder: 6 },
}
export type NativeContribution = {
  source: 'native'; ref: ContributionRef; version: string; name: string
} & ({ type: 'minor'; adapter: CoreBlockType; details: CoreBlockDetails } |
  { type: 'widget'; adapter: CoreWidgetId; size: { w: number; h: number } })

/** Expected host kind is mandatory: legacy CORE "deadlines" names both its
 * project block and home widget. Preserve persisted references; do not silently
 * rename either. External manifests still require unique local ids across kinds.
 */
export function resolveCoreContribution(ref: ContributionRef, type: ContributionType): NativeContribution | undefined {
  if (!isContributionRef(ref) || ref.packageId !== CORE_PACKAGE_ID) return undefined
  if (type === 'minor' && isCoreBlockType(ref.contributionId)) {
    const details = CORE_BLOCK_DETAILS[ref.contributionId]
    return { source: 'native', ref: { ...ref }, version: CORE_VERSION, type, adapter: ref.contributionId, name: details.name, details: { ...details } }
  }
  if (type === 'widget' && isCoreWidget(ref.contributionId)) {
    const widget = CORE_WIDGETS[ref.contributionId]
    return { source: 'native', ref: { ...ref }, version: CORE_VERSION, type, adapter: ref.contributionId, name: widget.name, size: { ...widget.size } }
  }
  return undefined
}

export function coreBlockCatalogue(): (CoreBlockDetails & { id: CoreBlockType })[] {
  return CORE_BLOCK_TYPES.filter(id => CORE_BLOCK_DETAILS[id].catalogueOrder !== null)
    .map(id => ({ id, ...CORE_BLOCK_DETAILS[id] }))
    .sort((a, b) => a.catalogueOrder! - b.catalogueOrder!)
}
