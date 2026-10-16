# Créer un module pour amber

> **Guide pratique et référence pour les prochaines sessions — 16 octobre 2026.**
> Décrit le format et le SDK réellement présents dans ce dépôt, pas le futur
> outillage npm. Avant une modification, lire `AGENTS.md`, `PLANS/PLAN.md` (local ; notamment
> son dernier journal) et vérifier les contrats dans le code.

## 1. Comprendre ce qu'on crée

Un **package** est l'unité installable : une archive ZIP avec un manifeste et
ses ressources déjà compilées. Il peut contenir plusieurs **contributions** :

| Contribution | Usage | Instance métier |
| --- | --- | --- |
| `major` : module majeur | Page complète, accessible par un shortcut | Peut gérer plusieurs instances nommées |
| `minor` : module mineur | Bloc placé dans un projet | Indépendant, ou lié à un majeur |
| `widget` | Élément placé dans un dashboard | Indépendant, ou lié à un majeur |

Exemple : le package **Semaine type** contient un calendrier majeur, un mineur
« Créneaux du projet » et un widget « Planning du jour ». Une semaine nommée est
une **instance**, pas un autre package. Un widget posé deux fois correspond à
deux **emplacements**, pas nécessairement deux instances.

Une **extension** est différente : `theme` pour des jetons de présentation,
`features` pour un slot déclaré par une cible. Ne pas créer une extension si
l'objectif est une fonctionnalité autonome.

### Où tourne le code ?

Chaque contribution s'exécute dans une frame isolée `pt-plugin://…`, jamais
directement dans le renderer React ou le processus principal d'amber.

- HTML, CSS, JavaScript et frameworks embarqués sont possibles.
- Le SDK est disponible via **`await ProjectTracker.ready`**.
- Pas de Node/Electron, `window.api`, IPC libre, SQL, accès natif aux fichiers ou
  import des stores/composants internes du renderer.
- Pas de CDN, scripts inline, `eval`, HMR réseau, `fetch` direct ou WebSocket.
  Les appels HTTPS autorisés passent par `sdk.network.fetch`.
- L'import ne lance ni compilation, ni `npm install`, ni script d'installation.
- Les données métier sont persistées par le SDK, dans SQLite côté hôte. Ne pas
  utiliser le stockage navigateur comme source de vérité durable.

**À ne pas inventer aujourd'hui :** `amber.module.render`, `@amber/react`,
`npm create amber-package` ou un CLI public. Ce sont des pistes du document
[AUTHORING-TOOLKIT.md](AUTHORING-TOOLKIT.md), pas des API utilisables.

## 2. Premier exemple complet : un widget compteur

On commence volontairement par un widget indépendant : aucune instance n'est
nécessaire. Son compteur est partagé entre les emplacements de **ce même package**
(`scope: 'package'`). La section 7 explique comment passer à un majeur et à des
compteurs distincts par instance.

Créer manuellement les quatre fichiers suivants ; les blocs ci-dessous sont
leurs contenus complets :

```text
packages/demo-counter/
├── manifest.json
├── index.html
└── assets/
    ├── app.js
    └── style.css
```

Le nom du dossier source est libre. Ne pas ajouter ce package aux bundles de
l'app pour le tester : un import ZIP explicite suffit. `demo.counter` est une
identité d'exemple ; choisir une identité propre et stable pour un vrai package.

### `manifest.json`

```json
{
  "manifestVersion": 1,
  "kind": "package",
  "id": "demo.counter",
  "name": "Compteur",
  "description": "Un compteur persistant de démonstration.",
  "author": "Votre nom",
  "version": "1.0.0",
  "hostApi": "^1.0.0",
  "dependencies": {},
  "permissions": {},
  "storageVersion": 1,
  "contributions": [
    {
      "id": "counter",
      "type": "widget",
      "name": "Compteur",
      "entry": "index.html",
      "icon": "chart",
      "size": {
        "default": { "w": 3, "h": 4 },
        "min": { "w": 2, "h": 3 }
      }
    }
  ]
}
```

Les identifiants utilisent minuscules ASCII, chiffres, points et tirets, sans
segments vides ; `core` est réservé. `permissions: {}` suffit pour son propre
stockage : il n'existe pas de permission `storage` à ajouter au manifeste.

### `index.html`

Les chemins sont **relatifs à ce fichier**, pas à la racine de l'ordinateur.
Les scripts doivent être des fichiers locaux séparés, sans `onclick` inline.

```html
<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Compteur</title>
    <link rel="stylesheet" href="assets/style.css">
  </head>
  <body>
    <main aria-label="Compteur">
      <h2>Compteur</h2>
      <output id="count" aria-live="polite">…</output>
      <button id="increment" type="button" disabled>Ajouter 1</button>
      <button id="reload" type="button">Actualiser</button>
      <p id="status" role="status"></p>
    </main>
    <script src="assets/app.js" defer></script>
  </body>
</html>
```

### `assets/app.js`

Les écritures utilisent la révision du document lu (**CAS**), pas une sauvegarde
aveugle. Un conflit ne relance pas automatiquement l'incrément : il recharge la
valeur et laisse l'utilisateur décider de recommencer.

```js
void (async () => {
  const count = document.getElementById('count');
  const increment = document.getElementById('increment');
  const reload = document.getElementById('reload');
  const status = document.getElementById('status');
  let sdk;
  let documentValue = null;
  let loading = 0;
  let busy = false;
  let stopped = false;
  let unsubscribe;
  let stopContext;
  const address = { scope: 'package', collection: 'counters', id: 'main' };

  function showError(error) {
    if (stopped) return;
    status.textContent = error?.code === 'CONFLICT'
      ? 'Modifié ailleurs. Valeur rechargée ; réessaie si nécessaire.'
      : 'Lecture ou enregistrement impossible. Réessaie avec Actualiser.';
  }

  async function load() {
    const request = ++loading;
    const value = await sdk.storage.get(address);
    if (stopped || request !== loading) return;
    documentValue = value;
    const current = value?.value?.count;
    count.textContent = String(Number.isSafeInteger(current) ? current : 0);
  }

  window.addEventListener('pagehide', () => {
    stopped = true;
    stopContext?.();
    void unsubscribe?.();
  }, { once: true });

  reload.addEventListener('click', () => {
    if (!sdk || busy || stopped) return;
    void load().then(() => {
      if (!stopped) { increment.disabled = false; status.textContent = ''; }
    }).catch(showError);
  });

  try {
    sdk = await ProjectTracker.ready;
    if (stopped) return;
    const applyTheme = context => { document.documentElement.style.colorScheme = context.theme.mode; };
    applyTheme(sdk.context);
    stopContext = sdk.onContextChange(applyTheme);
    unsubscribe = await sdk.events.subscribe(['storage.changed'], event => {
      if (event.payload.collection === address.collection && event.payload.id === address.id) {
        void load().catch(showError);
      }
    });
    if (stopped) { await unsubscribe(); return; }
    await load();
    increment.disabled = false;
  } catch (error) {
    showError(error);
    if (!sdk) return;
  }

  increment.addEventListener('click', async () => {
    if (busy || stopped) return;
    busy = true;
    increment.disabled = true;
    status.textContent = '';
    const previous = documentValue;
    const current = previous?.value?.count;
    const next = (Number.isSafeInteger(current) ? current : 0) + 1;
    try {
      if (!Number.isSafeInteger(next)) throw new Error('Limite du compteur');
      await sdk.storage.put({
        ...address,
        value: { count: next },
        expectedRevision: previous?.revision ?? null
      });
      await load();
    } catch (error) {
      if (error?.code === 'CONFLICT') await load().catch(() => {});
      showError(error);
    } finally {
      busy = false;
      if (!stopped) increment.disabled = false;
    }
  });

})();
```

Cet exemple traite une valeur simple et ne remplace pas une vraie validation de
modèle métier. Pour des formulaires, conserver les brouillons en cas d'erreur et
ne jamais annoncer une sauvegarde avant l'accusé de réception natif.

### `assets/style.css`

Le shell n'ajoute pas de carte autour du widget : choisir son propre rendu sans
imposer une deuxième « bulle ». Le thème du contexte est aussi consultable dans
`sdk.context.theme` et via `sdk.onContextChange`.

```css
:root {
  font-family: system-ui, sans-serif;
  color-scheme: light dark;
  --text: var(--amber-text, light-dark(#29231c, #f7f1e7));
  --surface: var(--amber-surface, light-dark(#f4f0e8, #2a251e));
  --accent: var(--amber-accent, light-dark(#a65308, #f4b544));
}
* { box-sizing: border-box; }
body { margin: 0; color: var(--text); background: transparent; }
main { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 12px; }
h2, p { margin: 0; flex-basis: 100%; }
h2 { font-size: 16px; }
output { font-size: 32px; font-variant-numeric: tabular-nums; }
button { font: inherit; color: var(--text); background: var(--surface); padding: 8px 12px; border: 1px solid var(--accent); border-radius: 8px; cursor: pointer; }
button:disabled { opacity: .5; cursor: default; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
#status { font-size: 12px; }
```

## 3. Produire le ZIP

Ici, le JavaScript est déjà exécutable : pas de compilation nécessaire.
Depuis la racine du dépôt, sur macOS avec `zip` installé :

```bash
mkdir -p dist/packages
# Retirer uniquement cette sortie générée évite les anciens fichiers résiduels du ZIP.
rm -f dist/packages/demo.counter-1.0.0.zip
(cd packages/demo-counter && zip -X ../../dist/packages/demo.counter-1.0.0.zip \
  manifest.json index.html assets/app.js assets/style.css)
```

Le ZIP doit contenir **directement** `manifest.json`, pas un dossier parent
`demo-counter/`. Ne pas inclure `node_modules`, `.DS_Store`, `__MACOSX`, les sources
non compilées, des liens symboliques ou des secrets. Pour un vrai script de build,
utiliser une liste explicite de ressources, des noms portables et une sortie
reproductible ; voir `scripts/build-week-package.mjs`.

### Avec TypeScript / React / autre framework

Les sources peuvent être organisées librement (`src/view.ts`, `src/App.tsx`, etc.).
Compiler pour le **navigateur** et embarquer les dépendances dans les ressources
locales. L'archive finale reste HTML + JS + CSS + manifeste, pas du TSX brut.

Dans le dépôt, les types se trouvent dans `sdk/src/index.ts`. Exemple de typage
pour un fichier `packages/demo-counter/src/view.ts` :

```ts
import type { ProjectTrackerSdk } from '../../../sdk/src/index';
const sdk: ProjectTrackerSdk = await ProjectTracker.ready;
```

Ce n'est pas un nom de package npm publié. Un bundler doit supprimer cet import
de types ; ne pas laisser un import vers les fichiers du dépôt dans le ZIP.
Pour une compilation IIFE, envelopper les `await` dans une fonction `async`
(comme l'exemple JS). Le build réel de Semaine type utilise `esbuild`,
`platform: 'browser'`, `format: 'iife'`, sans sourcemap distante ni chargement CDN.
React peut monter dans un élément **de sa propre frame** avec son renderer embarqué,
mais ne doit pas importer les composants/stores du shell.

## 4. Valider et essayer sans toucher aux données personnelles

### Avant import

- Valider le manifeste avec `validateManifest()` de `shared/manifest.ts` ; le
  JSON Schema seul ne couvre pas les règles croisées.
- Vérifier toutes les références avec `missingFiles()` et contrôler le ZIP réel
  avec `prepareArchive()` de `main/packages/archive.ts`, dans un répertoire
  temporaire ; appeler `dispose()` dans un `finally`.
- Les limites exécutables sont dans `shared/limits.ts` : ZIP 100 Mio, extraction
  250 Mio, fichier 25 Mio, manifeste 256 Kio, 5 000 fichiers maximum.
- Le manifeste est strict : pas de champs inventés, `integrations` obligatoire
  pour un majeur, `size.default` obligatoire pour un widget.

### Import dans amber

Dans une app locale qualifiée, l'utilisateur peut :

1. Ouvrir le **Marketplace** (onglet « Modules à installer »), puis **Importer un ZIP**.
2. Choisir l'archive et confirmer les droits dans le dialogue natif d'import, puis
   celui d'activation : le bouton enchaîne import et activation (prévalidation dans
   le runtime isolé). En cas de refus ou d'échec, la carte reste « À activer ».
3. La fiche du package s'ouvre : **Ouvrir**, **Ajouter au menu**, **Ajouter à un
   dashboard** ou **Ajouter à un projet** selon ses contributions.

Chaque carte affiche un seul statut (Actif, À activer, Mise à jour, Désactivé,
Disponible, Désinstallé) et une seule action principale. **Importer, activer et
placer restent trois états natifs distincts** ; seule l'interface enchaîne les deux
premiers, chacun derrière son accord natif. Lier un dossier de ZIP affiche ses
archives dans « Disponibles », sans compiler un dossier source ni les activer
automatiquement.
La suppression d'un emplacement ne supprime pas ses données métier.

### Pour les sessions de développement / tests

Ne pas tester par défaut sur `~/.data/amber` (ni l'ancien `~/.data/ProjectTracker`) et ne pas lancer
`start:local` automatiquement pour vérifier un package. Ce lancement volontaire
utilise le profil personnel de l'utilisateur.

```bash
npm run typecheck
npm test
npm run test:runtime
# Recompile le shell et exécute les scénarios Electron avec données/profils jetables :
node scripts/e2e.mjs --build
```

Ces suites ne découvrent **pas automatiquement** le nouveau package d'exemple.
Ajouter des tests dédiés à son modèle, à son ZIP et à son montage réel en reprenant
`tests/services/week-package.test.ts`, `tests/electron/runtime-harness.cjs` et
`tests/electron/modules.e2e.mjs`. Les services de tests SQLite sont exécutés sous
Electron en mode Node par le runner du dépôt.

L'hébergement externe n'est pas un plugin HMR de `npm run dev` : l'admission
personnelle est limitée à la build empaquetée macOS arm64 / Electron qualifié.
Employer les harnais isolés, pas un contournement des gardes. Ne pas lancer deux
builds en parallèle : ils nettoient `app/` et `dist/`.

## 5. Référence SDK courte

Lire les signatures exactes dans `sdk/src/client.ts` et `shared/sdk.ts` avant de
coder : les exemples ne donnent pas accès à des méthodes supplémentaires.

| Besoin | API actuelle | Points à respecter |
| --- | --- | --- |
| Contexte | `sdk.context`, `sdk.call('context.get', {})`, `sdk.onContextChange(handler)` | Identités et droits viennent de l'hôte ; ne pas les fabriquer |
| Documents | `sdk.storage.get/put/delete/list` | Collection, ID, scope, révision et pagination |
| Instances | `sdk.instances.list/create/rename/delete/setActive/select` | Mutations réservées au majeur ; sélection ≠ instance active |
| Données CORE | `sdk.core.list/get/update` | Ressource et droits explicites ; vues limitées, pas de snapshot global |
| Configuration | `sdk.config.update(values, expectedRevision)` | Révision d'emplacement, schéma déclaré et contexte compatible |
| Événements | `sdk.events.subscribe(topics, handler)` | Retourne une fonction de désabonnement asynchrone |
| Navigation | `sdk.navigation.open(target)` | Cibles fermées ; pas de route arbitraire |
| Autre package | `sdk.packages.readExport(query)` | Export public, dépendance compatible et permission |
| HTTPS | `sdk.network.fetch(request)` | Origines déclarées/accordées ; pas de réseau direct |

### Stockage et concurrence

- `storage.get` retourne un document avec `value` et `revision`, ou `null`.
- `storage.put` exige `expectedRevision: null` pour créer un document absent,
  ou la révision lue pour le modifier ; retourne `{ revision }`.
- `storage.delete` exige la révision courante.
- Choisir explicitement `scope: 'package'` ou `scope: 'instance'`. Le premier
  partage les données entre contributions du même package ; le second suit
  l'instance résolue de ce contexte, pas l'identité de l'emplacement.
- Ne pas envoyer `packageId`, SQL ou chemin de base dans une adresse de stockage.
- `list` est paginé (`items`, `nextCursor`) : parcourir les pages, pas seulement
  les 200 premiers éléments. Document ≤ 1 Mio, stockage privé/package ≤ 50 Mio,
  message SDK ≤ 2 Mio.
- Les notifications sont des invalidations **après commit** : relire les données
  utiles, ne pas traiter chaque événement comme un document métier complet.
- `CONFLICT` : garder le brouillon, relire et proposer une résolution ; ne pas
  boucler en écrasant les modifications concurrentes.
- `UNAVAILABLE` peut signifier contexte révoqué : l'hôte remonte une nouvelle
  frame lors d'un changement de liaison/version. Ne pas réutiliser un ancien port.

## 6. Configuration, logo et interface

### Configuration par emplacement

Ajouter `config` à une contribution avec `version` et `fields` ; types disponibles :
`string`, `number`, `boolean`, `choice`, `list`. Le shell produit un formulaire ;
valeurs dans `sdk.context.config`. Voir le JSON complet dans [FORMAT.md](FORMAT.md).

Deux widgets peuvent partager un compteur métier mais avoir des configurations
visuelles différentes. Ne pas mélanger ces deux niveaux. `customUi: true` permet
une interface interne de réglages, mais ne crée pas une API globale de préférences.
La mutation nécessite `configRevision` non nulle ; les majeurs sans emplacement
et slots ne disposent pas de cette configuration persistante.

### Logo du package ≠ icône d'une contribution

Le champ optionnel `logo: "assets/logo.png"` se place **à la racine du manifeste**.
Ajouter ce PNG à l'archive et au script de build. PNG statique uniquement,
≤ 256 Kio, de 1 à 1024 pixels par côté ; ressources locales, pas d'URL/SVG/animation.
Le natif valide les octets, retire les métadonnées et contrôle l'inventaire avant
l'affichage dans le shell. Sans logo utilisable, une initiale sert de repli.

`icon` est au contraire un nom du catalogue fermé `HOST_ICONS` dans
`shared/version.ts` (`calendar`, `chart`, `note`, etc.). Les shortcuts restent
personnalisables indépendamment du logo.

### Règles UX actuelles à conserver

- Un majeur utilise la hauteur naturelle et le scroll de page : éviter
  `height: 100vh` et les conteneurs internes à hauteur fixe sans raison métier.
  Le bootstrap communique sa hauteur à l'hôte ; ne pas inventer un nouveau pont.
  L'hôte garantit en plus une hauteur **minimale** égale à la zone visible de la
  page (moins les compléments affichés dessous) : une page courte ne rogne plus
  ses dialogs. Widgets et mineurs gardent leur hauteur d'emplacement.
- Le titre du majeur est intégré au shell ; éviter un deuxième grand titre
  identique dans son contenu.
- Widgets/mineurs s'adaptent aux dimensions de leur emplacement ; la présentation
  et les éventuels fonds/bordures appartiennent au package, pas à un wrapper imposé.
- Dialogs/menus dans la frame pour les interactions locales ; la navigation SDK
  sert à changer de vue, pas à remplacer chaque édition par une page.
- Les variables `--amber-viewport-top` et `--amber-viewport-height` permettent de
  placer les éléments sticky/dialogs dans la partie visible d'une grande frame.
- Prévoir clavier, focus visible, noms accessibles, états vide/chargement/erreur,
  clair/sombre et nettoyage des listeners/timers/abonnements au démontage.

## 7. Ajouter un module majeur et des instances

Pour un majeur seul, une contribution complète peut être :

```json
{
  "id": "counter-page",
  "type": "major",
  "name": "Mes compteurs",
  "entry": "counter.html",
  "icon": "chart",
  "integrations": [],
  "instanceLabel": "Compteur",
  "minInstances": 0
}
```

Ce bloc remplace/complète une entrée de `contributions`, pas le manifeste entier.
Créer aussi `counter.html` et l'inclure dans le ZIP.

**Une déclaration de majeur ne crée pas automatiquement une instance**, même
avec `minInstances: 1` : ce champ protège un minimum lors des suppressions.
La page doit gérer le cas `sdk.context.instance === null` et proposer une création.

Parcours à implémenter dans le majeur :

1. `sdk.instances.list()` (paginer si nécessaire) pour connaître ses instances.
2. Sur une action utilisateur, `sdk.instances.create({ name: 'Mon compteur' })`.
   Pour un retry d'une même création, conserver et réutiliser le même `operationId`.
3. Selon l'intention, consulter avec `sdk.instances.select(instanceId)` ou changer
   l'active avec `sdk.instances.setActive(instanceId, expectedActiveInstanceId)`.
   Ne pas considérer ces opérations comme équivalentes.
4. L'hôte peut révoquer/remonter la page : attendre le nouveau contexte, ne pas
   conserver une ancienne résolution d'instance.
5. Stocker la valeur avec `scope: 'instance'` pour avoir un compteur par instance.
   Un majeur peut adresser explicitement une autre de **ses** instances ; un
   mineur/widget associé est limité à sa liaison résolue.

Pour associer le widget `counter` au majeur `counter-page` :

- ajouter `"major": "counter-page"` sur le widget ;
- mettre `"integrations": ["counter"]` sur le majeur ;
- adapter **les deux vues** au scope instance, au contexte vide et aux changements
  de liaison ; ne pas garder le stockage package de l'exemple sans le décider ;
- permettre à chaque emplacement de suivre l'active ou une instance fixe via
  l'éditeur du shell, sans coder un ID fixe dans le package.

La relation doit être réciproque. Un mineur suit le même principe (`type: 'minor'`,
`major` optionnel, pas de champ `size`). Un composant indépendant omet `major`.

## 8. Permissions, réseau et données des autres packages

Ne demander que les capacités nécessaires. Le manifeste déclare les droits et
le natif exige l'accord utilisateur ; le code ne peut pas s'auto-autoriser.

- Lire des projets : `permissions.core.projects: ["read"]`, puis
  `sdk.core.list({ resource: 'projects' })`. Ce n'est pas un accès aux tâches,
  fichiers, réglages ou données privées de tout le socle.
- Écrire du CORE : droit `write`, champs autorisés et `expectedRevision` ; voir
  les vues `CoreProjectView`, `CoreNoteView`, `CoreErrorView` de `shared/sdk.ts`.
- API externe : origine HTTPS exacte dans `permissions.network`, puis
  `sdk.network.fetch`. Pas de joker, localhost, IP littérale ni cookies de session
  récupérés implicitement ; redirections et DNS sont revalidés nativement.
- Ouvrir une page web : `sdk.navigation.open({ kind: 'external', url })`, soumis
  à confirmation native. Ce n'est pas un droit de lecture réseau.
- Lire un autre package : export déclaré par le fournisseur, dépendance SemVer
  compatible et `permissions.exports` explicite chez le consommateur. Cela
  fonctionne pour un package ordinaire aussi, pas seulement une extension.

Exemple de champs **à fusionner** dans le manifeste d'un consommateur :

```json
{
  "dependencies": { "builtin.week": "^1.1.2" },
  "permissions": {
    "exports": [{ "package": "builtin.week", "export": "week-slots" }]
  }
}
```

Puis `sdk.packages.readExport({ package: 'builtin.week', export: 'week-slots' })`.
Cet export est par instance ; l'appel sans ID suit l'active du fournisseur.
Consulter sa déclaration et le modèle `packages/builtin-week/src/model.ts`
avant d'interpréter les documents. Aucun accès aux collections non exportées,
aucune écriture inter-namespace et aucun bouton « accès à tout ».

## 9. Versions, mises à jour et migrations

- **`version`** : version SemVer du code. Les versions gérées sont immuables :
  pour modifier HTML/JS/CSS/logo/manifeste, produire une nouvelle version, pas un
  ZIP différent portant le même numéro déjà importé.
- **`storageVersion`** : version du format des données. Ne pas l'incrémenter pour
  un changement purement visuel et ne pas réécrire les documents sans nécessité.
- En cas de changement de stockage, déclarer `migrations: { entry, steps }`,
  fournir une chaîne complète et tester succès, échec et annulation sur une copie
  temporaire. L'entrée de migration n'utilise pas le stockage actif normal :
  API `migration.*`, copie privée, validation et commit appartenant au natif.
- Élargir les droits nécessite un nouvel accord utilisateur. Dépendances absentes,
  API incompatible, code altéré et migrations invalides ne doivent pas être ignorés.
- Désactiver/désinstaller conserve les données ; ne pas compter sur ces actions
  pour réinitialiser un test. Utiliser un profil jetable neuf.
- La mise à jour automatique étroite du **package livré Semaine type** est une
  exception interne, pas un mécanisme d'auto-update pour les nouveaux packages.

## 10. Checklist d'une prochaine session

- [ ] Lire les consignes et le dernier état de `PLANS/PLAN.md`, examiner Git et préserver
      tout travail existant ; guides Next.js locaux si modification du renderer.
- [ ] Définir package/contributions/instances/emplacements et modèle de données.
- [ ] Choisir des identifiants stables, un manifeste validé et les droits minimaux.
- [ ] Implémenter les interfaces dans le package, pas dans les stores/pages CORE.
- [ ] Traiter CAS, brouillons, pagination, états absents et nettoyage du cycle de vie.
- [ ] Inclure toutes les ressources compilées, éventuellement le logo, dans le ZIP.
- [ ] Tester le modèle, l'archive réelle, le SDK et la frame dans un profil temporaire.
- [ ] Tester plusieurs placements, instance active/fixe, redémarrage et conflits.
- [ ] Si mise à jour : nouvelle version, données conservées et migration si nécessaire.
- [ ] Actualiser la documentation et le journal de `PLANS/PLAN.md` avec les validations
      **réellement exécutées**, sans présenter une API future comme disponible.

## 11. Sources de vérité et exemples à lire

| Source | Rôle |
| --- | --- |
| `shared/manifest.ts`, `shared/schema/manifest.schema.json` | Manifeste strict et schéma généré |
| `shared/sdk.ts`, `sdk/src/client.ts`, `sdk/src/index.ts` | Contrats SDK, signatures et types |
| `shared/limits.ts`, `shared/permissions.ts`, `shared/bindings.ts` | Quotas, droits et liaisons |
| `main/packages/archive.ts`, `main/packages/logo.ts` | Validation des archives et logos |
| `packages/builtin-week/` | Package complet réellement livré |
| `scripts/build-week-package.mjs` | Compilation navigateur et ZIP reproductible |
| `packages/builtin-amber-theme/`, `packages/builtin-week-report/` | Exemples d'extensions |
| `tests/fixtures/manifests/valid/` et `invalid/` | Manifestes admis/refusés |
| [FORMAT.md](FORMAT.md), [REGISTRY.md](REGISTRY.md) | Référence détaillée du format et du registre |
| [LOT8-PROGRESS.md](LOT8-PROGRESS.md), [UX-REFINEMENT.md](UX-REFINEMENT.md) | Admission actuelle et comportements UX |
| [AUTHORING-TOOLKIT.md](AUTHORING-TOOLKIT.md) | Proposition d'outillage npm futur, pas le workflow actuel |

Certaines sections de qualification de `FORMAT.md` et `INSTALLER.md` décrivent
les anciens lots isolés. Pour l'état d'admission actuel, le dernier journal de
`PLANS/PLAN.md`, le rapport du lot 8 et le code priment sur ces mentions historiques.
