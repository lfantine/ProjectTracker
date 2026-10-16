import type { Manifest, ContributionType } from './manifest'
export interface MarketplaceFilter { query: string; contributions: ContributionType[]; extensionType?: 'theme' | 'features'; target?: string }
export function matchesMarketplace(manifest: Manifest, filter: MarketplaceFilter): boolean {
  const text = [manifest.id, manifest.name, manifest.description, manifest.author, ...(manifest.kind === 'package' ? manifest.contributions.flatMap(item => [item.name, item.id, item.description]) : manifest.extensionType === 'features' ? manifest.features.flatMap(item => [item.name, item.description]) : [])].filter(Boolean).join(' ').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
  const query = filter.query.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim()
  if (query && !query.split(/\s+/).every(word => text.includes(word))) return false
  if (manifest.kind === 'extension') return (!filter.extensionType || manifest.extensionType === filter.extensionType) && (!filter.target || manifest.target.package === filter.target) && !filter.contributions.length
  return !filter.extensionType && !filter.target && (!filter.contributions.length || manifest.contributions.some(item => filter.contributions.includes(item.type)))
}
