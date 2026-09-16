import fs from 'fs/promises'
import os from 'os'
import path from 'path'

const DATA_DIR = path.join(os.homedir(), '.data', 'ProjectTracker')
const DATA_FILE = path.join(DATA_DIR, 'data.json')

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
