import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bindingMatchesDeclaration, isInstanceBinding } from '../../shared/bindings'
import { CORE_PACKAGE_ID, isValidOpaqueId, isValidPackageId } from '../../shared/ids'
import { effectiveDependencies, hasMigrationChain, missingFiles, referencedFiles, validateConfig, validateManifest, type Manifest } from '../../shared/manifest'
import { isSidebarTarget, moduleHref, parseModuleRoute, targetHref } from '../../shared/navigation'
import { addedPermissions, describePermissions, isEmptyPermissionSet, normalizePermissions, validateNetworkOrigin } from '../../shared/permissions'
import { manifestJsonSchema } from '../../shared/schema'
import { parseFrameMessage, SDK_METHODS } from '../../shared/sdk'
import { expectedPaths, invalidFiles, read, validationSummary, validFiles } from './summary'

export function contractSuite() {
  describe('manifeste v1 — six formes conformes', () => {
    it.each(validFiles)('%s est accepté', (file) => {
      const result = validateManifest(read(`valid/${file}`))
      expect(result.ok ? [] : result.issues).toEqual([])
    })

    it('couvre majeur seul, mineur seul, widget seul, package combiné, thème et fonctionnalités', () => {
      const kinds = validFiles.map((file) => {
        const manifest = read(`valid/${file}`) as Manifest
        if (manifest.kind === 'extension') return manifest.extensionType
        return [...new Set(manifest.contributions.map((contribution) => contribution.type))].sort().join('+')
      })
      expect(kinds.sort()).toEqual(['features', 'major', 'major+minor+widget', 'minor', 'theme', 'widget'])
    })
  })

  describe('manifeste v1 — refus', () => {
    it.each(invalidFiles)('%s est refusé au bon endroit', (file) => {
      const result = validateManifest(read(`invalid/${file}`))
      expect(result.ok).toBe(false)
      if (result.ok) return
      const expected = expectedPaths[file.replace(/\.json$/, '')]
      expect(result.issues.map((issue) => issue.path).some((issuePath) => issuePath === expected || issuePath.startsWith(`${expected}.`) || issuePath.startsWith(`${expected}[`))).toBe(true)
    })

    it('chaque fixture non conforme a une attente', () => {
      expect(Object.keys(expectedPaths).sort()).toEqual(invalidFiles.map((file) => file.replace(/\.json$/, '')).sort())
    })

    it('rejette les valeurs non-objet', () => {
      for (const value of [null, 1, 'x', [], undefined]) expect(validateManifest(value).ok).toBe(false)
    })
  })

  describe('associations, dépendances et fichiers', () => {
    it('la cible d’une extension est une dépendance obligatoire', () => {
      const result = validateManifest(read('valid/theme.json'))
      expect(result.ok && effectiveDependencies(result.manifest)).toEqual({ core: '^1.0.0' })
    })

    it('liste et vérifie les fichiers référencés', () => {
      const result = validateManifest(read('valid/combined.json'))
      if (!result.ok) throw new Error('fixture invalide')
      expect(referencedFiles(result.manifest)).toEqual(['planner.html', 'minor.html', 'today.html'])
      expect(missingFiles(result.manifest, new Set(['planner.html', 'today.html']))).toEqual(['minor.html'])
    })

    it('vérifie la complétude des chaînes de migration', () => {
      const result = validateManifest(read('valid/widget-only.json'))
      if (!result.ok) throw new Error('fixture invalide')
      expect(hasMigrationChain(result.manifest, 1)).toBe(true)
      expect(hasMigrationChain(result.manifest, 3)).toBe(true)
      expect(hasMigrationChain(result.manifest, 4)).toBe(false)
      const noSteps = { ...result.manifest, migrations: undefined }
      expect(hasMigrationChain(noSteps, 2)).toBe(false)
    })

    it('valide une configuration contre le schéma de la contribution', () => {
      const result = validateManifest(read('valid/minor-only.json'))
      if (!result.ok || result.manifest.kind !== 'package') throw new Error('fixture invalide')
      const schema = result.manifest.contributions[0].config
      expect(validateConfig(schema, { text: 'Bonjour', align: 'center' })).toEqual({ ok: true, values: { text: 'Bonjour', align: 'center' } })
      expect(validateConfig(schema, { align: 'right' }).ok).toBe(false)
      expect(validateConfig(schema, { other: 1 }).ok).toBe(false)
      expect(validateConfig(undefined, {}).ok).toBe(true)
    })
  })

  describe('permissions', () => {
    it('détecte les droits ajoutés par une mise à jour', () => {
      const granted = normalizePermissions({ core: { projects: ['read'] }, network: ['https://a.example.com'] })
      const next = normalizePermissions({ core: { projects: ['read', 'write'], notes: ['read'] }, network: ['https://a.example.com', 'https://b.example.com'] })
      expect(addedPermissions(granted, next)).toEqual({ core: { projects: ['write'], notes: ['read'] }, network: ['https://b.example.com'], exports: [] })
      expect(isEmptyPermissionSet(addedPermissions(next, granted))).toBe(true)
      expect(describePermissions(next)).toContain('Modifier les projets')
    })

    it('n’admet que des origines HTTPS exactes et publiques', () => {
      expect(validateNetworkOrigin('https://api.example.com')).toBeNull()
      expect(validateNetworkOrigin('https://api.example.com:8443')).toBeNull()
      for (const origin of ['https://API.example.com', 'https://api.example.com:443', 'https://example', 'https://[::1]', 'https://foo.localhost', 'https://a.example.com/']) {
        expect(validateNetworkOrigin(origin)).not.toBeNull()
      }
    })
  })

  describe('identités, liaisons et navigation', () => {
    it('réserve core et contrôle les identités', () => {
      expect(isValidPackageId(CORE_PACKAGE_ID)).toBe(true)
      expect(validateManifest({ ...read('valid/major-only.json'), id: CORE_PACKAGE_ID }).ok).toBe(false)
      for (const id of ['a..b', '-a', 'a-', 'A', 'a_b', 'a b', '']) expect(isValidPackageId(id)).toBe(false)
      for (const id of ['week-preset_k2', 'mod_tasks', 'p1']) expect(isValidOpaqueId(id)).toBe(true)
    })

    it('respecte la liaison déclarée', () => {
      const major = { packageId: 'builtin.week', contributionId: 'planner' }
      expect(isInstanceBinding({ mode: 'fixed', major, instanceId: 'week-default' })).toBe(true)
      expect(isInstanceBinding({ mode: 'fixed', major, instanceId: 'week-default', extra: 1 })).toBe(false)
      expect(isInstanceBinding({ mode: 'active', major: { packageId: 'X', contributionId: 'y' } })).toBe(false)
      expect(bindingMatchesDeclaration({ mode: 'none' }, null)).toBe(true)
      expect(bindingMatchesDeclaration({ mode: 'none' }, major)).toBe(false)
      expect(bindingMatchesDeclaration({ mode: 'active', major }, major)).toBe(true)
      expect(bindingMatchesDeclaration({ mode: 'active', major: { ...major, contributionId: 'other' } }, major)).toBe(false)
      expect(bindingMatchesDeclaration({ mode: 'active', major }, null)).toBe(false)
    })

    it('valide les cibles de la sidebar et les routes statiques', () => {
      const major = { packageId: 'builtin.week', contributionId: 'planner' }
      expect(isSidebarTarget({ kind: 'native', page: 'settings' })).toBe(true)
      expect(isSidebarTarget({ kind: 'native', page: 'terminal' })).toBe(false)
      expect(isSidebarTarget({ kind: 'major', major, binding: { mode: 'active', major } })).toBe(true)
      expect(isSidebarTarget({ kind: 'major', major, binding: { mode: 'none' } })).toBe(false)
      expect(isSidebarTarget({ kind: 'major', major, binding: { mode: 'fixed', major: { ...major, contributionId: 'x' }, instanceId: 'a' } })).toBe(false)
      expect(targetHref({ kind: 'major', major, binding: { mode: 'fixed', major, instanceId: 'week a' } })).toBe('/module?package=builtin.week&contribution=planner&instance=week+a')
      expect(moduleHref(major)).toBe('/module?package=builtin.week&contribution=planner')
      expect(parseModuleRoute({ package: 'builtin.week', contribution: 'planner', instance: 'week-default' })).toEqual({ ok: true, major, instanceId: 'week-default' })
      expect(parseModuleRoute({ package: 'builtin.week', contribution: 'planner', instance: ['week-default', 'other'] })).toEqual({ ok: false, reason: 'invalid' })
      expect(parseModuleRoute({ package: '../x', contribution: 'planner' })).toEqual({ ok: false, reason: 'invalid' })
      expect(parseModuleRoute({ package: ['a'], contribution: 'b' })).toEqual({ ok: false, reason: 'missing' })
    })
  })

  describe('protocole SDK', () => {
    it('refuse les méthodes hors liste fermée', () => {
      expect(parseFrameMessage({ type: 'request', requestId: 'r1', method: 'storage.get', params: { collection: 'a', id: 'b' } })).not.toBeNull()
      expect(parseFrameMessage({ type: 'request', requestId: 'r1', method: 'sql.exec', params: {} })).toBeNull()
      expect(parseFrameMessage({ type: 'request', requestId: 'r1', method: 'constructor', params: {} })).toBeNull()
      expect(parseFrameMessage({ type: 'request', requestId: 'r1', method: '__proto__', params: {} })).toBeNull()
      expect(parseFrameMessage({ type: 'request', requestId: 'bad id!', method: 'storage.get', params: {} })).toBeNull()
      expect(Object.keys(SDK_METHODS).some((method) => /sql|exec|fs|shell|ipc|save/i.test(method))).toBe(false)
    })
  })

  describe('sérialisation identique entre environnements', () => {
    it('produit le résumé de validation de référence', () => {
      const expected = read('_expected-validation.json')
      expect(validationSummary()).toEqual(expected)
    })

    it('le schéma JSON publié est à jour', () => {
      const published = JSON.parse(fs.readFileSync('shared/schema/manifest.schema.json', 'utf8'))
      expect(manifestJsonSchema()).toEqual(published)
    })
  })
}
