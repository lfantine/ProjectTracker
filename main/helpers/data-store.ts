import fs from 'fs/promises'
import os from 'os'
import path from 'path'

const DATA_DIR = path.join(os.homedir(), '.data', 'ProjectTracker')
const DATA_FILE = path.join(DATA_DIR, 'data.json')
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')

export interface AppSettings {
  // Path or name of the executable invoked for AI features. It's called with
  // `--request <text>` (and `--format <text>` when relevant) and must print the
  // answer on stdout. Defaults to `groqtool`, resolved from the user's PATH.
  aiCommand: string
}

function defaultSettings(): AppSettings {
  return { aiCommand: 'groqtool' }
}

function emptyAppData() {
  return {
    categories: ['Hardware', 'Software', 'Mobile'],
    platforms: {
      dev: ['PC', 'Tablette', 'Mobile', 'Docker', 'Embarqué', 'Personnel'],
      video: ['YouTube', 'Instagram', 'TikTok', 'Twitch', 'LinkedIn', 'Autre'],
    },
    folders: [],
    projects: [],
    notes: [],
    errors: [],
  }
}

export function getDataDir() {
  return DATA_DIR
}

export async function loadAppData(): Promise<unknown> {
  await fs.mkdir(DATA_DIR, { recursive: true })
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf-8')
    return JSON.parse(raw)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      const seed = emptyAppData()
      await saveAppData(seed)
      return seed
    }
    throw err
  }
}

export async function saveAppData(data: unknown): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true })
  const tmpFile = `${DATA_FILE}.tmp`
  await fs.writeFile(tmpFile, JSON.stringify(data, null, 2), 'utf-8')
  await fs.rename(tmpFile, DATA_FILE)
}

async function readSettingsFile(): Promise<AppSettings | null> {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf-8')
    return { ...defaultSettings(), ...JSON.parse(raw) }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

async function writeSettingsFile(settings: AppSettings): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true })
  const tmpFile = `${SETTINGS_FILE}.tmp`
  await fs.writeFile(tmpFile, JSON.stringify(settings, null, 2), 'utf-8')
  await fs.rename(tmpFile, SETTINGS_FILE)
}

export async function getSettings(): Promise<AppSettings> {
  await fs.mkdir(DATA_DIR, { recursive: true })
  const existing = await readSettingsFile()
  if (existing) return existing
  const seed = defaultSettings()
  await writeSettingsFile(seed)
  return seed
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = (await readSettingsFile()) ?? defaultSettings()
  const next = { ...current, ...patch }
  await writeSettingsFile(next)
  return next
}
