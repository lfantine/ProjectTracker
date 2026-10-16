# Lot 5 — Portage et hôtes du shell

## Preuves reproductibles

| Exigence | Implémentation | Validation |
| --- | --- | --- |
| CORE enregistré, sans code importé | Registre commun + tables d'adaptateurs blocs et widgets de l'accueil | Tests registres/catalogue, typecheck, E2E accueil |
| Véritable archive livrée/importable | Builder reproductible et inventaire d'empreintes ; hook de compilation Nextron ; même `PackageManager` | Tests ZIP livré/manuellement importé ; activation réelle Chromium |
| Parité planning | Package navigateur : grille, gestes, champs, réveils, suppression, copie/collage, projets/liens, instances | Tests DOM et parcours `test:runtime` avec le vrai ZIP |
| Pas de privilège natif package | SDK via bootstrap, origine par contexte, session non persistante et proxy fermé | Harnais de confinement ; E2E normal : `api`/`require` absents de la frame |
| Routes et façade | `/module` et `/dashboard` exportés statiquement ; `/week` hôte sans store Semaine | Build et `tests/electron/modules.e2e.mjs` |
| Vrais hôtes | `ModuleHost`, `ModuleLauncher`, coordinateur natif du shell ; majeur, mineur projet et widget accueil fixe | E2E via le vrai `main.ts` et les preloads compilés |
| Liaison fixe/active | Résolution native depuis les placements ou la route de majeur, nouvelle vérification de version/fichiers/droits | Tests services launch/contexts + runtime + E2E sélection fixe et mineur |
| Révocation/remontage | Changement de nom/instance/placement, navigation principale seulement ; événements de navigation limités au contexte source | Tests DOM hôte, services, renommage et sélection dans le vrai shell |
| Ancien cache retiré | Snapshot/store sans champs/commandes Semaine ; commandes refusées par IPC, batch inclus | E2E snapshot et refus ; tests legacy sur projection explicite |
| Reprise sans réimport | Namespace/document/instances SQLite existants, import du code seulement ; aucun réensemencement sur lecture | Tests migration/compatibilité/runtime et E2E redémarrage |

Commandes : `npm run typecheck`, `npm test`, `npm run test:runtime`,
`node scripts/e2e.mjs --build`, `git diff --check`.
Les résultats réellement obtenus et les nombres de tests figurent au journal de `PLANS/PLAN.md` (local).

## Frontières conservées

- `EXTERNAL_RUNTIME_QUALIFIED` et `PERSONAL_SQLITE_MIGRATION_QUALIFIED` restent faux.
- L'intégration utilise le vrai binaire de production mais n'est admise qu'avec
  `PROJECT_TRACKER_TEST=1` et `PROJECT_TRACKER_MODULES=1`, une base réelle sous le
  temporaire système vérifiée par `realpath`, et sa racine gérée sœur. Aucune API
  renderer ne peut sélectionner un chemin ou lever cette garde.
- Accords import/activation déterministes uniquement dans cette qualification
  synthétique. Suppression d'instance et liens externes restent confirmés nativement.
- Le protocole local et le protocole plugin sont déclarés ensemble avant ready ;
  aucun ajout dans la session par défaut ou le dev-server HTTP. DNS/WebRTC et
  proxy fermé conservés. Le shell ne reçoit que ses ressources locales ; une
  sous-frame n'obtient pas ses ressources ni ses handlers IPC.
- Pas de CRUD/composition libre de dashboards/sidebar (lot 6), marketplace finale,
  moteur de slots/features/thèmes (lot 7), migration personnelle, ASAR/installateur,
  qualification Windows/Linux ou récupération de distribution (lot 8).
- Les composants/helpers historiques restants servent aux tests de compatibilité,
  pas à un second écran actif ni à une seconde source de vérité.
