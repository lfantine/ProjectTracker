// Regenerates the README screenshots from the production build (`app/`), in a
// throwaway data directory and Electron profile filled with sample data. The
// personal data directory is fingerprinted before/after, like the E2E harness.
//
// Usage: node scripts/readme-screenshots.mjs   (après `npx nextron build --no-pack`
// ou `npm run build:local`, qui produisent tous deux `app/`)
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'
import { buildLinkedinPlannerPackage } from './build-linkedin-planner-package.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'resources', 'screenshots')
const personalDirs = [path.join(os.homedir(), '.data', 'amber'), path.join(os.homedir(), '.data', 'ProjectTracker')]
if (!fs.existsSync(path.join(root, 'app', 'main.js'))) throw Error('Build absent : lancer `npx nextron build --no-pack` d’abord.')

function fingerprint(dir) {
  if (!fs.existsSync(dir)) return 'absent'
  const hash = createHash('sha256')
  const walk = current => { for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const full = path.join(current, entry.name), stat = fs.statSync(full); hash.update(`${path.relative(dir, full)}|${entry.isDirectory() ? 'd' : stat.size}|${stat.mtimeMs}\n`); if (entry.isDirectory()) walk(full) } }
  walk(dir); return hash.digest('hex')
}

const day = offset => { const date = new Date(); date.setDate(date.getDate() + offset); return date.toISOString().slice(0, 10) }
const at = offset => `${day(offset)}T09:00:00.000Z`
const task = (id, name, status, children = [], content = '') => ({ id, name, content, status, children })
const sample = {
  categories: ['Software', 'Contenu', 'Hardware'],
  platforms: { dev: ['PC', 'Mobile', 'Docker', 'Raspberry'], video: ['YouTube', 'Instagram', 'TikTok', 'LinkedIn'] },
  folders: [{ id: 'f_perso', name: 'Projets perso', kind: 'manual', displayMode: 'group', description: 'Side projects' }],
  projects: [
    { id: 'p_amber', name: 'amber', type: 'dev', category: 'Software', platforms: ['PC'], tags: ['electron', 'typescript', 'sqlite'], folderId: 'f_perso', status: 'actif',
      createdAt: at(-120), updatedAt: at(-1), lastOpenedAt: at(0), description: 'Mon app de suivi de projets, modulaire et 100 % locale.', stack: ['Electron', 'Next.js', 'TypeScript', 'SQLite'],
      noteIds: ['n_archi'], errorIds: ['e_csp'], checklist: [{ id: 'c_1', label: 'Licence Apple Developer', type: 'materiel', status: 'a_acheter' }, { id: 'c_2', label: 'Démo à l’apéro dev', type: 'evenement', status: 'a_venir', date: day(12) }],
      tasks: [
        task('t_core', 'Socle SQLite et migrations', 'fait', [task('t_core1', 'Import des JSON historiques', 'fait'), task('t_core2', 'Sauvegarde et restauration', 'fait')]),
        task('t_sdk', 'SDK des packages', 'en_cours', [task('t_sdk1', 'Stockage CAS par instance', 'fait'), task('t_sdk2', 'Exports entre packages', 'fait'), task('t_sdk3', 'Outillage npm pour les auteurs', 'a_faire')]),
        task('t_market', 'Marketplace et import ZIP', 'fait'),
        task('t_linkedin', 'Module LinkedIn Post Planner', 'en_cours', [task('t_li1', 'Idées, planning, historique', 'fait'), task('t_li2', 'Widget « prochain post »', 'a_faire')]),
        task('t_themes', 'Thèmes communautaires', 'a_faire'),
      ],
      deadlines: [{ id: 'd_beta', label: 'Bêta privée', date: day(9), status: 'a_venir' }, { id: 'd_mvp', label: 'MVP modulaire', date: day(-20), status: 'fait' }],
      links: [{ id: 'l_repo', title: 'Dépôt', url: 'https://github.com/' }],
      layout: [{ id: 'mod_tasks', type: 'tasks', title: 'Feuille de route', customize_title: true }, { id: 'mod_deadlines', type: 'deadlines' }, { id: 'mod_stack', type: 'stack' },
        { id: 'mod_chart', type: 'chart', title: 'Commits par semaine', chart: { kind: 'bar', points: [['S38', 18], ['S39', 26], ['S40', 31], ['S41', 22], ['S42', 40]].map(([label, value], index) => ({ id: `pt_${index}`, label, value: String(value) })) } },
        { id: 'mod_note', type: 'note', refId: 'n_archi' }, { id: 'mod_checklist', type: 'checklist' }] },
    { id: 'p_devlog', name: 'Devlog YouTube', type: 'video', category: 'Contenu', platforms: ['YouTube', 'LinkedIn'], tags: ['vidéo', 'build in public'], folderId: 'f_perso', status: 'actif',
      createdAt: at(-60), updatedAt: at(-2), lastOpenedAt: at(-1), description: 'Raconter la construction d’amber, un épisode toutes les deux semaines.', noteIds: ['n_ideas'], errorIds: [],
      checklist: [{ id: 'c_mic', label: 'Micro-cravate', type: 'materiel', status: 'a_acheter' }],
      tasks: [task('t_ep4', 'Épisode 4 : le marketplace', 'en_cours', [task('t_ep4a', 'Script', 'fait'), task('t_ep4b', 'Tournage', 'en_cours'), task('t_ep4c', 'Montage', 'a_faire')]), task('t_thumb', 'Miniatures cohérentes', 'a_faire')],
      deadlines: [{ id: 'd_ep4', label: 'Sortie épisode 4', date: day(5), status: 'a_venir' }], links: [], layout: [{ id: 'mod_tasks', type: 'tasks' }, { id: 'mod_deadlines', type: 'deadlines' }] },
    { id: 'p_meteo', name: 'Station météo', type: 'dev', category: 'Hardware', platforms: ['Raspberry'], tags: ['iot', 'python'], status: 'pause',
      createdAt: at(-200), updatedAt: at(-30), description: 'Capteurs sur le balcon et graphiques en temps réel.', noteIds: [], errorIds: [], checklist: [{ id: 'c_bme', label: 'Capteur BME280', type: 'materiel', status: 'a_acheter' }],
      tasks: [task('t_m1', 'Lecture des capteurs', 'fait'), task('t_m2', 'Boîtier imprimé en 3D', 'a_faire')], deadlines: [], links: [], layout: [{ id: 'mod_tasks', type: 'tasks' }] },
    { id: 'p_portfolio', name: 'Portfolio', type: 'dev', category: 'Software', platforms: ['PC', 'Mobile'], tags: ['astro'], status: 'termine',
      createdAt: at(-300), updatedAt: at(-90), description: 'Site perso statique.', noteIds: [], errorIds: [], checklist: [], tasks: [task('t_p1', 'Mise en ligne', 'fait')], deadlines: [], links: [], layout: [{ id: 'mod_tasks', type: 'tasks' }] },
  ],
  notes: [
    { id: 'n_archi', title: 'Architecture des packages', content: '# Packages\n\n- Un **package** = un ZIP avec un manifeste.\n- Chaque page tourne dans une frame isolée.\n- Les données passent par le SDK (SQLite côté hôte).', tags: ['archi'], createdAt: at(-40), updatedAt: at(-3) },
    { id: 'n_ideas', title: 'Idées de vidéos', content: '- Coder un SDK de plugins\n- 100 jours de build in public\n- Mon setup minimaliste', tags: ['contenu'], createdAt: at(-20), updatedAt: at(-5) },
  ],
  errors: [{ id: 'e_csp', title: 'Image bloquée par la CSP', content: 'Refused to load the image blob:…', causes: 'Seules les images data: sont autorisées dans les frames.', solution: 'Encoder en data URL via un canvas.', createdAt: at(-4), projectIds: ['p_amber'] }],
  trashedNotes: [],
  weekPresets: [{ id: 'week-default', name: 'Semaine type', wakeTimes: ['07:00', '07:00', '07:00', '07:00', '07:00', '08:30', '09:00'], slots: [
    ...[0, 1, 2, 3, 4].map(d => ({ id: `deep_${d}`, title: 'Deep work · amber', day: d, start: '09:00', end: '12:00', projectId: 'p_amber', color: '#d97706' })),
    ...[0, 2, 4].map(d => ({ id: `sport_${d}`, title: 'Sport', day: d, start: '07:30', end: '08:30', color: '#16a34a' })),
    ...[1, 3].map(d => ({ id: `video_${d}`, title: 'Tournage devlog', day: d, start: '14:00', end: '16:30', projectId: 'p_devlog', color: '#dc2626' })),
    ...[0, 2, 4].map(d => ({ id: `client_${d}`, title: 'Mission client', day: d, start: '13:30', end: '17:30', color: '#2563eb' })),
    ...[0, 1, 2, 3, 4].map(d => ({ id: `post_${d}`, title: 'Post LinkedIn', day: d, start: '08:30', end: '09:00', color: '#0a66c2' })),
    { id: 'read', title: 'Lecture', day: 5, start: '10:00', end: '11:30', color: '#7c3aed' }, { id: 'meteo', title: 'Station météo', day: 5, start: '14:00', end: '17:00', projectId: 'p_meteo', color: '#0891b2' },
    { id: 'rando', title: 'Randonnée', day: 6, start: '10:00', end: '15:00', color: '#16a34a' },
  ] }],
  activeWeekPresetId: 'week-default',
}
// A slot running right now, so the « Planning du jour » widget shows progress
// whatever the time the script runs at. Overlapping slots of today are dropped.
{
  const now = new Date(), today = (now.getDay() + 6) % 7, minutes = now.getHours() * 60 + now.getMinutes()
  const start = Math.max(0, Math.floor((minutes - 50) / 15) * 15), end = Math.min(23 * 60 + 45, start + 150)
  const hhmm = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
  const toMinutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
  const week = sample.weekPresets[0]
  week.slots = week.slots.filter(slot => slot.day !== today || toMinutes(slot.end) <= start || toMinutes(slot.start) >= end)
  week.slots.push({ id: 'now', title: 'Montage devlog · épisode 4', day: today, start: hhmm(start), end: hhmm(end), projectId: 'p_devlog', color: '#dc2626' })
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-readme-'))
const dataDir = path.join(temp, 'data'), profileDir = path.join(temp, 'profile')
fs.mkdirSync(dataDir); fs.mkdirSync(profileDir)
fs.writeFileSync(path.join(dataDir, 'data.json'), JSON.stringify(sample))
fs.writeFileSync(path.join(dataDir, 'renderer-prefs.json'), JSON.stringify({ tracker_theme_mode: 'light', tracker_project_tabs_v1: JSON.stringify({ tabs: [{ projectId: 'p_amber', pinned: true }, { projectId: 'p_devlog', pinned: false }], activeId: 'p_amber' }) }))
const before = personalDirs.map(fingerprint).join(',')
const zip = await buildLinkedinPlannerPackage(path.join(temp, 'zip'))

const app = await electron.launch({ args: [root], cwd: root, timeout: 30_000, env: { ...process.env, NODE_ENV: 'production', PROJECT_TRACKER_TEST: '1', PROJECT_TRACKER_MODULES: '1', PROJECT_TRACKER_DATA_DIR: dataDir, PROJECT_TRACKER_USER_DATA_DIR: profileDir } })
try {
  let page
  for (const deadline = Date.now() + 30_000; !page && Date.now() < deadline; await new Promise(resolve => setTimeout(resolve, 50))) page = app.windows().find(window => !window.isClosed() && window.url().startsWith('app://shell/'))
  if (!page) throw Error('Shell non démarré')
  page.setDefaultTimeout(20_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByText('Projets actifs', { exact: true }).waitFor({ timeout: 30_000 })
  const go = async route => { await page.evaluate(route => window.next.router.push(route), route); await page.waitForTimeout(1200) }
  const shot = async name => { await page.waitForTimeout(600); await page.screenshot({ path: path.join(output, `${name}.png`) }); console.log(`  ✓ ${name}.png`) }

  // Install the LinkedIn planner through the real marketplace (native dialogs stubbed).
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }) }, zip)
  await go('/marketplace')
  await page.getByRole('button', { name: 'Importer un ZIP', exact: true }).click()
  await page.getByText('Module installé et activé.', { exact: true }).waitFor({ timeout: 40_000 })
  await page.keyboard.press('Escape')
  const command = command => page.evaluate(async command => { const snapshot = await window.api.composition.snapshot(); return window.api.composition.command({ command, expectedRevision: snapshot.value.revision, operationId: crypto.randomUUID() }) }, command)
  const linkedin = { packageId: 'lfantine.linkedin-post-planner', contributionId: 'planner' }
  await command({ kind: 'sidebar.add', label: 'Posts LinkedIn', icon: 'linkedin', target: { kind: 'major', major: linkedin, binding: { mode: 'active', major: linkedin } } })
  // Home dashboard: day planning on the right, deadlines and projects beside it.
  const home = await page.evaluate(async () => (await window.api.composition.snapshot()).value.dashboards.find(item => item.id === 'dash-home'))
  // The « inactive project » stat needs more width than this sample layout gives it.
  for (const item of home.widgets.filter(item => item.contribution.contributionId === 'stat-stalest-project')) await command({ kind: 'widget.remove', dashboardId: 'dash-home', placementId: item.placementId })
  const rects = { 'stat-active-projects': [0, 0, 1, 2], 'stat-total-projects': [1, 0, 1, 2], 'stat-open-tasks': [2, 0, 2, 2], deadlines: [0, 2, 4, 4], 'recent-projects': [0, 6, 4, 6], today: [4, 0, 2, 12], tips: [0, 12, 6, 4], activity: [0, 16, 6, 5] }
  const items = home.widgets.filter(item => item.contribution.contributionId !== 'stat-stalest-project' && rects[item.contribution.contributionId]).map(item => { const [x, y, w, h] = rects[item.contribution.contributionId]; return { id: item.placementId, rect: { x, y, w, h } } })
  const saved = await command({ kind: 'layout.save', dashboardId: 'dash-home', breakpoint: 'md', items })
  if (!saved.ok) throw Error(`Disposition refusée : ${JSON.stringify(saved)}`)

  // Fill the planner through its own UI, like a user would.
  await go('/module?package=lfantine.linkedin-post-planner&contribution=planner')
  const planner = page.frameLocator('iframe[title="Module amber"]')
  await planner.getByRole('button', { name: 'Créer mon profil', exact: true }).click()
  await planner.getByRole('button', { name: 'Créer le profil', exact: true }).click()
  await planner.getByRole('button', { name: 'Nouveau post', exact: true }).waitFor({ timeout: 20_000 })
  await planner.getByRole('tab', { name: 'Idées' }).click()
  for (const [title, type] of [['Pourquoi j’ai isolé chaque module dans une frame #architecture #electron', 'expertise'], ['Retour sur 6 mois de build in public #devlog', 'decouverte'], ['Mon setup pour coder 3 h sans interruption #productivité', 'decouverte'], ['Les 5 erreurs de mon premier SDK #typescript #sdk', 'expertise'], ['amber est ouvert en bêta : qui veut tester ? #lancement', 'vente']]) {
    await planner.getByRole('textbox', { name: 'Nouvelle idée' }).fill(title)
    await planner.getByRole('combobox', { name: 'Type de l’idée' }).selectOption(type)
    await planner.getByRole('button', { name: 'Ajouter l’idée', exact: true }).click()
    await planner.getByRole('heading', { name: title.replace(/#[^\s#]+/g, '').replace(/\s+/g, ' ').trim(), exact: true }).waitFor()
  }
  for (const [title, content, offset] of [
    ['Pourquoi j’ai isolé chaque module dans une frame', 'J’ai passé 3 semaines à isoler chaque module d’amber dans sa propre frame.\n\nRésultat : un module ne peut ni lire mes fichiers, ni appeler Internet sans mon accord.', 1],
    ['Retour sur 6 mois de build in public', 'Il y a 6 mois, j’ai écrit la première ligne d’amber.\n\nVoici ce que le build in public m’a appris.', 3],
    ['amber est ouvert en bêta : qui veut tester ?', 'Bêta ouverte ! amber est une app de suivi de projets 100 % locale, extensible par modules. Commentez « bêta » pour recevoir un accès.', 6],
  ]) {
    await planner.locator('article', { hasText: title }).getByRole('button', { name: 'Planifier', exact: true }).click()
    await planner.locator('dialog textarea[name="content"]').fill(content)
    await planner.locator('dialog input[name="date"]').fill(day(offset))
    await planner.getByRole('button', { name: 'Enregistrer', exact: true }).click()
    await planner.locator('dialog').waitFor({ state: 'detached' })
  }
  await planner.getByRole('tab', { name: 'Planning' }).click()
  await page.waitForTimeout(800)
  await shot('linkedin-planner')

  const scroll = top => page.evaluate(top => document.querySelector('[data-page-scroll]')?.scrollTo(0, top), top)
  await go(`/project?id=p_amber`)
  await page.getByText('Feuille de route').first().waitFor()
  await page.evaluate(() => { const scroller = document.querySelector('[data-page-scroll]'), title = Array.from(document.querySelectorAll('*')).find(node => node.childElementCount === 0 && node.textContent === 'Feuille de route'); if (scroller && title) scroller.scrollTo(0, title.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 40) })
  await shot('project')
  await go('/module?package=builtin.week&contribution=planner')
  await page.frameLocator('iframe[title="Module amber"]').getByRole('button', { name: 'Gérer les semaines', exact: true }).waitFor()
  await scroll(290)
  await shot('week')
  await go('/marketplace')
  await page.getByText('Installés', { exact: false }).first().waitFor()
  await shot('marketplace')
  await go('/home')
  await shot('home')
  await page.evaluate(() => window.api.core.command('preferences.update', { patch: { themeMode: 'dark' } }))
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'))
  await go('/home')
  await shot('home-dark')
} finally {
  await app.close().catch(() => {})
  fs.rmSync(temp, { recursive: true, force: true })
  if (personalDirs.map(fingerprint).join(',') !== before) { console.error('  ✗ Le répertoire personnel a changé !'); process.exitCode = 1 }
  else console.log('  ✓ Répertoire de données personnel inchangé')
}
