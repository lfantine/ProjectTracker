import { DEFAULT_HOME_WIDGETS, DEFAULT_SIDEBAR, type DefaultSidebarEntry } from '../../shared/core'
import type { SidebarTarget } from '../../shared/navigation'
import type { Database } from '../db/database'

export const COMPOSITION_MARKER = 'composition-defaults'
export const HOME_DASHBOARD_ID = 'dash-home'

function hasMarker(db: Database, kind: string): boolean {
  return !!db.get('SELECT 1 AS present FROM import_markers WHERE kind = ?', kind)
}

export function defaultSidebarTarget(entry: DefaultSidebarEntry, defaultDashboardId: string): SidebarTarget {
  switch (entry.target.kind) {
    case 'native':
      return { kind: 'native', page: entry.target.page }
    case 'default-dashboard':
      return { kind: 'dashboard', dashboardId: defaultDashboardId }
    case 'major':
      return { kind: 'major', major: entry.target.major, binding: { mode: 'active', major: entry.target.major } }
  }
}

// Initial composition: the "Accueil" dashboard reproducing the former home
// page and the default sidebar. Runs once; restoring the default navigation
// later is a separate, explicit action.
export function seedComposition(db: Database, now: string) {
  if (hasMarker(db, COMPOSITION_MARKER)) return
  db.run('INSERT INTO dashboards (id, name, position, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', HOME_DASHBOARD_ID, 'Accueil', 0, 1, now, now)
  DEFAULT_HOME_WIDGETS.forEach((widget, index) => {
    const placementId = `home-${widget.contribution.contributionId}`
    const binding = widget.contribution.packageId === 'core' ? { mode: 'none' } : { mode: 'active', major: { packageId: widget.contribution.packageId, contributionId: 'planner' } }
    db.run(
      'INSERT INTO dashboard_widgets (dashboard_id, placement_id, position, package_id, contribution_id, config_version, config_json, binding_json, layouts_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      HOME_DASHBOARD_ID, placementId, index, widget.contribution.packageId, widget.contribution.contributionId, 1, '{}', JSON.stringify(binding), JSON.stringify({ lg: widget.lg })
    )
  })
  DEFAULT_SIDEBAR.forEach((entry, index) => {
    db.run(
      'INSERT INTO sidebar_entries (id, label, icon, target_json, hidden, position, default_key) VALUES (?, ?, ?, ?, ?, ?, ?)',
      `nav-${entry.key}`, entry.label, entry.icon, JSON.stringify(defaultSidebarTarget(entry, HOME_DASHBOARD_ID)), 0, index, entry.key
    )
  })
  db.run('INSERT INTO import_markers (kind, completed_at) VALUES (?, ?)', COMPOSITION_MARKER, now)
}
