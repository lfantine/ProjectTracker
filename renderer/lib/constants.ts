import type {
  ChecklistStatus,
  ChecklistType,
  ModuleType,
  ProjectStatus,
  ProjectType,
  TaskStatus,
} from './types'

// Max number of modules of a given type allowed in a project's layout at once.
// A type with no entry here has no limit.
export const MODULE_MAX_INSTANCES: Partial<Record<ModuleType, number>> = {
  stack: 1,
  deadlines: 2,
}

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  actif: 'Actif',
  pause: 'En pause',
  termine: 'Terminé',
  aborted: 'Annulé',
}
export const PROJECT_STATUS_ORDER: ProjectStatus[] = ['actif', 'pause', 'termine', 'aborted']

export const PROJECT_TYPE_LABEL: Record<ProjectType, string> = {
  dev: 'Développement',
  video: 'Vidéo',
}
export const PROJECT_TYPE_ORDER: ProjectType[] = ['dev', 'video']

export { TASK_STATUS_ORDER } from '../../shared/tasks'
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  a_faire: 'À faire',
  en_cours: 'En cours',
  fait: 'Fait',
}

export const CHK_TYPE_LABEL: Record<ChecklistType, string> = {
  generique: 'Générique',
  materiel: 'Achat',
  projet: 'Projet requis',
  evenement: 'Événement',
}

export const CHK_GROUP_LABEL: Record<ChecklistType, string> = {
  materiel: 'Achats',
  evenement: 'Événements',
  projet: 'Projets requis',
  generique: 'Autres',
}

// Status pipeline differs by element type: a purchase isn't "à faire/fait",
// it's "à acheter/commandé/acheté", an event is "à venir/fait/annulé", etc.
export { CHK_STATUS_BY_TYPE, defaultChecklistStatus, nextChecklistStatus } from '../../shared/checklist'

export const CHK_STATUS_LABEL: Record<ChecklistStatus, string> = {
  a_faire: 'À faire',
  en_cours: 'En cours',
  fait: 'Fait',
  bloque: 'Bloqué',
  a_acheter: 'À acheter',
  commande: 'Commandé',
  achete: 'Acheté',
  a_venir: 'À venir',
  annule: 'Annulé',
  en_attente: 'En attente',
  pret: 'Prêt',
}

export type StatusTone = 'success' | 'warning' | 'danger' | 'neutral'

export function statusTone(status: string): StatusTone {
  if (
    status === 'actif' ||
    status === 'fait' ||
    status === 'a_venir' ||
    status === 'achete' ||
    status === 'pret'
  )
    return 'success'
  if (
    status === 'pause' ||
    status === 'en_cours' ||
    status === 'bloque' ||
    status === 'commande' ||
    status === 'en_attente'
  )
    return 'warning'
  if (status === 'depasse' || status === 'annule' || status === 'aborted') return 'danger'
  return 'neutral'
}
