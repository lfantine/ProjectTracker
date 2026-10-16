import type { ChecklistItem, ChecklistStatus, ChecklistType } from './domain'

// Checklist status cycles, shared by the renderer and main-process commands.

export const CHK_STATUS_BY_TYPE: Record<ChecklistType, ChecklistStatus[]> = {
  generique: ['a_faire', 'en_cours', 'fait', 'bloque'],
  materiel: ['a_acheter', 'commande', 'achete'],
  evenement: ['a_venir', 'fait', 'annule'],
  projet: ['en_attente', 'pret', 'bloque'],
}


export function defaultChecklistStatus(type: ChecklistType): ChecklistStatus {
  return CHK_STATUS_BY_TYPE[type][0]
}

export function nextChecklistStatus(item: Pick<ChecklistItem, 'type' | 'status'>): ChecklistStatus {
  const order = CHK_STATUS_BY_TYPE[item.type]
  const idx = order.indexOf(item.status)
  return order[(idx + 1) % order.length]
}
