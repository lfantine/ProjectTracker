import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { satisfies } from 'semver'
import { validateManifest, type Manifest } from '../../shared/manifest'
import { isSafeRelativePath } from '../../shared/manifest'
import type { Database } from '../db/database'
import type { ManagedVersion } from '../packages/managedVersion'
import { CORE_VERSION } from '../../shared/version'
const colors = z.object({ background: z.string().regex(/^#[a-fA-F0-9]{6}$/).optional(), surface: z.string().regex(/^#[a-fA-F0-9]{6}$/).optional(), text: z.string().regex(/^#[a-fA-F0-9]{6}$/).optional(), accent: z.string().regex(/^#[a-fA-F0-9]{6}$/).optional(), border: z.string().regex(/^#[a-fA-F0-9]{6}$/).optional() }).strict()
export const themeSchema = z.object({ version: z.literal(1), light: colors, dark: colors, texts: z.object({ 'week.title': z.string().min(1).max(80).optional() }).strict().optional(), background: z.string().max(200).optional() }).strict()
export type ResolvedTheme = { light: Record<string, string>; dark: Record<string, string>; texts: Record<string, string>; background?: string }
export function validateTheme(artifact: ManagedVersion): ResolvedTheme {
  const manifest = artifact.manifest
  if (manifest.kind !== 'extension' || manifest.extensionType !== 'theme') throw Error('THEME_MANIFEST_INVALID')
  const bytes = fs.readFileSync(path.join(artifact.root, manifest.theme))
  if (bytes.length > 16384) throw Error('THEME_DATA_INVALID')
  const data = themeSchema.parse(JSON.parse(bytes.toString('utf8')))
  const result: ResolvedTheme = { light: data.light, dark: data.dark, texts: data.texts ?? {} }
  if (data.background) {
    const relative = data.background
    if (!isSafeRelativePath(relative) || !artifact.files.some(file => file.path === relative)) throw Error('THEME_BACKGROUND_INVALID')
    const image = fs.readFileSync(path.join(artifact.root, relative)), ext = path.extname(relative).toLowerCase()
    if (image.length > 512 * 1024 || !((ext === '.png' && image.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) || ((ext === '.jpg' || ext === '.jpeg') && image[0] === 255 && image[1] === 216 && image[2] === 255) || (ext === '.webp' && image.subarray(0,4).toString() === 'RIFF' && image.subarray(8,12).toString() === 'WEBP'))) throw Error('THEME_BACKGROUND_INVALID')
    result.background = `data:image/${ext === '.jpg' ? 'jpeg' : ext.slice(1)};base64,${image.toString('base64')}`
  }
  return result
}
export function validateExtensionTarget(db: Database, manifest: Manifest, replacement?: Manifest): void {
  if (manifest.kind !== 'extension') return
  let target: Manifest | undefined
  if (manifest.target.package === 'core') {
    if (manifest.extensionType !== 'theme' || !satisfies(CORE_VERSION, manifest.target.version)) throw Error('EXTENSION_TARGET_INVALID')
  } else {
    const row = db.get<{ manifest_json: string }>("SELECT v.manifest_json FROM packages p JOIN package_versions v ON v.package_id=p.id AND v.version=p.active_version WHERE p.id=? AND p.state='active' AND v.status='active'", manifest.target.package)
    if (!row) throw Error('EXTENSION_TARGET_UNAVAILABLE')
    const parsed = validateManifest(replacement?.id === manifest.target.package ? replacement : JSON.parse(row.manifest_json))
    if (!parsed.ok || parsed.manifest.kind !== 'package' || !satisfies(parsed.manifest.version, manifest.target.version)) throw Error('EXTENSION_TARGET_INVALID')
    target = parsed.manifest
  }
  if (manifest.extensionType === 'features') for (const feature of manifest.features) if (target?.kind !== 'package' || !target.slots?.some(slot => slot.id === feature.slot.id && slot.version === feature.slot.version)) throw Error('EXTENSION_SLOT_INVALID')
}
