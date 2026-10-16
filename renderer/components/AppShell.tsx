import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Head from 'next/head'
import { useRouter } from 'next/router'
import { CommandPalette } from './CommandPalette'
import { CreateWithAiModal } from './CreateWithAiModal'
import { SearchIcon, SparklesIcon } from './icons'

// The sidebar itself lives in _app.tsx so it stays mounted across page
// navigations (its collapse state would otherwise reset — and re-animate —
// every time a page component remounts).
export function AppShell({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  const router = useRouter()
  const contentRef = useRef<HTMLDivElement>(null)
  const scrollKey = router.pathname === '/project' && typeof router.query.id === 'string' ? `tracker_scroll_${router.query.id}` : null
  const aiTargetId = typeof router.query.id === 'string' && ['/project', '/notes/detail'].includes(router.pathname) ? router.query.id : router.pathname === '/errors' && typeof router.query.open === 'string' ? router.query.open : undefined
  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content || !scrollKey) return
    try { content.scrollTop = Number(window.sessionStorage.getItem(scrollKey)) || 0 } catch {}
    return () => { try { window.sessionStorage.setItem(scrollKey, String(content.scrollTop)) } catch {} }
  }, [scrollKey])
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [aiModalOpen, setAiModalOpen] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
      if (e.key === 'Escape') setPaletteOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <main className="flex-1 flex flex-col min-w-0 min-h-0 h-full">
      <Head>
        <title>{`${title} · amber`}</title>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <meta name="application-name" content="amber" />
      </Head>
      <div className="flex items-center justify-between px-8 py-[18px] border-b border-border flex-shrink-0">
        <h1 className="text-[20px] font-bold">{title}</h1>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            title="Rechercher ou saisir un prompt pour l’IA (Ctrl K / ⌘K)"
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-surface2 text-text-muted cursor-pointer text-[13px]"
          >
            <SearchIcon size={15} />
            Rechercher…
            <kbd className="font-mono text-[10.5px] bg-bg border border-border rounded px-1 py-0.5 text-text-faint">
              Ctrl K
            </kbd>
          </button>
          <button
            type="button"
            aria-label="Créer ou modifier avec l’IA"
            title="Créer ou modifier avec l’IA"
            onClick={() => { setPaletteOpen(false); setAiModalOpen(true) }}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface2 text-text-muted cursor-pointer hover:bg-surface-hover transition-colors focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          >
            <SparklesIcon size={16} />
          </button>
        </div>
      </div>
      <div data-page-scroll ref={contentRef} className="flex-1 overflow-auto px-8 pt-7 pb-16">{children}</div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} initialTargetId={aiTargetId} />

      <CreateWithAiModal initialTargetId={aiTargetId} open={aiModalOpen} onClose={() => setAiModalOpen(false)} />
    </main>
  )
}
