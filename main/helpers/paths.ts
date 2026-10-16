import os from 'os'
import fs from 'node:fs'
import path from 'path'

// Single source for every on-disk location. Nothing in the main process may
// build a data path by itself: tests and recovery tooling rely on these
// overrides being honoured before any database, legacy file or resource is
// opened.
export const DATA_DIR_ENV = 'PROJECT_TRACKER_DATA_DIR'
export const USER_DATA_DIR_ENV = 'PROJECT_TRACKER_USER_DATA_DIR'
// Set by every automated harness. In this mode the personal directories are
// refused even if an override accidentally points at them.
export const TEST_MODE_ENV = 'PROJECT_TRACKER_TEST'

export interface DataPaths {
  root: string
  legacyData: string
  legacySettings: string
  database: string
  lock: string
  backups: string
  migration: string
  packages: string
  packageStaging: string
  logs: string
}

export function defaultDataDir(home = os.homedir()): string {
  return path.join(home, '.data', 'ProjectTracker')
}

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

// Resolve existing ancestors too: a test override through a symlink must not
// bypass the personal-data refusal, even if its final directory is absent.
export function physicalPath(file: string): string {
  const missing: string[] = []
  let current = file
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current)
    if (parent === current) break
    missing.unshift(path.basename(current)); current = parent
  }
  return path.join(fs.realpathSync(current), ...missing)
}

function readOverride(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]
  if (value === undefined) return undefined
  if (!value.trim() || !path.isAbsolute(value)) {
    throw new Error(`${name} doit être un chemin absolu`)
  }
  return path.resolve(value)
}

export function isTestMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[TEST_MODE_ENV] === '1'
}

export function resolveDataPaths(
  env: NodeJS.ProcessEnv = process.env,
  home = os.homedir()
): DataPaths {
  const override = readOverride(env, DATA_DIR_ENV)
  const root = override ?? defaultDataDir(home)
  if (isTestMode(env) && (!override || isInside(physicalPath(root), physicalPath(defaultDataDir(home))))) {
    throw new Error(`Mode test : ${DATA_DIR_ENV} doit viser un répertoire isolé`)
  }
  const packages = path.join(root, 'packages')
  return {
    root,
    legacyData: path.join(root, 'data.json'),
    legacySettings: path.join(root, 'settings.json'),
    database: path.join(root, 'tracker.sqlite'),
    lock: path.join(root, 'tracker.lock'),
    backups: path.join(root, 'backups'),
    migration: path.join(root, 'migration'),
    packages,
    packageStaging: path.join(packages, '.staging'),
    logs: path.join(root, 'logs'),
  }
}

// Electron profile (cookies, window geometry, caches). Returns undefined when
// the default profile should be kept.
export function resolveUserDataOverride(
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  const override = readOverride(env, USER_DATA_DIR_ENV)
  if (isTestMode(env) && !override) {
    throw new Error(`Mode test : ${USER_DATA_DIR_ENV} est requis`)
  }
  if (isTestMode(env) && override && !isInside(physicalPath(override), physicalPath(os.tmpdir()))) throw new Error('Mode test : profil Electron temporaire requis')
  return override
}

let cached: DataPaths | null = null

export function getDataPaths(): DataPaths {
  if (!cached) cached = resolveDataPaths()
  return cached
}
