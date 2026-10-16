import type { TablePreset } from '../lib/tables'

export function TablePresetPicker({ onSelect }: { onSelect: (preset: TablePreset) => void }) {
  return <div className="flex flex-col gap-3">
    <p className="text-sm text-text-muted">Choisis un point de départ pour ta table.</p>
    {([
      ['applications', 'Candidatures', 'Entreprise, poste, statut, dates de candidature et de relance, lien de l’offre.'],
      ['blank', 'Partir de zéro', 'Une table vierge avec une colonne Nom. Ajoute ensuite tes propres colonnes.'],
    ] as const).map(([preset, title, description]) => <button key={preset} type="button" className="p-4 border border-border rounded-lg text-left hover:bg-surface-hover cursor-pointer" onClick={() => onSelect(preset)}><span className="block font-semibold text-sm">{title}</span><span className="block text-xs text-text-muted mt-1">{description}</span></button>)}
  </div>
}
