// Rights a package can request. Its own storage and instances are implicit but
// partitioned; everything else must be declared and granted.

export const CORE_RESOURCES = ['projects', 'notes', 'errors'] as const
export type CoreResource = (typeof CORE_RESOURCES)[number]
export const CORE_ACTIONS = ['read', 'write'] as const
export type CoreAction = (typeof CORE_ACTIONS)[number]

export interface ExportGrant {
  package: string
  export: string
}

export interface PermissionSet {
  core: Partial<Record<CoreResource, CoreAction[]>>
  // Exact HTTPS origins ("https://api.example.com" or with an explicit port).
  network: string[]
  // Read-only access to data explicitly exported by another package.
  exports: ExportGrant[]
}

export function emptyPermissions(): PermissionSet {
  return { core: {}, network: [], exports: [] }
}

const HOSTNAME_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/

// Manifest-level validation of a network origin. Runtime checks (DNS
// resolution, private ranges, redirects) are performed again by the host
// service at connection time.
export function validateNetworkOrigin(value: string): string | null {
  if (typeof value !== 'string' || !value) return 'origine vide'
  if (value.includes('*')) return 'joker interdit'
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'URL invalide'
  }
  if (url.protocol !== 'https:') return 'seul HTTPS est autorisé'
  if (url.username || url.password) return 'identifiants interdits dans l’origine'
  if (url.pathname !== '/' || url.search || url.hash) return 'une origine ne contient ni chemin, ni requête, ni fragment'
  if (value.endsWith('/')) return 'une origine ne se termine pas par /'
  const host = url.hostname
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return 'hôte local interdit'
  if (/^[\d.]+$/.test(host) || host.startsWith('[')) return 'adresse IP littérale interdite'
  const labels = host.split('.')
  if (labels.length < 2 || !labels.every((label) => HOSTNAME_LABEL.test(label))) return 'nom d’hôte invalide'
  if (url.origin !== value) return 'origine non canonique (minuscules, port par défaut omis)'
  return null
}

export function normalizePermissions(raw: Partial<PermissionSet> | undefined): PermissionSet {
  const core: PermissionSet['core'] = {}
  for (const resource of CORE_RESOURCES) {
    const actions = raw?.core?.[resource]
    if (actions?.length) core[resource] = CORE_ACTIONS.filter((action) => actions.includes(action))
  }
  const network = [...new Set(raw?.network ?? [])].sort()
  const exportKeys = new Set<string>()
  const exports: ExportGrant[] = []
  for (const grant of raw?.exports ?? []) {
    const key = `${grant.package}\u0000${grant.export}`
    if (exportKeys.has(key)) continue
    exportKeys.add(key)
    exports.push({ package: grant.package, export: grant.export })
  }
  exports.sort((a, b) => a.package.localeCompare(b.package) || a.export.localeCompare(b.export))
  return { core, network, exports }
}

export function hasCorePermission(set: PermissionSet, resource: CoreResource, action: CoreAction): boolean {
  return !!set.core[resource]?.includes(action)
}

export function hasExportPermission(set: PermissionSet, packageId: string, exportId: string): boolean {
  return set.exports.some((grant) => grant.package === packageId && grant.export === exportId)
}

// Rights present in `next` but not in `granted`. A non-empty result means an
// update widens the rights and needs a new user confirmation.
export function addedPermissions(granted: PermissionSet, next: PermissionSet): PermissionSet {
  const core: PermissionSet['core'] = {}
  for (const resource of CORE_RESOURCES) {
    const added = (next.core[resource] ?? []).filter((action) => !granted.core[resource]?.includes(action))
    if (added.length) core[resource] = added
  }
  return {
    core,
    network: next.network.filter((origin) => !granted.network.includes(origin)),
    exports: next.exports.filter((grant) => !hasExportPermission(granted, grant.package, grant.export)),
  }
}

export function isEmptyPermissionSet(set: PermissionSet): boolean {
  return !Object.keys(set.core).length && !set.network.length && !set.exports.length
}

const RESOURCE_LABEL: Record<CoreResource, string> = { projects: 'projets', notes: 'notes', errors: 'erreurs' }
const ACTION_LABEL: Record<CoreAction, string> = { read: 'Lire', write: 'Modifier' }

// Human-readable list for confirmation dialogs. Not overridable by themes.
export function describePermissions(set: PermissionSet): string[] {
  const lines: string[] = []
  for (const resource of CORE_RESOURCES) {
    for (const action of set.core[resource] ?? []) lines.push(`${ACTION_LABEL[action]} les ${RESOURCE_LABEL[resource]}`)
  }
  for (const origin of set.network) lines.push(`Contacter ${origin}`)
  for (const grant of set.exports) lines.push(`Lire l’export « ${grant.export} » de ${grant.package}`)
  return lines
}
