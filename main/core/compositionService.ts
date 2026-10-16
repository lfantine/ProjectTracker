import { readSidebarOrganization, writeSidebarOrganization } from './sidebarGroups'
import { randomUUID, createHash } from 'node:crypto'
import { z } from 'zod'
import { isContributionRef, isInstanceBinding, bindingMatchesDeclaration, type ContributionRef, type InstanceBinding } from '../../shared/bindings'
import { CORE_WIDGETS, DEFAULT_SIDEBAR } from '../../shared/core'
import type { CompositionCommand, CompositionContribution, CompositionRequest, CompositionSnapshot } from '../../shared/composition'
import { GRID_BREAKPOINTS, type Dashboard, type DashboardWidgetPlacement, type SidebarEntry } from '../../shared/models'
import { isSidebarTarget } from '../../shared/navigation'
import { HOST_ICONS } from '../../shared/version'
import { AppError } from '../../shared/errors'
import { validateConfig, validateManifest } from '../../shared/manifest'
import { overlaps } from '../../shared/grid'
import { ContributionRegistry } from '../packages/registry'
import { CoreService } from './service'
import { currentRevision, readProject } from './readModel'
import { defaultSidebarTarget } from './composition'
import type { DataChange } from '../../shared/commands'

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
const name = z.string().trim().min(1).max(80)
const contribution = z.custom<ContributionRef>(isContributionRef)
const binding = z.custom<InstanceBinding>(isInstanceBinding)
const config = z.record(z.string().max(128), z.json()).refine(value => Buffer.byteLength(JSON.stringify(value)) <= 64 * 1024)
const dashboard = { dashboardId: id }, project = { projectId: id }, placement = { placementId: id }
const schemas = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('dashboard.create'), name }).strict(),
  z.object({ kind: z.literal('dashboard.rename'), id, name }).strict(),
  z.object({ kind: z.literal('dashboard.duplicate'), id, name }).strict(),
  z.object({ kind: z.literal('dashboard.delete'), id, replacementId: id.optional() }).strict(),
  z.object({ kind: z.literal('dashboard.default'), id }).strict(),
  z.object({ kind: z.literal('widget.add'), ...dashboard, contribution, binding, config }).strict(),
  z.object({ kind: z.literal('widget.configure'), ...dashboard, ...placement, binding, config }).strict(),
  z.object({ kind: z.literal('widget.remove'), ...dashboard, ...placement }).strict(),
  z.object({ kind: z.literal('layout.save'), ...dashboard, breakpoint: z.enum(['lg', 'md', 'sm']), items: z.array(z.object({ id, rect: z.object({ x: z.number().int().min(0).max(11), y: z.number().int().min(0).max(10000), w: z.number().int().min(1).max(12), h: z.number().int().min(1).max(200) }).strict() }).strict()).max(100) }).strict(),
  z.object({ kind: z.literal('project.add'), ...project, contribution, binding, config }).strict(),
  z.object({ kind: z.literal('project.configure'), ...project, ...placement, binding, config }).strict(),
  z.object({ kind: z.literal('sidebar.add'), label: name, icon: z.enum(HOST_ICONS), target: z.custom(isSidebarTarget) }).strict(),
  z.object({ kind: z.literal('sidebar.update'), id, label: name, icon: z.enum(HOST_ICONS), target: z.custom(isSidebarTarget), hidden: z.boolean() }).strict(),
  z.object({ kind: z.literal('sidebar.place'), id, beforeId: id.nullable(), groupId: id.nullable() }).strict(),
  z.object({ kind: z.literal('sidebar.group.add'), name }).strict(),
  z.object({ kind: z.literal('sidebar.group.update'), id, name, collapsed: z.boolean() }).strict(),
  z.object({ kind: z.literal('sidebar.group.remove'), id }).strict(),
  z.object({ kind: z.literal('sidebar.group.place'), id, beforeId: id.nullable() }).strict(),
  z.object({ kind: z.literal('sidebar.move'), id, direction: z.union([z.literal(-1), z.literal(1)]) }).strict(),
  z.object({ kind: z.literal('sidebar.remove'), id }).strict(),
  z.object({ kind: z.literal('sidebar.restore') }).strict(),
])
const requestSchema = z.object({ command: schemas, expectedRevision: z.number().int().nonnegative(), operationId: z.string().uuid() }).strict()
const fail = (message: string): never => { throw new AppError('VALIDATION', message) }
interface WidgetRow { dashboard_id: string; placement_id: string; package_id: string; contribution_id: string; config_json: string; config_version: number; binding_json: string; layouts_json: string; revision: number }

export class CompositionService {
  constructor(private readonly core: CoreService) {}
  private get db() { return this.core.db }
  private catalog(): CompositionContribution[] {
    const entries: CompositionContribution[] = Object.entries(CORE_WIDGETS).map(([contributionId, value]) => ({ ref: { packageId: 'core', contributionId }, name: value.name, type: 'widget', major: null, size: { default: value.size } }))
    for (const row of this.db.all<{ manifest_json: string }>("SELECT v.manifest_json FROM packages p JOIN package_versions v ON v.package_id = p.id AND v.version = p.active_version WHERE p.state = 'active' AND v.status = 'active'")) {
      const result = validateManifest(JSON.parse(row.manifest_json))
      if (!result.ok || result.manifest.kind !== 'package') continue
      const manifest = result.manifest
      for (const definition of manifest.contributions) entries.push({ ref: { packageId: manifest.id, contributionId: definition.id }, name: definition.name, type: definition.type,
        major: definition.type === 'major' ? { packageId: manifest.id, contributionId: definition.id } : definition.major ? { packageId: manifest.id, contributionId: definition.major } : null,
        config: definition.config, ...(definition.type === 'widget' ? { size: definition.size } : {}) })
    }
    return entries
  }
  private widget(row: WidgetRow): DashboardWidgetPlacement {
    return { dashboardId: row.dashboard_id, placementId: row.placement_id, contribution: { packageId: row.package_id, contributionId: row.contribution_id }, config: { version: row.config_version, values: JSON.parse(row.config_json) }, binding: JSON.parse(row.binding_json), layouts: JSON.parse(row.layouts_json), revision: row.revision }
  }
  snapshot(): CompositionSnapshot {
    const dashboards = this.db.all<{ id: string; name: string; position: number; is_default: number; created_at: string; updated_at: string; revision: number }>('SELECT * FROM dashboards ORDER BY position, id').map(row => ({ id: row.id, name: row.name, position: row.position, isDefault: !!row.is_default, createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision,
      widgets: this.db.all<WidgetRow>('SELECT * FROM dashboard_widgets WHERE dashboard_id = ? ORDER BY position, placement_id', row.id).map(widget => this.widget(widget)) }))
    const sidebar = this.db.all<{ id: string; label: string; icon: SidebarEntry['icon']; target_json: string; hidden: number; position: number; default_key: string | null; revision: number }>('SELECT * FROM sidebar_entries ORDER BY position, id').map(row => ({ id: row.id, label: row.label, icon: row.icon, target: JSON.parse(row.target_json), hidden: !!row.hidden, position: row.position, defaultKey: row.default_key, revision: row.revision }))
    const instances = this.db.all<{ package_id: string; major_id: string; instance_id: string; name: string; position: number; created_at: string; updated_at: string; revision: number }>('SELECT * FROM major_instances ORDER BY package_id, major_id, position, instance_id').map(row => ({ packageId: row.package_id, majorId: row.major_id, instanceId: row.instance_id, name: row.name, position: row.position, createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision }))
    const organization = readSidebarOrganization(this.db)
    for (const entry of sidebar as SidebarEntry[]) entry.groupId = organization.membership[entry.id] ?? null
    return { dashboards, sidebar, sidebarGroups: organization.groups, instances, contributions: this.catalog(), revision: currentRevision(this.db) }
  }
  execute(raw: unknown): { id?: string } {
    const parsed = requestSchema.safeParse(raw)
    if (!parsed.success) return fail('Paramètres de composition invalides.')
    const input = parsed.data as CompositionRequest
    const token = `composition:${createHash('sha256').update(JSON.stringify(input.command)).digest('hex')}`
    const previous = this.db.get<{ command: string; result_json: string }>('SELECT command, result_json FROM operations WHERE operation_id = ?', input.operationId)
    if (previous) {
      if (previous.command !== token) throw new AppError('CONFLICT', 'Identifiant d’opération déjà utilisé.')
      return JSON.parse(previous.result_json)
    }
    return this.core.commitPackageWrite(() => {
      if (currentRevision(this.db) !== input.expectedRevision) throw new AppError('CONFLICT', 'Composition modifiée ailleurs. Rechargez avant de réessayer.')
      const changes: DataChange[] = [{ entity: 'composition' }]
      const value = this.mutate(input.command, changes)
      this.db.run('INSERT INTO operations (operation_id, command, result_json, created_at) VALUES (?, ?, ?, ?)', input.operationId, token, JSON.stringify(value), new Date().toISOString())
      return { changed: true, value, changes }
    }).value
  }
  private dash(id: string): Dashboard {
    return this.snapshot().dashboards.find(item => item.id === id) ?? fail('Dashboard introuvable.')
  }
  private descriptor(ref: ContributionRef, type: 'widget' | 'minor' | 'major'): CompositionContribution {
    const resolved = new ContributionRegistry(this.db).resolve(ref, type)
    if (resolved.status !== 'available') return fail('Contribution indisponible. Sa configuration est conservée.')
    return this.catalog().find(item => item.type === type && item.ref.packageId === ref.packageId && item.ref.contributionId === ref.contributionId) ?? fail('Contribution non configurable.')
  }
  private settings(ref: ContributionRef, type: 'widget' | 'minor', bound: InstanceBinding, values: Record<string, unknown>) {
    const descriptor = this.descriptor(ref, type)
    if (!bindingMatchesDeclaration(bound, descriptor.major)) return fail('Liaison incompatible.')
    if (bound.mode === 'fixed' && !this.db.get('SELECT 1 FROM major_instances WHERE package_id = ? AND major_id = ? AND instance_id = ?', bound.major.packageId, bound.major.contributionId, bound.instanceId)) return fail('Instance introuvable.')
    const validated = validateConfig(descriptor.config, values)
    if (!validated.ok) return fail('Configuration invalide.')
    return { descriptor, config: validated.values, version: descriptor.config?.version ?? 1 }
  }
  private touchDashboard(id: string) { this.db.run('UPDATE dashboards SET revision = revision + 1, updated_at = ? WHERE id = ?', new Date().toISOString(), id) }
  private touchProject(id: string, changes: DataChange[]) {
    this.db.run('UPDATE projects SET revision = revision + 1, updated_at = ? WHERE id = ?', new Date().toISOString(), id)
    changes.push({ entity: 'project', id, value: readProject(this.db, id)! })
  }
  private sidebarTarget(target: SidebarEntry['target']) {
    if (target.kind === 'dashboard') this.dash(target.dashboardId)
    if (target.kind === 'major') {
      this.descriptor(target.major, 'major')
      if (target.binding.mode === 'fixed' && !this.db.get('SELECT 1 FROM major_instances WHERE package_id = ? AND major_id = ? AND instance_id = ?', target.major.packageId, target.major.contributionId, target.binding.instanceId)) return fail('Instance introuvable.')
    }
  }
  private mutate(command: CompositionCommand, changes: DataChange[]): { id?: string } {
    const uid = () => randomUUID(), now = new Date().toISOString()
    switch (command.kind) {
      case 'dashboard.create': case 'dashboard.duplicate': {
        if (this.db.get<{ n: number }>('SELECT COUNT(*) n FROM dashboards')!.n >= 50) return fail('Limite de dashboards atteinte.')
        const source = command.kind === 'dashboard.duplicate' ? this.dash(command.id) : undefined
        const id = uid(), position = this.db.get<{ n: number }>('SELECT COALESCE(MAX(position), -1) + 1 n FROM dashboards')!.n
        this.db.run('INSERT INTO dashboards (id, name, position, is_default, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)', id, command.name, position, now, now)
        for (const widget of source?.widgets ?? []) this.db.run('INSERT INTO dashboard_widgets (dashboard_id, placement_id, position, package_id, contribution_id, config_version, config_json, binding_json, layouts_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', id, uid(), source!.widgets.indexOf(widget), widget.contribution.packageId, widget.contribution.contributionId, widget.config.version, JSON.stringify(widget.config.values), JSON.stringify(widget.binding), JSON.stringify(widget.layouts))
        return { id }
      }
      case 'dashboard.rename': this.dash(command.id); this.db.run('UPDATE dashboards SET name = ? WHERE id = ?', command.name, command.id); this.touchDashboard(command.id); return {}
      case 'dashboard.default': this.dash(command.id); this.db.run('UPDATE dashboards SET is_default = 0 WHERE is_default = 1'); this.db.run('UPDATE dashboards SET is_default = 1 WHERE id = ?', command.id); this.touchDashboard(command.id); return {}
      case 'dashboard.delete': {
        const current = this.dash(command.id)
        if (this.snapshot().dashboards.length <= 1) return fail('Le dernier dashboard doit être conservé.')
        if (current.isDefault) {
          if (!command.replacementId || command.replacementId === current.id) return fail('Choisissez un nouveau dashboard par défaut.')
          this.dash(command.replacementId)
          this.db.run('UPDATE dashboards SET is_default = 0 WHERE id = ?', current.id)
          this.db.run('UPDATE dashboards SET is_default = 1 WHERE id = ?', command.replacementId); this.touchDashboard(command.replacementId)
        }
        this.db.run('DELETE FROM dashboards WHERE id = ?', current.id); return {}
      }
      case 'widget.add': {
        const dash = this.dash(command.dashboardId)
        if (dash.widgets.length >= 100) return fail('Limite de widgets atteinte.')
        const settings = this.settings(command.contribution, 'widget', command.binding, command.config), id = uid()
        const size = settings.descriptor.size?.default ?? { w: 3, h: 4 }, bottom = Math.max(0, ...dash.widgets.map(item => (item.layouts.lg?.y ?? 0) + (item.layouts.lg?.h ?? 0)))
        this.db.run('INSERT INTO dashboard_widgets (dashboard_id, placement_id, position, package_id, contribution_id, config_version, config_json, binding_json, layouts_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', dash.id, id, dash.widgets.length, command.contribution.packageId, command.contribution.contributionId, settings.version, JSON.stringify(settings.config), JSON.stringify(command.binding), JSON.stringify({ lg: { x: 0, y: bottom, ...size } }))
        this.touchDashboard(dash.id); return { id }
      }
      case 'widget.configure': {
        const dash = this.dash(command.dashboardId), widget = dash.widgets.find(item => item.placementId === command.placementId) ?? fail('Emplacement introuvable.')
        const settings = this.settings(widget.contribution, 'widget', command.binding, command.config)
        this.db.run('UPDATE dashboard_widgets SET config_json = ?, config_version = ?, binding_json = ?, revision = revision + 1 WHERE dashboard_id = ? AND placement_id = ?', JSON.stringify(settings.config), settings.version, JSON.stringify(command.binding), dash.id, widget.placementId)
        this.touchDashboard(dash.id); return {}
      }
      case 'widget.remove': {
        this.dash(command.dashboardId)
        this.db.run('DELETE FROM dashboard_widgets WHERE dashboard_id = ? AND placement_id = ?', command.dashboardId, command.placementId); this.touchDashboard(command.dashboardId); return {}
      }
      case 'layout.save': {
        const dash = this.dash(command.dashboardId), cols = GRID_BREAKPOINTS[command.breakpoint].cols
        if (command.items.length !== dash.widgets.length || new Set(command.items.map(item => item.id)).size !== command.items.length) return fail('Inventaire de grille incomplet.')
        for (const item of command.items) {
          const widget = dash.widgets.find(widget => widget.placementId === item.id) ?? fail('Emplacement inconnu.')
          if (item.rect.x + item.rect.w > cols || command.items.some(other => other.id !== item.id && overlaps(item.rect, other.rect))) return fail('Disposition hors limites ou en chevauchement.')
          const definition = this.catalog().find(entry => entry.type === 'widget' && entry.ref.packageId === widget.contribution.packageId && entry.ref.contributionId === widget.contribution.contributionId)
          const min = definition?.size?.min, max = definition?.size?.max
          if (min && (item.rect.w < Math.min(cols, min.w) || item.rect.h < min.h) || max && (item.rect.w > Math.min(cols, max.w) || item.rect.h > max.h)) return fail('Dimensions du widget invalides.')
          this.db.run('UPDATE dashboard_widgets SET layouts_json = ?, revision = revision + 1 WHERE dashboard_id = ? AND placement_id = ?', JSON.stringify({ ...widget.layouts, [command.breakpoint]: item.rect }), dash.id, item.id)
        }
        this.touchDashboard(dash.id); return {}
      }
      case 'project.add': {
        if (!readProject(this.db, command.projectId)) return fail('Projet introuvable.')
        const settings = this.settings(command.contribution, 'minor', command.binding, command.config), id = uid()
        const position = this.db.get<{ n: number }>('SELECT COALESCE(MAX(position), -1) + 1 n FROM project_blocks WHERE project_id = ?', command.projectId)!.n
        if (position >= 500) return fail('Limite de blocs atteinte.')
        this.db.run('INSERT INTO project_blocks (project_id, block_id, position, package_id, contribution_id, config_version, config_json, binding_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', command.projectId, id, position, command.contribution.packageId, command.contribution.contributionId, settings.version, JSON.stringify(settings.config), JSON.stringify(command.binding))
        this.touchProject(command.projectId, changes); return { id }
      }
      case 'project.configure': {
        const row = this.db.get<{ package_id: string; contribution_id: string }>('SELECT package_id, contribution_id FROM project_blocks WHERE project_id = ? AND block_id = ?', command.projectId, command.placementId) ?? fail('Emplacement introuvable.')
        const settings = this.settings({ packageId: row.package_id, contributionId: row.contribution_id }, 'minor', command.binding, command.config)
        this.db.run('UPDATE project_blocks SET config_json = ?, config_version = ?, binding_json = ?, revision = revision + 1 WHERE project_id = ? AND block_id = ?', JSON.stringify(settings.config), settings.version, JSON.stringify(command.binding), command.projectId, command.placementId)
        this.touchProject(command.projectId, changes); return {}
      }
      case 'sidebar.add': {
        this.sidebarTarget(command.target)
        const entries = this.snapshot().sidebar
        if (entries.length >= 100) return fail('Limite de raccourcis atteinte.')
        const id = uid()
        this.db.run('INSERT INTO sidebar_entries (id, label, icon, target_json, hidden, position) VALUES (?, ?, ?, ?, 0, ?)', id, command.label, command.icon, JSON.stringify(command.target), entries.length); return { id }
      }
      case 'sidebar.update': {
        const current = this.snapshot().sidebar.find(item => item.id === command.id) ?? fail('Raccourci introuvable.')
        if (JSON.stringify(current.target) !== JSON.stringify(command.target)) this.sidebarTarget(command.target)
        this.db.run('UPDATE sidebar_entries SET label = ?, icon = ?, target_json = ?, hidden = ?, revision = revision + 1 WHERE id = ?', command.label, command.icon, JSON.stringify(command.target), Number(command.hidden), command.id); return {}
      }
      case 'sidebar.place': {
        const entries = this.snapshot().sidebar, moving = entries.find(entry => entry.id === command.id) ?? fail('Shortcut introuvable.')
        const organization = readSidebarOrganization(this.db)
        if (command.groupId && !organization.groups.some(group => group.id === command.groupId)) return fail('Groupe introuvable.')
        if (command.beforeId === command.id) return {}
        const next = entries.filter(entry => entry.id !== command.id)
        const index = command.beforeId ? next.findIndex(entry => entry.id === command.beforeId) : next.length
        if (index < 0 || command.beforeId && (organization.membership[command.beforeId] ?? null) !== command.groupId) return fail('Destination invalide.')
        next.splice(index, 0, moving)
        next.forEach((entry, position) => this.db.run('UPDATE sidebar_entries SET position = ?, revision = revision + 1 WHERE id = ?', position, entry.id))
        if (command.groupId) organization.membership[command.id] = command.groupId
        else delete organization.membership[command.id]
        writeSidebarOrganization(this.db, organization); return {}
      }
      case 'sidebar.group.add': {
        const value = readSidebarOrganization(this.db), id = uid()
        if (value.groups.length >= 25) return fail('Limite de groupes atteinte.')
        value.groups.push({ id, name: command.name, collapsed: false }); writeSidebarOrganization(this.db, value); return { id }
      }
      case 'sidebar.group.update': {
        const value = readSidebarOrganization(this.db), group = value.groups.find(group => group.id === command.id) ?? fail('Groupe introuvable.')
        group.name = command.name; group.collapsed = command.collapsed; writeSidebarOrganization(this.db, value); return {}
      }
      case 'sidebar.group.remove': {
        const value = readSidebarOrganization(this.db)
        value.groups = value.groups.filter(group => group.id !== command.id)
        for (const [entry, group] of Object.entries(value.membership)) if (group === command.id) delete value.membership[entry]
        writeSidebarOrganization(this.db, value); return {}
      }
      case 'sidebar.group.place': {
        const value = readSidebarOrganization(this.db), group = value.groups.find(group => group.id === command.id) ?? fail('Groupe introuvable.')
        if (command.beforeId === command.id) return {}
        value.groups = value.groups.filter(group => group.id !== command.id)
        const index = command.beforeId ? value.groups.findIndex(group => group.id === command.beforeId) : value.groups.length
        if (index < 0) return fail('Groupe de destination introuvable.')
        value.groups.splice(index, 0, group); writeSidebarOrganization(this.db, value); return {}
      }
      case 'sidebar.move': {
        const entries = this.snapshot().sidebar, index = entries.findIndex(item => item.id === command.id), next = index + command.direction
        if (index < 0 || next < 0 || next >= entries.length) return fail('Déplacement impossible.')
        ;[entries[index], entries[next]] = [entries[next], entries[index]]
        entries.forEach((entry, position) => this.db.run('UPDATE sidebar_entries SET position = ?, revision = revision + 1 WHERE id = ?', position, entry.id)); return {}
      }
      case 'sidebar.remove': {
        this.db.run('DELETE FROM sidebar_entries WHERE id = ?', command.id)
        const value = readSidebarOrganization(this.db); delete value.membership[command.id]; writeSidebarOrganization(this.db, value); return {}
      }
      case 'sidebar.restore': {
        const current = this.snapshot(), defaultId = current.dashboards.find(item => item.isDefault)?.id ?? fail('Dashboard par défaut introuvable.')
        for (const [position, entry] of DEFAULT_SIDEBAR.entries()) {
          const target = JSON.stringify(defaultSidebarTarget(entry, defaultId)), existing = current.sidebar.find(item => item.defaultKey === entry.key)
          if (existing) this.db.run('UPDATE sidebar_entries SET label = ?, icon = ?, target_json = ?, hidden = 0, position = ?, revision = revision + 1 WHERE id = ?', entry.label, entry.icon, target, position, existing.id)
          else this.db.run('INSERT INTO sidebar_entries (id, label, icon, target_json, hidden, position, default_key) VALUES (?, ?, ?, ?, 0, ?, ?)', uid(), entry.label, entry.icon, target, position, entry.key)
        }
        const organization = readSidebarOrganization(this.db)
        for (const entry of current.sidebar) if (entry.defaultKey) delete organization.membership[entry.id]
        writeSidebarOrganization(this.db, organization)
        current.sidebar.filter(item => !item.defaultKey).forEach((entry, index) => this.db.run('UPDATE sidebar_entries SET position = ? WHERE id = ?', DEFAULT_SIDEBAR.length + index, entry.id)); return {}
      }
    }
  }
}
