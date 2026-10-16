import { useEffect, useState } from 'react'
import { useData } from '../lib/store'
import { useDraft } from '../lib/useDraft'
import { TestPanel } from '../components/TestPanel'
import { AppShell } from '../components/AppShell'
import { useTheme } from '../lib/theme'
import type { MigrationReportSummary } from '../../main/preload'
import type { ThemeMode } from '../lib/types'
import { FolderOpenIcon, TerminalIcon } from '../components/icons'

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'Système' },
  { value: 'light', label: 'Clair' },
  { value: 'dark', label: 'Sombre' },
]

export default function SettingsPage() {
  const { themeMode, setThemeMode } = useTheme()
  const [dataDir, setDataDir] = useState('')
  const { settings, updateSettings, status, retryStartup } = useData()
  const aiCommand = useDraft(settings.aiCommand, (value) => updateSettings({ aiCommand: value }))
  const [operationMessage, setOperationMessage] = useState('')
  const [safeMode, setSafeMode] = useState(false)
  const [diagnostics, setDiagnostics] = useState<Record<string, string | null>[]>([])
  useEffect(() => { window.api.core.safeMode().then(setSafeMode).catch(() => {}) }, [])
  const [report, setReport] = useState<MigrationReportSummary | null>(null)
  useEffect(() => {
    let active = true
    window.api.core.report().then((value) => { if (active) setReport(value) }).catch(() => {})
    return () => { active = false }
  }, [status])

  useEffect(() => {
    window.api.getDataDir().then(setDataDir)
  }, [])

  async function saveRecoveryCopy(kind: 'backup' | 'export') {
    try {
      const result = await (kind === 'backup' ? window.api.core.backup() : window.api.core.exportJson())
      setOperationMessage(result.ok ? `Créé : ${result.value.name}` : result.error.message)
    } catch { setOperationMessage('L’opération a échoué.') }
  }

  return (
    <AppShell title="Réglages">
      <div className="mx-auto w-full max-w-3xl">
      {status?.mode === 'recovery' && <div role="alert" className="mb-5">
        <p>{status.message}</p>
        <button type="button" onClick={() => void retryStartup()}>Réessayer le démarrage</button>
      </div>}
      <div className="pb-7">
        <h3 className="text-[15px] font-bold mb-3.5">Thème</h3>
        <div className="flex flex-wrap gap-2">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setThemeMode(opt.value)}
              className={`text-sm font-semibold px-3.5 py-2 rounded-lg border cursor-pointer ${
                themeMode === opt.value
                  ? 'border-accent bg-accent-soft text-accent-soft-text'
                  : 'border-border bg-transparent text-text'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-border py-7">
        <h3 className="text-[15px] font-bold mb-3.5">Données</h3>
        <p className="text-[12.5px] text-text-muted mb-2">
          Toutes tes données (projets, notes, erreurs) sont stockées localement sur ta machine.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <code className="font-mono text-[12.5px] px-2.5 py-1.5 rounded-md border border-border bg-bg text-text-muted flex-1 min-w-0 break-all">
            {dataDir || '…'}
          </code>
          <button
            type="button"
            onClick={() => dataDir && window.api.revealInFinder(dataDir)}
            className="flex items-center gap-1.5 border border-border bg-surface2 text-text-muted text-[12.5px] font-semibold px-3 py-1.5 rounded-md cursor-pointer"
          >
            <FolderOpenIcon size={14} /> Ouvrir dans le Finder
          </button>
        </div>
      </div>

      <details className="py-3">
        <summary onClick={() => void window.api.core.diagnostics().then(result => { if (result.ok) setDiagnostics(result.value) }).catch(() => {})}>Diagnostic technique (200 dernières entrées)</summary>
        <p>Aucun contenu métier, message libre ni secret n’est inclus dans cet export.</p>
        {diagnostics.map((entry, index) => <p key={index}>{entry.at} · {entry.scope} · {entry.code} · {entry.package_id}</p>)}
        <button type="button" disabled={status?.mode !== 'ready'} onClick={() => void window.api.core.exportDiagnostics().then(result => setOperationMessage(result.ok ? `Créé dans logs/ : ${result.value.name}` : result.error.message)).catch(() => setOperationMessage('Diagnostic indisponible.'))}>Exporter le diagnostic technique</button>
      </details>
      {report && <details className="py-3">
        <summary>Rapport de migration : {report.status === 'succeeded' ? 'terminée' : 'à reprendre'}</summary>
        <p>{report.unresolved} référence(s) à vérifier · {report.archived.length} valeur(s) conservée(s) dans les archives.</p>
        {report.blocking.map((entry, index) => <p key={index}>{entry.location} : {entry.message}</p>)}
        <p>Les rapports détaillés et les sources originales sont conservés dans le dossier de données.</p>
      </details>}
      <div className="py-3">
        {safeMode && <p role="status">Mode sans tiers : aucun package ni thème externe n’est exécuté.</p>}
        <button type="button" onClick={() => void window.api.core.restartSafe()}>Redémarrer sans tiers</button>
        <button type="button" onClick={() => void window.api.core.restore().then(result => setOperationMessage(result.ok ? result.value.name : result.error.message)).catch(() => setOperationMessage('Restauration indisponible.'))}>Restaurer une sauvegarde…</button>
        <p>La restauration remplace les données sans fusion et conserve l’état précédent. Les fichiers externes liés aux projets ne sont pas inclus.</p>
      </div>
      <div className="flex gap-3 py-4">
        <button type="button" disabled={status?.mode !== 'ready'} onClick={() => void saveRecoveryCopy('backup')}>Sauvegarder la base</button>
        <button type="button" disabled={status?.mode !== 'ready'} onClick={() => void saveRecoveryCopy('export')}>Exporter en JSON</button>
        <p role="status">{operationMessage}</p>
      </div>
      <div className="border-t border-border py-7">
        <h3 className="text-[15px] font-bold mb-3.5">Intelligence artificielle</h3>
        <p className="text-[12.5px] text-text-muted mb-2">
          Les fonctionnalités IA (création assistée, réécriture de notes…) appellent ce programme en
          ligne de commande avec <code>--request</code> (et parfois <code>--format</code>) et lisent sa
          réponse sur la sortie standard. Choisis l’exécutable à utiliser, ou renseigne son nom s’il est
          disponible dans le PATH.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={aiCommand.value}
            onChange={(e) => aiCommand.change(e.target.value)}
            onBlur={() => void aiCommand.flush()}
            placeholder="groqtool"
            className="font-mono text-[12.5px] px-2.5 py-1.5 rounded-md border border-border bg-bg text-text flex-1"
            style={{ minWidth: 140 }}
          />
          <button
            type="button"
            onClick={async () => {
              const chosen = await window.api.chooseFile()
              if (chosen) aiCommand.change(chosen)
            }}
            className="flex items-center gap-1.5 border border-border bg-surface2 text-text-muted text-[12.5px] font-semibold px-3 py-1.5 rounded-md cursor-pointer"
          >
            <TerminalIcon size={14} /> Choisir un programme
          </button>
        </div>
      </div>
      <TestPanel />
      </div>
    </AppShell>
  )
}
