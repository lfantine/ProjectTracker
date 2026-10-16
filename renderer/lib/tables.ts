import type { ProjectModule, TableConfig } from './types'

export function createApplicationTable(): TableConfig {
  return {
    columns: [
      { id: 'company', label: 'Entreprise', type: 'text' },
      { id: 'role', label: 'Poste', type: 'text' },
      { id: 'status', label: 'Statut', type: 'select', options: ['À postuler', 'Envoyée', 'Entretien', 'Offre', 'Refus', 'Retirée'] },
      { id: 'applied', label: 'Date de candidature', type: 'date' },
      { id: 'followup', label: 'Prochaine relance', type: 'date' },
      { id: 'url', label: 'Offre', type: 'url' },
    ],
    rows: [],
  }
}

export function safeTableUrl(value: string): string | undefined {
  const input = value.trim()
  if (!input || (/^[a-z][a-z\d+.-]*:/i.test(input) && !/^https?:\/\//i.test(input))) return undefined
  try {
    const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`)
    return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined
  } catch { return undefined }
}

export type TablePreset = 'applications' | 'blank'

export function createTableModule(id: string, preset: TablePreset): ProjectModule {
  return { id, type: 'table', customize_title: true, title: preset === 'applications' ? 'Candidatures' : 'Table', table: preset === 'applications' ? createApplicationTable() : { columns: [{ id: 'name', label: 'Nom', type: 'text' }], rows: [] } }
}
