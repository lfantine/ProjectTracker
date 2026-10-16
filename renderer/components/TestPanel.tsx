import { useState } from 'react'
import { runSimpleChecks, type CheckResult } from '../lib/simpleChecks'
export function TestPanel() {
  const [results, setResults] = useState<CheckResult[] | null>(null)
  return <section className="border-t border-border pt-7">
    <h3 className="text-[15px] font-bold mb-3">Tests simples</h3>
    <p className="text-sm text-text-muted mb-3">Vérifie la logique des onglets et les horaires de l’agenda. Ces vérifications intégrées ne modifient pas tes données. La suite Vitest et les tests d’interface se lancent depuis le projet.</p>
    <button type="button" className="bg-accent text-accent-text px-4 py-2 rounded-lg cursor-pointer" onClick={() => setResults(runSimpleChecks())}>Lancer les tests</button>
    {results && <div aria-live="polite" className="mt-4">
      <p className="font-semibold text-sm mb-2">{results.filter((r) => r.passed).length} / {results.length} tests réussis</p>
      {results.map((result) => <div key={result.name} className="border-t border-border py-2 text-sm"><span className={result.passed ? 'text-success' : 'text-danger'}>{result.passed ? 'Réussi' : 'Échoué'}</span> · {result.category}<p>{result.name}</p><p className="text-xs text-text-muted">{result.detail}</p></div>)}
    </div>}
  </section>
}
