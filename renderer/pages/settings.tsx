import { useEffect, useState } from 'react'
import { AppShell } from '../components/AppShell'
import { useTheme } from '../lib/theme'
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
  const [aiCommand, setAiCommand] = useState('')

  useEffect(() => {
    window.api.getDataDir().then(setDataDir)
    window.api.getSettings().then((settings) => setAiCommand(settings.aiCommand))
  }, [])

  function saveAiCommand(value: string) {
    setAiCommand(value)
    window.api.setSettings({ aiCommand: value })
  }

  return (
    <AppShell title="Réglages">
      <div className="bg-surface border border-border rounded-xl p-5 mb-4" style={{ maxWidth: 560 }}>
        <h3 className="text-[15px] font-bold mb-3.5">Thème</h3>
        <div className="flex gap-2">
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

      <div className="bg-surface border border-border rounded-xl p-5" style={{ maxWidth: 560 }}>
        <h3 className="text-[15px] font-bold mb-3.5">Données</h3>
        <p className="text-[12.5px] text-text-muted mb-2">
          Toutes tes données (projets, notes, erreurs) sont stockées localement sur ta machine.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <code className="font-mono text-[12.5px] px-2.5 py-1.5 rounded-md border border-border bg-bg text-text-muted flex-1">
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

      <div className="bg-surface border border-border rounded-xl p-5 mt-4" style={{ maxWidth: 560 }}>
        <h3 className="text-[15px] font-bold mb-3.5">Intelligence artificielle</h3>
        <p className="text-[12.5px] text-text-muted mb-2">
          Les fonctionnalités IA (création assistée, réécriture de notes…) appellent ce programme en
          ligne de commande avec <code>--request</code> (et parfois <code>--format</code>) et lisent sa
          réponse sur la sortie standard. Choisis l’exécutable à utiliser, ou renseigne son nom s’il est
          disponible dans le PATH.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={aiCommand}
            onChange={(e) => saveAiCommand(e.target.value)}
            placeholder="groqtool"
            className="font-mono text-[12.5px] px-2.5 py-1.5 rounded-md border border-border bg-bg text-text flex-1"
            style={{ minWidth: 140 }}
          />
          <button
            type="button"
            onClick={async () => {
              const chosen = await window.api.chooseFile()
              if (chosen) saveAiCommand(chosen)
            }}
            className="flex items-center gap-1.5 border border-border bg-surface2 text-text-muted text-[12.5px] font-semibold px-3 py-1.5 rounded-md cursor-pointer"
          >
            <TerminalIcon size={14} /> Choisir un programme
          </button>
        </div>
      </div>
    </AppShell>
  )
}
