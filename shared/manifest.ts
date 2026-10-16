import { z } from 'zod'
import semverValid from 'semver/functions/valid'
import validRange from 'semver/ranges/valid'
import { CORE_PACKAGE_ID, MAX_ID_LENGTH, PACKAGE_ID_PATTERN } from './ids'
import { CORE_ACTIONS, CORE_RESOURCES, validateNetworkOrigin } from './permissions'
import { HOST_ICONS, MANIFEST_VERSION } from './version'

// Manifest contract, version 1. This module is the executable reference: the
// published JSON Schema (shared/schema/manifest.schema.json) is generated from
// the structural part, and validateManifest() adds the cross-field rules
// documented in docs/packages/FORMAT.md.

const id = z.string().max(MAX_ID_LENGTH).regex(PACKAGE_ID_PATTERN, 'identifiant invalide (minuscules, chiffres, points, tirets)')
const label = (max: number) => z.string().trim().min(1).max(max)
const intVersion = z.number().int().min(1).max(1_000_000)
const semverString = z.string().max(64).refine((value) => semverValid(value) === value, 'version SemVer invalide')
const semverRange = z.string().max(128).refine((value) => validRange(value) !== null, 'contrainte SemVer invalide')

// Archive-relative path to a file. Separators are "/", no absolute path, no
// "." / ".." segment, no backslash, no NUL. Existence is checked separately.
export function isSafeRelativePath(value: string): boolean {
  if (!value || value.length > 512 || value.startsWith('/') || value.includes('\\') || value.includes('\u0000')) return false
  if (/^[a-zA-Z]:/.test(value)) return false
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}
const relativePath = (extensions: string[]) =>
  z
    .string()
    .refine(isSafeRelativePath, 'chemin relatif invalide')
    .refine((value) => extensions.some((ext) => value.toLowerCase().endsWith(ext)), `extension attendue : ${extensions.join(', ')}`)

const gridSize = z.strictObject({ w: z.number().int().min(1).max(12), h: z.number().int().min(1).max(24) })

const configFieldBase = { key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/), label: label(80), help: z.string().max(300).optional() }
const configField = z.discriminatedUnion('type', [
  z.strictObject({ ...configFieldBase, type: z.literal('string'), default: z.string().max(10_000).optional(), maxLength: z.number().int().min(1).max(10_000).optional(), multiline: z.boolean().optional() }),
  z.strictObject({ ...configFieldBase, type: z.literal('number'), default: z.number().finite().optional(), min: z.number().finite().optional(), max: z.number().finite().optional(), integer: z.boolean().optional() }),
  z.strictObject({ ...configFieldBase, type: z.literal('boolean'), default: z.boolean().optional() }),
  z.strictObject({
    ...configFieldBase,
    type: z.literal('choice'),
    options: z.array(z.strictObject({ value: z.string().min(1).max(64), label: label(80) })).min(1).max(50),
    default: z.string().max(64).optional(),
  }),
  z.strictObject({ ...configFieldBase, type: z.literal('list'), item: z.enum(['string', 'number']), maxItems: z.number().int().min(1).max(200).optional(), default: z.array(z.union([z.string().max(1000), z.number().finite()])).max(200).optional() }),
])
export const configSchemaSchema = z.strictObject({
  version: intVersion,
  fields: z.array(configField).max(50),
  // The contribution provides its own settings UI inside its isolated frame.
  customUi: z.boolean().optional(),
})

const contributionBase = {
  id,
  name: label(80),
  description: z.string().max(500).optional(),
  entry: relativePath(['.html']),
  icon: z.enum(HOST_ICONS).optional(),
  config: configSchemaSchema.optional(),
}
const majorContribution = z.strictObject({
  ...contributionBase,
  type: z.literal('major'),
  // Local ids of the minors and widgets consuming this major's instances.
  // Must be present, possibly empty, to make the association explicit.
  integrations: z.array(id).max(50),
  // Label of one instance ("Semaine", "Tableau"...), for host dialogs.
  instanceLabel: label(40).optional(),
  // Native deletion invariant; omitted means zero. Does not seed instances.
  minInstances: z.number().int().min(0).max(100).optional(),
})
const minorContribution = z.strictObject({
  ...contributionBase,
  type: z.literal('minor'),
  // Local id of the major whose instances this block consumes; absent for an
  // independent block.
  major: id.optional(),
})
const widgetContribution = z.strictObject({
  ...contributionBase,
  type: z.literal('widget'),
  major: id.optional(),
  size: z.strictObject({ default: gridSize, min: gridSize.optional(), max: gridSize.optional() }),
})
export const contributionSchema = z.discriminatedUnion('type', [majorContribution, minorContribution, widgetContribution])

const permissionsSchema = z.strictObject({
  core: z.partialRecord(z.enum(CORE_RESOURCES), z.array(z.enum(CORE_ACTIONS)).max(2)).optional(),
  network: z.array(z.string().max(300)).max(50).optional(),
  exports: z.array(z.strictObject({ package: id, export: id })).max(50).optional(),
})

const exportSchema = z.strictObject({
  id,
  version: intVersion,
  description: z.string().max(500).optional(),
  // Private storage collections made readable to consumers.
  collections: z.array(id).min(1).max(20),
  // "instance": documents are read for one resolved instance of `major`.
  scope: z.enum(['instance', 'package']),
  major: id.optional(),
})

const slotSchema = z.strictObject({
  id,
  version: intVersion,
  // Major contribution hosting this slot.
  contribution: id,
  description: z.string().max(500).optional(),
})

const migrationsSchema = z.strictObject({
  entry: relativePath(['.html']),
  // Each listed value N is a step N -> N+1.
  steps: z.array(intVersion).min(1).max(1000),
})

const baseFields = {
  manifestVersion: z.literal(MANIFEST_VERSION),
  id,
  name: label(80),
  description: z.string().max(2000).optional(),
  logo: relativePath(['.png']).optional(),
  author: label(120),
  version: semverString,
  hostApi: semverRange,
  dependencies: z.record(id, semverRange),
  permissions: permissionsSchema,
  storageVersion: intVersion,
  migrations: migrationsSchema.optional(),
  homepage: z.string().max(300).optional(),
}

const packageManifestSchema = z.strictObject({
  ...baseFields,
  kind: z.literal('package'),
  contributions: z.array(contributionSchema).min(1).max(100),
  exports: z.array(exportSchema).max(50).optional(),
  slots: z.array(slotSchema).max(50).optional(),
})

const extensionBase = {
  ...baseFields,
  kind: z.literal('extension'),
  target: z.strictObject({ package: id, version: semverRange }),
}
const themeExtensionSchema = z.strictObject({
  ...extensionBase,
  extensionType: z.literal('theme'),
  // Data file (JSON) — never JavaScript executed by the host.
  theme: relativePath(['.json']),
})
const featuresExtensionSchema = z.strictObject({
  ...extensionBase,
  extensionType: z.literal('features'),
  features: z
    .array(
      z.strictObject({
        id,
        name: label(80),
        description: z.string().max(500).optional(),
        slot: z.strictObject({ id, version: intVersion }),
        entry: relativePath(['.html']),
      })
    )
    .min(1)
    .max(50),
})

export const manifestSchema = z.union([
  packageManifestSchema,
  z.discriminatedUnion('extensionType', [themeExtensionSchema, featuresExtensionSchema]),
])

export type Manifest = z.infer<typeof manifestSchema>
export type PackageManifest = z.infer<typeof packageManifestSchema>
export type ThemeExtensionManifest = z.infer<typeof themeExtensionSchema>
export type FeaturesExtensionManifest = z.infer<typeof featuresExtensionSchema>
export type ExtensionManifest = ThemeExtensionManifest | FeaturesExtensionManifest
export type Contribution = z.infer<typeof contributionSchema>
export type ContributionType = Contribution['type']
export type ConfigSchema = z.infer<typeof configSchemaSchema>
export type ConfigField = ConfigSchema['fields'][number]
export type ManifestExport = z.infer<typeof exportSchema>
export type ManifestSlot = z.infer<typeof slotSchema>

export interface ManifestIssue {
  path: string
  message: string
}

export type ManifestValidation = { ok: true; manifest: Manifest } | { ok: false; issues: ManifestIssue[] }

function formatPath(path: readonly PropertyKey[]): string {
  return path.map((part) => (typeof part === 'number' ? `[${part}]` : `.${String(part)}`)).join('').replace(/^\./, '') || '(racine)'
}

function semanticIssues(manifest: Manifest): ManifestIssue[] {
  const issues: ManifestIssue[] = []
  const add = (path: string, message: string) => issues.push({ path, message })

  if (manifest.id === CORE_PACKAGE_ID) add('id', 'identité réservée au socle')
  for (const dependency of Object.keys(manifest.dependencies)) {
    if (dependency === manifest.id) add(`dependencies.${dependency}`, 'un package ne dépend pas de lui-même')
  }

  const permissions = manifest.permissions
  for (const [resource, actions] of Object.entries(permissions.core ?? {})) {
    if (new Set(actions).size !== actions.length) add(`permissions.core.${resource}`, 'action répétée')
  }
  permissions.network?.forEach((origin, index) => {
    const problem = validateNetworkOrigin(origin)
    if (problem) add(`permissions.network[${index}]`, problem)
  })
  if (permissions.network && new Set(permissions.network).size !== permissions.network.length) add('permissions.network', 'origine répétée')
  permissions.exports?.forEach((grant, index) => {
    if (grant.package === manifest.id) add(`permissions.exports[${index}]`, 'l’accès à ses propres données est implicite')
    else if (!(grant.package in manifest.dependencies) && !(manifest.kind === 'extension' && manifest.target.package === grant.package)) {
      add(`permissions.exports[${index}]`, 'le package fournisseur doit être déclaré en dépendance')
    }
  })

  if (manifest.migrations) {
    const steps = manifest.migrations.steps
    if (new Set(steps).size !== steps.length) add('migrations.steps', 'étape répétée')
    steps.forEach((step, index) => {
      if (step >= manifest.storageVersion) add(`migrations.steps[${index}]`, 'étape au-delà de storageVersion')
    })
  }

  if (manifest.kind === 'package') {
    const byId = new Map<string, Contribution>()
    manifest.contributions.forEach((contribution, index) => {
      if (byId.has(contribution.id)) add(`contributions[${index}].id`, 'identifiant de contribution répété')
      byId.set(contribution.id, contribution)
    })
    const claimedBy = new Map<string, string>()
    manifest.contributions.forEach((contribution, index) => {
      const at = `contributions[${index}]`
      if (contribution.type === 'major') {
        if (new Set(contribution.integrations).size !== contribution.integrations.length) add(`${at}.integrations`, 'intégration répétée')
        contribution.integrations.forEach((integration, position) => {
          const target = byId.get(integration)
          if (!target) {
            add(`${at}.integrations[${position}]`, `contribution « ${integration} » inconnue`)
            return
          }
          if (target.type === 'major') {
            add(`${at}.integrations[${position}]`, 'un majeur ne peut intégrer qu’un mineur ou un widget')
            return
          }
          if (target.major !== contribution.id) add(`${at}.integrations[${position}]`, `« ${integration} » doit déclarer major: « ${contribution.id} »`)
          const previous = claimedBy.get(integration)
          if (previous && previous !== contribution.id) add(`${at}.integrations[${position}]`, `« ${integration} » est déjà intégré par « ${previous} »`)
          claimedBy.set(integration, contribution.id)
        })
      } else if (contribution.major !== undefined) {
        const major = byId.get(contribution.major)
        if (!major || major.type !== 'major') add(`${at}.major`, `majeur « ${contribution.major} » inconnu`)
        else if (!major.integrations.includes(contribution.id)) add(`${at}.major`, `« ${contribution.major} » doit lister « ${contribution.id} » dans integrations`)
      }
      if (contribution.type === 'widget') {
        const { default: size, min, max } = contribution.size
        if (min && (size.w < min.w || size.h < min.h)) add(`${at}.size`, 'taille par défaut inférieure au minimum')
        if (max && (size.w > max.w || size.h > max.h)) add(`${at}.size`, 'taille par défaut supérieure au maximum')
        if (min && max && (min.w > max.w || min.h > max.h)) add(`${at}.size`, 'minimum supérieur au maximum')
      }
      if (contribution.config) {
        const keys = contribution.config.fields.map((field) => field.key)
        if (new Set(keys).size !== keys.length) add(`${at}.config.fields`, 'clé de configuration répétée')
        contribution.config.fields.forEach((field, position) => {
          if (field.type === 'choice' && field.default !== undefined && !field.options.some((option) => option.value === field.default)) {
            add(`${at}.config.fields[${position}].default`, 'valeur par défaut absente des choix')
          }
          if (field.type === 'number' && field.min !== undefined && field.max !== undefined && field.min > field.max) {
            add(`${at}.config.fields[${position}]`, 'min supérieur à max')
          }
        })
      }
    })
    const exportIds = new Set<string>()
    manifest.exports?.forEach((entry, index) => {
      if (exportIds.has(entry.id)) add(`exports[${index}].id`, 'export répété')
      exportIds.add(entry.id)
      if (entry.scope === 'instance') {
        const major = entry.major ? byId.get(entry.major) : undefined
        if (!major || major.type !== 'major') add(`exports[${index}].major`, 'un export par instance désigne un majeur du package')
      } else if (entry.major !== undefined) add(`exports[${index}].major`, 'réservé aux exports par instance')
    })
    const slotIds = new Set<string>()
    manifest.slots?.forEach((slot, index) => {
      if (slotIds.has(slot.id)) add(`slots[${index}].id`, 'slot répété')
      slotIds.add(slot.id)
      const host = byId.get(slot.contribution)
      if (!host || host.type !== 'major') add(`slots[${index}].contribution`, 'un slot est porté par un majeur du package')
    })
  } else {
    if (manifest.target.package === manifest.id) add('target.package', 'une extension ne cible pas elle-même')
    const declared = manifest.dependencies[manifest.target.package]
    if (declared !== undefined && declared !== manifest.target.version) add(`dependencies.${manifest.target.package}`, 'contrainte différente de celle de la cible')
    if (manifest.extensionType === 'features') {
      const ids = manifest.features.map((feature) => feature.id)
      if (new Set(ids).size !== ids.length) add('features', 'fonctionnalité répétée')
    }
  }
  return issues
}

// Full validation of a parsed manifest.json value.
export function validateManifest(raw: unknown): ManifestValidation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, issues: [{ path: '(racine)', message: 'objet JSON attendu' }] }
  const candidate = raw as Record<string, unknown>
  // Dispatch explicitly so that authors get the precise failing field instead
  // of a generic union error.
  if (candidate.manifestVersion !== MANIFEST_VERSION) return { ok: false, issues: [{ path: 'manifestVersion', message: `version de format non prise en charge (attendu : ${MANIFEST_VERSION})` }] }
  let schema: z.ZodType<Manifest>
  if (candidate.kind === 'package') schema = packageManifestSchema
  else if (candidate.kind === 'extension') {
    if (candidate.extensionType === 'theme') schema = themeExtensionSchema
    else if (candidate.extensionType === 'features') schema = featuresExtensionSchema
    else return { ok: false, issues: [{ path: 'extensionType', message: 'type d’extension attendu : theme ou features' }] }
  } else return { ok: false, issues: [{ path: 'kind', message: 'nature attendue : package ou extension' }] }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message })) }
  }
  const issues = semanticIssues(parsed.data)
  return issues.length ? { ok: false, issues } : { ok: true, manifest: parsed.data }
}

// Files referenced by the manifest. Used by the installer to check the
// archive content (`files` holds normalised archive paths).
export function referencedFiles(manifest: Manifest): string[] {
  const files: string[] = manifest.logo ? [manifest.logo] : []
  if (manifest.migrations) files.push(manifest.migrations.entry)
  if (manifest.kind === 'package') files.push(...manifest.contributions.map((contribution) => contribution.entry))
  else if (manifest.extensionType === 'theme') files.push(manifest.theme)
  else files.push(...manifest.features.map((feature) => feature.entry))
  return [...new Set(files)]
}

export function missingFiles(manifest: Manifest, files: ReadonlySet<string>): string[] {
  return referencedFiles(manifest).filter((file) => !files.has(file))
}

// Effective dependency graph edge list: the target of an extension counts as a
// mandatory dependency.
export function effectiveDependencies(manifest: Manifest): Record<string, string> {
  if (manifest.kind === 'extension') return { ...manifest.dependencies, [manifest.target.package]: manifest.target.version }
  return { ...manifest.dependencies }
}

// A complete migration chain exists between two storage versions.
export function hasMigrationChain(manifest: Manifest, fromVersion: number): boolean {
  if (fromVersion === manifest.storageVersion) return true
  if (fromVersion > manifest.storageVersion) return false
  const steps = new Set(manifest.migrations?.steps ?? [])
  for (let version = fromVersion; version < manifest.storageVersion; version++) if (!steps.has(version)) return false
  return true
}

export function findContribution(manifest: Manifest, contributionId: string): Contribution | undefined {
  return manifest.kind === 'package' ? manifest.contributions.find((contribution) => contribution.id === contributionId) : undefined
}

// Default configuration values derived from a contribution schema.
export function defaultConfig(schema: ConfigSchema | undefined): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const field of schema?.fields ?? []) if (field.default !== undefined) values[field.key] = field.default
  return values
}

// Host-side validation of a configuration before it is stored.
export function validateConfig(schema: ConfigSchema | undefined, values: unknown): { ok: true; values: Record<string, unknown> } | { ok: false; issues: ManifestIssue[] } {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return { ok: false, issues: [{ path: '(racine)', message: 'objet attendu' }] }
  const input = values as Record<string, unknown>
  if (!schema) return Object.keys(input).length ? { ok: false, issues: [{ path: '(racine)', message: 'aucune configuration déclarée' }] } : { ok: true, values: {} }
  const issues: ManifestIssue[] = []
  const output: Record<string, unknown> = {}
  const known = new Set(schema.fields.map((field) => field.key))
  for (const key of Object.keys(input)) if (!known.has(key) && !schema.customUi) issues.push({ path: key, message: 'champ inconnu' })
  for (const field of schema.fields) {
    const value = input[field.key]
    if (value === undefined) continue
    switch (field.type) {
      case 'string':
        if (typeof value !== 'string' || value.length > (field.maxLength ?? 10_000)) issues.push({ path: field.key, message: 'texte invalide' })
        break
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value) || (field.integer && !Number.isInteger(value)) || (field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)) {
          issues.push({ path: field.key, message: 'nombre invalide' })
        }
        break
      case 'boolean':
        if (typeof value !== 'boolean') issues.push({ path: field.key, message: 'booléen attendu' })
        break
      case 'choice':
        if (typeof value !== 'string' || !field.options.some((option) => option.value === value)) issues.push({ path: field.key, message: 'choix invalide' })
        break
      case 'list':
        if (!Array.isArray(value) || value.length > (field.maxItems ?? 200) || !value.every((item) => typeof item === field.item && (typeof item !== 'number' || Number.isFinite(item)))) {
          issues.push({ path: field.key, message: 'liste invalide' })
        }
        break
    }
    output[field.key] = value
  }
  // Custom UIs may store additional keys; they stay bounded by the document size limit.
  if (schema.customUi) for (const key of Object.keys(input)) if (!known.has(key)) Object.defineProperty(output, key, { value: input[key], enumerable: true, writable: true, configurable: true })
  return issues.length ? { ok: false, issues } : { ok: true, values: output }
}
