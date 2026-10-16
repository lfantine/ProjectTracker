import { useState } from 'react'
import { AppShell } from '../components/AppShell'
import { CoreMarketplace } from '../components/CoreMarketplace'
import { PackageMarketplace } from '../components/PackageMarketplace'

const TABS = [['packages', 'Modules à installer'], ['core', 'Modules intégrés']] as const

export default function MarketplacePage() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('packages')
  return <AppShell title="Marketplace">
    <div role="tablist" aria-label="Catalogues" className="flex gap-1 mb-6 border-b border-border">
      {TABS.map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}
        className={`bg-transparent text-[13.5px] font-semibold px-3.5 py-2.5 -mb-px cursor-pointer transition ${tab === value ? 'text-text' : 'text-text-muted hover:text-text'}`}
        style={{ border: 0, borderBottom: `2px solid ${tab === value ? 'var(--tracker-accent)' : 'transparent'}` }}>{label}</button>)}
    </div>
    {tab === 'core' ? <CoreMarketplace /> : <PackageMarketplace />}
  </AppShell>
}
