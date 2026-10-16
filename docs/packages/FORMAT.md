# Format des packages et extensions — version 1

Pour démarrer pas à pas avec un exemple complet : [Créer un module](CREER-UN-MODULE.md).

> Référence pour les auteurs. Le contrat exécutable est `shared/manifest.ts` ; le schéma structurel publié est
> `shared/schema/manifest.schema.json` (généré, ne pas modifier à la main). Les règles transversales ci‑dessous
> (associations, dépendances, chemins, origines) ne sont pas exprimables en JSON Schema : elles sont appliquées par
> `validateManifest()` et couvertes par les fixtures de `tests/fixtures/manifests/`.

## Archive

Un package est une archive **ZIP** contenant à sa racine un fichier `manifest.json`, des ressources locales et, si
nécessaire, du HTML/CSS/JavaScript **déjà compilé**. L'application ne compile rien, n'exécute aucun script
d'installation, n'installe aucune dépendance npm et ne charge rien depuis un CDN.

```
mon-package.zip
├── manifest.json
├── planner.html        ← point d'entrée d'une contribution
├── assets/app.js
└── assets/style.css
```

Limites (valeurs de `shared/limits.ts`) : archive ≤ 100 Mio, extraction totale ≤ 250 Mio (octets réellement
décompressés), fichier ≤ 25 Mio, au plus 5 000 fichiers, manifeste ≤ 256 Kio. Sont refusés : chemins absolus ou
sortant de l'archive, segments `.`/`..`, antislash, liens symboliques, entrées en double (y compris à la casse près)
et entrées chiffrées.

## Identités

| Notion | Exemple | Règle |
| --- | --- | --- |
| Identifiant du package | `builtin.week` | minuscules ASCII, chiffres, points, tirets ; `core` est réservé. Stable dans le temps. |
| Identifiant de contribution | `planner` | même alphabet, unique dans le manifeste. |
| Instance métier | `week-default` | créée par l'hôte pour un module majeur (ex. une semaine type nommée). |
| Emplacement | `w_3k2…` | bloc dans un projet ou widget sur un dashboard ; jamais réutilisé comme identité d'instance. |

## Champs communs

| Champ | Type | Description |
| --- | --- | --- |
| `manifestVersion` | `1` | Version du format. |
| `kind` | `"package"` \| `"extension"` | Package autonome ou extension d'un package cible. |
| `id`, `name`, `author` | chaînes | Identité et affichage. Le nom d'auteur n'est **pas** une preuve d'identité. |
| `description`, `homepage` | chaînes, optionnels | |
| `logo` | chemin `.png`, optionnel | Ressource locale statique ≤ 256 Kio / 1024 px par côté ; voir le complément métadonnées. |
| `version` | SemVer | Version du code. |
| `hostApi` | contrainte SemVer | Versions de l'API hôte supportées (hôte actuel : `1.0.0`). |
| `dependencies` | `{ id: contrainte }` | Dépendances explicites ; jamais téléchargées implicitement. |
| `permissions` | objet | Voir ci‑dessous. |
| `storageVersion` | entier ≥ 1 | Version du format de stockage, indépendante de `version`. |
| `migrations` | `{ entry, steps }` optionnel | Page de migration isolée ; `steps: [N, …]` déclare les étapes N → N+1. Une mise à jour exige une chaîne complète. |

## Package autonome (`kind: "package"`)

`contributions` (au moins une) :

| Type | Champs spécifiques |
| --- | --- |
| `major` | `integrations` (**obligatoire**, éventuellement vide) : identifiants locaux des mineurs/widgets qui consomment ses instances ; `instanceLabel` optionnel ; `minInstances` entier 0–100 optionnel (0 par défaut), minimum conservé atomiquement par le natif lors des suppressions, sans création automatique. |
| `minor` | `major` optionnel : identifiant local du majeur dont il consomme les instances. Absent = composant indépendant. |
| `widget` | `major` optionnel ; `size: { default, min?, max? }` en unités de grille (`w` 1–12, `h` 1–24). |

Champs communs aux contributions : `id`, `type`, `name`, `description?`, `entry` (fichier `.html` relatif à la racine
de l'archive), `icon?` (liste fermée de l'hôte : `home`, `folder`, `note`, `alert`, `search`, `settings`, `sparkles`,
`calendar`, `terminal`, `code`, `link`, `image`, `chart`, `video`, `store`, `shopping-bag`, `check`, `pin`, puis `star`, `heart`, `flag`, `bookmark`, `bell`, `mail`, `message`, `user`, `users`, `briefcase`, `book`, `graduation`, `lightbulb`, `target`, `rocket`, `trophy`, `zap`, `clock`, `map`, `globe`, `music`, `camera`, `coffee`, `gift`, `wallet`, `dumbbell`, `leaf`, `palette`, `puzzle`, `linkedin`, `shield`, `sun`, `moon`, `cloud`, `lock`, `phone`) et
`config?`.

**Réciprocité :** si un majeur liste `x` dans `integrations`, la contribution `x` doit déclarer `major` vers ce
majeur, et inversement. Un mineur ou widget n'est intégré que par un seul majeur.

`exports` (optionnel) : données **en lecture seule** exposées aux autres packages —
`{ id, version, collections, scope: "instance" | "package", major? }`. Un export par instance désigne le majeur dont
l'instance est résolue.

`slots` (optionnel) : points d'extension pour les extensions `features` — `{ id, version, contribution }`, portés par
un majeur.

### Configuration d'une contribution

```json
"config": {
  "version": 1,
  "fields": [
    { "key": "title", "type": "string", "label": "Titre", "default": "" },
    { "key": "count", "type": "number", "label": "Nombre", "min": 1, "max": 10, "integer": true, "default": 3 },
    { "key": "done", "type": "boolean", "label": "Afficher les terminés", "default": false },
    { "key": "mode", "type": "choice", "label": "Mode", "options": [{ "value": "a", "label": "A" }], "default": "a" },
    { "key": "tags", "type": "list", "item": "string", "label": "Étiquettes", "maxItems": 10 }
  ],
  "customUi": false
}
```

L'hôte génère un formulaire pour ces types et valide toute configuration avant de l'enregistrer. Avec
`customUi: true`, la contribution fournit sa propre interface de réglages dans sa frame isolée.

## Extension (`kind: "extension"`)

Champs supplémentaires : `extensionType` (`"theme"` ou `"features"`) et `target: { package, version }`. La cible
compte comme dépendance obligatoire ; si elle figure aussi dans `dependencies`, la contrainte doit être identique.
Une extension ne déclare pas de `contributions`.

- **theme** : `theme` désigne un fichier `.json` de jetons (couleurs, fonds PNG/JPEG/WebP locaux, textes sur des
  clés exposées). Aucun JavaScript, CSS, HTML ou SVG arbitraire n'est exécuté ou injecté dans l'hôte. Un seul thème
  actif par cible ; le mode clair/sombre/système reste indépendant.
- **features** : `features: [{ id, name, description?, slot: { id, version }, entry }]`. Chaque entrée s'affiche dans
  le slot documenté de la cible, dans son propre contexte isolé.

## Permissions

```json
"permissions": {
  "core": { "projects": ["read"], "notes": ["read", "write"] },
  "network": ["https://api.example.com"],
  "exports": [{ "package": "builtin.week", "export": "week-slots" }]
}
```

- `core` : ressources `projects`, `notes`, `errors` ; actions `read` et/ou `write`. Le stockage privé et les
  instances du package sont implicites mais cloisonnés.
- `network` : origines HTTPS **exactes** (pas de joker, de chemin, d'identifiants, de `localhost` ni d'adresse IP).
  Les appels passent par le service réseau de l'hôte, qui revérifie la destination et chaque redirection.
- `exports` : lecture d'un export déclaré par un autre package ; le fournisseur doit figurer dans `dependencies`
  (ou être la cible de l'extension).

L'installation demande l'accord de l'utilisateur pour l'ensemble des droits ; une mise à jour qui les étend demande un
nouvel accord. Aucun droit ne donne accès à Node.js, au système de fichiers, au terminal, à l'IA du socle ou à du SQL.

## SDK

Chaque contribution s'exécute dans une iframe isolée servie sur `pt-plugin://<contexte>/`. L'hôte charge le SDK avant
le code de la contribution ; il est disponible via `await ProjectTracker.ready` (voir `sdk/src/client.ts`). Familles :
`context`, `storage`, `instances`, `core`, `packages`, `events`, `navigation`, `network`. Toute méthode hors de cette
liste fermée est refusée. Les réponses portent un code d'erreur stable : `VALIDATION`, `NOT_FOUND`,
`PERMISSION_DENIED`, `CONFLICT`, `DEPENDENCY`, `INCOMPATIBLE`, `STORAGE`, `TIMEOUT`, `UNAVAILABLE`.

## Exemples

Les fixtures `tests/fixtures/manifests/valid/` illustrent les six formes : majeur seul, mineur seul, widget seul,
package combiné, thème et extension de fonctionnalités. `tests/fixtures/manifests/invalid/` liste les refus attendus.

## État réel du runtime (lot 3 qualifié en profil isolé)

Le bootstrap `ProjectTracker.ready`, l'hôte de frames et le pont natif sont maintenant raccordés **dans le harnais de qualification uniquement**. Aucun code externe n'est activé dans l'application normale. `npm run test:runtime` construit le code contrôlé de l'hôte, puis exerce le parcours dans un profil Electron et des données temporaires. La distribution des bundles avec l'application reste à qualifier.

Le broker natif implémente actuellement `context.get/updateConfig`, `storage.get/put/delete/list`, `instances.list/create/rename/delete/setActive/select`, `navigation.open` (cibles internes, liens web avec adaptateur de confirmation native), `core.get/list/update`, `packages.readExport`, `network.fetch` et `events.subscribe/unsubscribe`. Les autres méthodes échouent avec `UNAVAILABLE` : leur présence dans le contrat n'indique pas leur disponibilité. L'identité du package vient exclusivement du contexte natif. Un mineur/widget lié ne peut adresser qu'une instance résolue ; seul le majeur peut adresser une autre de ses propres instances. Le scope `package` est partagé par les contributions du même package.

Les écritures SDK de documents exigent `expectedRevision` : `null` pour créer un document absent, la révision lue pour le modifier ; la suppression exige la révision courante. Le quota est appliqué dans la même transaction que l'écriture. Une page est limitée à 200 documents, un message à 2 Mio, un document à 1 Mio.

La fonction bas niveau `connect({ hostOrigin })` exige désormais l'origine exacte fournie par le bootstrap hôte (pas `*`, pas une valeur reçue d'un message). Elle vérifie le parent, son origine et les versions avant d'accepter son port. Cette fonction seule ne suffit pas : `sdk/src/host.ts` contrôle la source et l'origine de la frame, `preload/runtime.ts` relaie uniquement les messages du shell lui-même, et `main/runtime/bridge.ts` vérifie le WebContents, la frame principale et son URL exacte avant de lier le port à un contexte autorisé par le natif. Aucun de ces composants n'autorise le renderer à enregistrer lui-même un package.

### Chargement et cycle de vie

Le catalogue livre un document hôte vide et un script de bootstrap réservé. Il ne sert plus les documents HTML bruts du package pour un contexte préparé. Après négociation réussie seulement, le SDK est publié en `ProjectTracker.ready`, l'URL du document est replacée à celle de l'entrée pour les ressources relatives, puis son HTML est inséré. La CSP par en-tête reste imposée : scripts externes locaux autorisés, scripts inline et code distant refusés. Les auteurs doivent donc référencer des fichiers JavaScript locaux, par exemple `<script type="module" src="main.js"></script>`.

L'hôte utilise `mountContribution` uniquement avec l'enregistrement natif. Appeler `dispose()` au retrait de l'emplacement ; un observateur couvre également le retrait DOM oublié. La révocation ferme le port, refuse les appels ultérieurs et retire les ressources du contexte. Le pont est détruit à la navigation principale ou à la destruction du shell. Les mutations SDK d'instances révoquent les contextes dont la liaison résolue a changé. Les changements de version ou de permissions doivent encore être raccordés par les futurs gestionnaires de cycle de vie.

**Intégrations futures :** configuration persistante des pages/slots (composition), cycle de vie des fournisseurs et transactions d'activation (installateur), routes normales et distribution des bundles. La qualification isolée du lot 3 ne constitue pas une activation externe ni une qualification de distribution : la garde reste fermée.

### API CORE et événements disponibles dans le harnais

`core.get/list` exigent le droit `read` sur la ressource demandée (`projects`, `notes`, `errors`). Ils retournent uniquement les vues documentées dans `shared/sdk.ts`, jamais chemins locaux, tâches, layouts, réglages, métadonnées raw/legacy ou snapshot global. Les listes CORE sont paginées par identifiant (200 éléments maximum). `core.update` exige `write` et `expectedRevision` ; un conflit n'écrase rien. Champs modifiables :

- projets : `name`, `status`, `type`, `category`, `tags`, `description` ;
- notes : `title`, `content`, `tags` ;
- erreurs : `title`, `content`, `causes`, `solution`.

Les champs inconnus sont refusés. `write` n'accorde pas implicitement `read`. `instances.list({ cursor?, limit? })` ne présente que les résumés du majeur associé et retourne `{ items, nextCursor }`, par ordre de position puis d'identifiant, avec 200 éléments maximum par page. Un composant indépendant reçoit `{ items: [], nextCursor: null }`. Les adresses de stockage dont l'identité d'instance est réutilisée par plusieurs majeurs legacy sont refusées pour éviter une fusion implicite de leurs documents.

Les abonnements disponibles sont `exports.changed`, `instances.changed`, `storage.changed`, `core.projects.changed`, `core.notes.changed`, `core.errors.changed` et `context.changed` pour la configuration persistante. Les topics CORE exigent `read`. Une demande contenant un topic interdit est entièrement refusée. Maximum : 32 abonnements par contexte, abonnement interne du SDK compris ; la révocation les nettoie tous. Un identifiant d'abonnement n'est utilisable que dans sa propre session.

Les événements CORE ne contiennent que les identifiants affectés (ou `{ invalidate: true }` pour une liste trop grande). Les événements de stockage ne contiennent que collection, identifiant, instance, état supprimé et révision du document : jamais sa valeur. Ils concernent le package du contexte et son instance résolue, ou le scope partagé du package. Même un majeur doit relire explicitement les autres instances qu'il gère. La révision d'événement suit l'horloge de commit SQLite commune au socle ; un échec n'incrémente rien et n'émet rien. L'hôte doit fournir au broker **le même CoreService** qu'au shell pour recevoir aussi les événements des écritures natives. Les documents privés n'entrent jamais dans le flux de données du shell ; seule sa révision confirmée avance.

### Gestion des instances dans le harnais

Seul le majeur peut créer, dupliquer, renommer, supprimer ou changer l'instance active de son propre module. Une page majeure sans instance peut créer la première. Les noms sont uniques sans distinction de casse au sein du majeur. La création exige un `operationId` stable pour une reprise idempotente durable ; sa réutilisation avec d'autres paramètres est refusée. Une duplication copie atomiquement les documents de l'instance source, avec contrôle des quotas et révisions initialisées à 1, sans copier les documents partagés du package. Un échec annule instance, documents et marqueur d'opération.

`rename(instanceId, name, expectedRevision)` et `delete(instanceId, expectedRevision)` exigent la révision lue. `setActive(instanceId, expectedActiveInstanceId)` exige l'identité active précédemment lue (ou `null`) et refuse les conflits. Créer une instance ne change pas l'instance active, sauf pour la première création. L'instance consultée et l'instance active globale restent distinctes : la sélection est disponible via l'adaptateur natif du harnais ; la sélection automatique après création reste à raccorder à l'interface.

La suppression exige un callback de confirmation **natif** fourni au broker : identité, nom, nombre de documents et usages projet/dashboard/sidebar sont présentés à l'hôte. Sans callback, elle échoue fermée ; un booléen envoyé par la contribution ne constitue jamais un consentement. Après l'attente, toute modification de la révision globale impose une nouvelle confirmation. La suppression retire uniquement les documents de cette instance et conserve les références d'emplacement ; une référence fixe devient indisponible. Si nécessaire, la première instance restante devient active.

`instances.changed` ne contient que `{ instanceId, action }` et la révision globale, filtrés par package et majeur associé. Après commit, les anciennes liaisons actives, supprimées ou renommées sont révoquées ; un placement fixe inchangé survit au changement actif. Le résultat d'une mutation est envoyé avant l'éventuelle révocation de son propre contexte. Le futur shell devra alors remonter une frame avec un nouveau contexte natif, jamais réutiliser l'ancien port.

### Configuration persistante des emplacements dans le harnais

Les contextes de blocs de projet et widgets de dashboard lisent leur configuration depuis SQLite, et non une copie fournie par le demandeur natif. L'identité complète (propriétaire, placement, package, contribution et liaison) est vérifiée à la création et lors des appels. Un emplacement supprimé ou réaffecté révoque son ancien contexte. Une version de configuration incompatible est refusée, en attendant son mécanisme de migration.

`context.configRevision` contient la révision de l'emplacement ; elle vaut `null` pour les contextes sans configuration persistante. `sdk.config.update(config, expectedRevision)` remplace la configuration, valide le schéma déclaré et refuse champs inconnus, types invalides, taille supérieure à 1 Mio ou révision périmée. Une interface custom peut conserver ses clés JSON supplémentaires, sans modification de prototype. La contribution ne fournit ni identité de cible ni version de schéma. Une valeur identique ne réécrit rien et n'émet aucun événement.

La transaction fait avancer la révision d'emplacement, celle de son projet/dashboard et l'horloge globale. Pour un bloc de projet, le cache natif reçoit la vue projet confirmée ; aucun document privé n'y entre. Après commit seulement, `context.changed` (payload vide) est émis vers les contextes du même emplacement et propriétaire, jamais un autre placement partageant l'instance métier. Le SDK relit alors `context.get`, actualise `sdk.context` et appelle `onContextChange`. Le résultat de l'écriture contient `{ config, revision }` ; un brouillon doit conserver sa révision de départ, sans reprise automatique d'un conflit.

Les pages majeures sans emplacement et les slots d'extension ne disposent pas encore de configuration persistante et refusent cette mutation. Le futur éditeur natif de composition devra employer le même parcours transactionnel/notification ; l'interface de configuration du shell normal n'est pas encore raccordée.

### Navigation interne contrôlée dans le harnais

`navigation.open` accepte seulement les formes fermées `{ kind: 'project', projectId }` et `{ kind: 'major', instanceId? }` pour la navigation interne. Aucun chemin, URL de route, identité de package cible ou canal IPC supplémentaire n'est accepté. Un projet doit exister et exige `core.projects.read`, sauf pour ouvrir le projet propriétaire du contexte. Sans droit, l'existence d'un autre projet n'est pas révélée. Un majeur est exclusivement celui associé à la contribution du même package ; un composant indépendant ne peut pas en inventer un. Sans `instanceId`, l'instance actuellement résolue du contexte est consultée ; une page majeure vide peut ouvrir son majeur sans instance.

`instances.select(instanceId)` est réservé au majeur. Il retourne le résumé d'une instance existante de ce même majeur et demande sa consultation avec une liaison fixe. Il ne change ni l'instance active globale, ni les autres placements, ni les révisions SQLite. Les identités d'instances historiques ambiguës sont refusées. Un widget peut utiliser `navigation.open` pour ouvrir son majeur, mais ne peut pas appeler la méthode de sélection réservée au majeur.

L'hôte doit fournir `prepareNavigation(source, target)` au broker. Il accepte synchroniquement un descripteur natif validé et retourne une fonction de commit sans effectuer de navigation pendant la préparation ; `null` refuse la demande. Aucun adaptateur signifie `UNAVAILABLE`. Le broker envoie d'abord l'accusé de réception, revalide source/cible puis exécute le commit, seulement si l'envoi a réussi. Le shell natif reste responsable de la route, de la révocation et du remontage avec une nouvelle identité. `{ opened: true }` signifie que la demande a été acceptée pour ce commit, pas une preuve de rendu final. La fixture Chromium démontre deux sélections successives avec réponse avant révocation et nouvelles frames ; les intentions projet sont enregistrées mais aucune page projet réelle n'y est rendue. Le raccordement aux routes normales reste futur.

La forme `{ kind: 'external', url }` reste fermée avec `UNAVAILABLE`, même pour HTTPS : aucune ouverture système n'a lieu avant l'implémentation d'une confirmation native et d'une validation des schémas web. Elle ne contourne pas le futur service HTTPS contrôlé.

### Exports inter-packages en lecture seule dans le harnais

`packages.readExport({ package, export, instanceId? })` exige le droit explicite correspondant **avant** toute recherche du fournisseur (sauf pour le propre package). Le manifeste du consommateur, conservé par le registre natif et inaccessible aux messages, doit déclarer une dépendance SemVer compatible. Le fournisseur doit être un package actif avec version active, manifeste intégralement validé et cohérent avec son identité/version, API hôte compatible et version de stockage migrée. Fournisseur désactivé, suspendu, désinstallé, absent ou incompatible : lecture refusée.

Le résultat expose seulement les collections déclarées de cet export, son numéro de version, l'instance et les documents documentés du SDK ; jamais les autres collections, configurations, layouts, chemins ou manifestes. Le scope `package` refuse un identifiant d'instance. Un export par instance utilise l'identité explicite ou l'active du fournisseur ; pour son propre package, il conserve les restrictions habituelles (majeur associé, autre instance réservée au majeur, mineur/widget limité à sa liaison). Une instance ambiguë ou absente est refusée. Aucun export n'accorde d'écriture ni d'accès au stockage privé du fournisseur.

Le contrat snapshot actuel n'a pas de curseur : plus de 200 documents ou plus de 1 Mio de valeurs JSON entraîne `UNAVAILABLE`, sans troncature silencieuse. Le budget est vérifié en SQL avant chargement des valeurs, puis la limite globale des messages reste appliquée. Une pagination/version ultérieure sera nécessaire pour des exports plus volumineux.

`exports.changed` requiert un droit d'export ou une déclaration d'export propre. Après commit des écritures SDK de collections publiées et des changements d'instances, il transmet seulement `{ package, export, instanceId, invalidate: true }` avec la révision globale ; ni contenu ni identifiant de document. Les droits, dépendances, état actif et déclarations du fournisseur sont recontrôlés pour chaque diffusion. Les autres collections/scopes/packages et les propres liaisons non autorisées ne produisent aucune notification ; désabonnement et révocation nettoient les listeners.

La fixture enregistre explicitement un fournisseur synthétique dans les tables d'installation et monte une quatrième frame consommatrice isolée. Cela ne constitue pas un installateur ni une activation normale. Le futur cycle de vie natif devra révoquer les contextes périmés et publier les invalidations lors des mises à jour/désactivations ; tout futur adaptateur écrivant les données privées devra employer le même flux après commit. Le broker actuel ne surveille pas les écritures SQL arbitraires.

### HTTPS contrôlé dans le harnais

`network.fetch` utilise le transport natif Node, pas la session Chromium ni ses cookies. Il accepte uniquement une origine HTTPS exacte déclarée/accordée, sans identifiants URL, IP littérale, hôte local, fragment ou schéma alternatif. Une origine accordée n'autorise ni ses sous-domaines ni un autre port. Corps GET/HEAD refusés ; corps UTF-8 de 1 Mio maximum. Seuls `accept`, `content-type`, `authorization` et `x-api-key` sont admis, sans doublon de casse ni caractères de contrôle, avec budget total de 16 Kio. Les secrets éventuels sont fournis explicitement par le package, jamais tirés d'un coffre ou de la session de l'utilisateur.

À chaque saut, résolution A et AAAA par un résolveur dédié annulable ; toutes les adresses retournées doivent être publiques. Politique conservatrice : IPv4 privées/locales/spéciales refusées ; IPv6 limitées au global unicast, hors plages spéciales, documentation et transition, avec refus des adresses mappées/NAT64/zones locales. Une réponse DNS mixte publique/privée est entièrement refusée. Une adresse validée est épinglée dans `lookup` du transport, sans seconde résolution ni connexion réutilisée ; nom d'hôte conservé pour SNI et vérification TLS, certificat exigé et TLS ≥ 1.2. Aucun agent partagé, proxy implicite, stockage de cookies, téléchargement sur disque ou upgrade de protocole.

Au plus cinq redirections, chacune revalidée (origine, schéma, DNS/IP). La résolution est renouvelée même sur la même origine pour refuser le rebinding. Les redirections inter-origines exigent aussi l'origine cible accordée, retirent `authorization`/`x-api-key` et refusent le rejeu d'une méthode avec corps ; 303 et 301/302 POST passent en GET sans corps selon la politique du service. Le délai global de 20 secondes couvre DNS, connexion, redirections et réponse ; révocation/fermeture du port annule via le signal du broker. Un résolveur défaillant ne peut pas ouvrir une socket après l'annulation.

Réponse bornée à 10 Mio pendant la lecture, même sans Content-Length ; compression refusée (`Accept-Encoding: identity`), corps décodé strictement en UTF-8, réponse tronquée refusée. Le résultat expose seulement `content-type`, `cache-control`, `etag`, `last-modified`, `retry-after`, jamais cookies/authentification serveur. La limite générale **2 Mio de message JSON** reste applicable : un corps accepté au transport peut donc être refusé au retour SDK (notamment après échappement JSON). Ni streaming ni binaire/base64 dans ce contrat. Les erreurs DNS/TLS sont masquées.

Les tests de politique et de transport utilisent des doubles natifs pour couvrir les attaques de manière reproductible ; un vrai serveur TCP temporaire prouve l'annulation d'une négociation TLS. `npm run test:runtime` reste sans dépendance Internet et vérifie les refus depuis une vraie frame. **Option de qualification réseau explicite :** `PT_RUNTIME_NETWORK_LIVE=1 npm run test:runtime` ajoute un GET public vers `https://example.com/` via frame → broker → DNS → TLS. Ce scénario a été exécuté avec succès ; il dépend de la connectivité extérieure et complète la matrice de confinement décrite ci-dessous, sans remplacer les essais de distribution macOS du lot 8.

Références de conception : [DNS Node](https://nodejs.org/docs/latest-v24.x/api/dns.html), [HTTPS Node](https://nodejs.org/api/https.html), registres IANA [IPv4](https://www.iana.org/assignments/iana-ipv4-special-registry) et [IPv6](https://www.iana.org/assignments/iana-ipv6-special-registry). Les exclusions restent volontairement plus restrictives que certaines exceptions publiques des registres ; leur révision fait partie de la qualification de distribution.

### Session Chromium qualifiée dans le harnais

La session du runtime est éphémère, dédiée, non réutilisable et distincte de
`defaultSession`. `configureRuntimeChromium(app)` doit être appelé **avant ready** :
résolution Chromium interdite (`MAP * ~NOTFOUND`, exception pour la seule IP
littérale 127.0.0.1 du proxy, pas pour `localhost`), préchargement DNS désactivé.
La résolution Node du service HTTPS reste indépendante. La fixture vérifie
`localhost` résoluble nativement mais refusé par Chromium.

`installRuntimeSession` exige cette préparation puis impose un proxy HTTP local
qui refuse toute requête/CONNECT, sans résolution ni forwarding, sans DIRECT ni
bypass (y compris loopback). **Attendre `guard.ready` avant attach.** Le shell doit
être servi par un handler natif `app://`, jamais un dev server HTTP dans cette
session. Permissions/device/capture refusées, téléchargements annulés,
popups/webviews refusés, ressources limitées au contexte vivant de la frame,
navigation initiale limitée au bootstrap provenant du shell. `close()` révoque les
contextes et ferme le WebContents sans beforeunload avant de libérer le proxy.

Le contournement TURN/TCP trouvé lors de la reprise précédente est couvert par
un test conservé et corrigé par cette combinaison native : proxy fixe + politique
`disable_non_proxied_udp` + refus de résolution Chromium, et non par suppression
JavaScript de WebRTC. Le test comporte des contrôles positifs UDP/TCP non confinés,
puis vérifie zéro trafic HTTP/UDP/TCP depuis la contribution (STUN, TURN et TURNS,
IP littérale et hostname), ainsi qu'après déconnexion du proxy. Ces tests sont
**toujours exécutés** par `npm run test:runtime` ; l'ancienne option
`PT_RUNTIME_CONFINEMENT=1` n'est plus nécessaire et n'allège aucune assertion.

La matrice couvre aussi assets locaux permis, `eval` exécuté par le script du
package (pas l'évaluation DevTools qui contourne la CSP), scripts inline/distants,
images, CSS/import/fonts, frames, formulaires/beacon, WebSocket, workers/SW,
fichier local, autre contexte, permissions média/clipboard, popup, téléchargement
blob et navigation HTTP/file/data. Les appareils média sont factices. Un contrôle
natif écrit un téléchargement dans un répertoire temporaire ; la contribution ne
produit aucun fichier dans son répertoire de téléchargement temporaire distinct.
Chromium peut remplacer une frame par `about:blank` sans événement annulable : le
commit révoque explicitement son ancienne identité/port/ressources. Une origine
héritée n'accorde donc aucun droit natif.

Ces preuves concernent Electron 41 et le système macOS de qualification, pas une
absence garantie de vulnérabilités Chromium, de limites CPU/mémoire strictes ou
une compatibilité Windows/Linux. L'activation normale, les bundles distribués et
le cycle installateur restent à raccorder/qualifier dans les lots suivants.
`EXTERNAL_RUNTIME_QUALIFIED=false` conserve cette interdiction d'activation.

Références : [proxy Electron](https://www.electronjs.org/docs/latest/api/session#sessetproxyconfig),
[politiques proxy Chromium](https://chromium.googlesource.com/chromium/src/net/+/HEAD/docs/proxy.md),
[confirmation native annulable](https://www.electronjs.org/docs/latest/api/dialog).

### Migration privée isolée

`runMigrationSandbox` exécute l'entrée HTML déclarée dans une fenêtre cachée,
une partition temporaire et une identité `kind: migration` propres. Aucun code du
package n'est évalué dans le main ou le shell. Le bootstrap/port est le même que
pour les contributions ; le pont n'est autorisé qu'après chargement du shell.

`snapshotPackage` copie uniquement les documents, instances/actives et
configurations d'emplacements du propriétaire demandé. Pas de projets/notes/
erreurs CORE, chemins, bindings ou layouts. Une transaction synchrone se termine
avant l'exécution tierce ; aucune transaction active n'attend du JavaScript.

API réservée au contexte migration via `sdk.call` :
- `migration.read({cursor?,limit?})` : `{fromVersion,toVersion,entries,nextCursor}`,
  pages bornées (200 entrées, budget JSON), lire les pages avant mutation ;
- `migration.write({entry})` : transforme la copie ; nouveaux documents possibles
  uniquement dans ses scopes connus, identités instances/emplacements conservées ;
- `migration.delete({entry})` : supprime uniquement un document de la copie ;
- `migration.complete({})` / `migration.fail({})` : termine après accusé de réponse.

Entrées JSON fermées `document`, `instance`, `config` définies dans
`shared/migration.ts` ; tailles/quotas vérifiés, rollback d'une mutation hors quota,
instances actives non ambiguës, configurations validées contre le manifeste cible.
Les API stockage actif/CORE/instances/navigation/réseau/exports sont refusées,
même si le manifeste normal les demande. Seuls `context.get` et l'abonnement
interne vide `context.changed` restent accessibles en plus de cette API.

Chaîne de versions complète exigée, délai natif ≤30 s, signal d'annulation,
destruction de la fenêtre et révocation en sortie, y compris boucle infinie.
Le résultat est une **copie validée, jamais un commit**. Le lot 4 devra suspendre les
contextes, vérifier la révision de la source puis appliquer copie/version/pointeur
actif dans sa transaction récupérable. Échec, annulation, timeout ou configuration
invalide ne changent ni les documents actifs ni la version active.

### Ouverture web confirmée

`externalNavigationHooks(window)` propose une confirmation native annulable,
annulation par défaut et URL canonique visible ; ouverture via `shell.openExternal`
seulement après accord, revalidation du contexte et réponse SDK. Sans adaptateur :
`UNAVAILABLE`. Seuls HTTP/HTTPS sans credentials ni caractères de contrôle sont
acceptés ; autres schémas refusés. Les tests n'ouvrent pas de navigateur personnel :
adaptateur natif simulé et vérification de l'ordre confirmation/réponse/ouverture.

### Mise en page du majeur et métadonnées (complément UX)

L'hôte du shell laisse les majeurs et leurs features grandir selon la hauteur
naturelle de leur document. Le bootstrap observe leur taille ; l'hôte accepte
seulement un entier de 1 à 100 000 pixels, depuis la fenêtre et l'origine exactes
du contexte enregistré. Le message ne transporte ni HTML, ni commande, ni droit.
Widgets et mineurs compacts gardent les dimensions de leur emplacement.

Pour bénéficier du scroll de page, éviter `height:100vh` et les conteneurs internes
à hauteur fixe dans une vue majeure. Des ascenseurs voulus explicitement par le
package ne sont pas supprimés arbitrairement par le shell. Le bootstrap expose
`--amber-viewport-top` et `--amber-viewport-height` (pixels, présentation seulement)
pour les éléments sticky et les dialogs dans la partie réellement visible de la
frame. Cela ne donne aucun accès au DOM du shell ou des autres packages.

Le manifeste dispose de `name`, `description` et du champ optionnel `logo` :
```json
{ "logo": "assets/logo.png" }
```
Le logo doit être une ressource PNG statique incluse dans l'archive, de 256 Kio
maximum et de dimensions comprises entre 1 et 1024 pixels par côté. Le chemin
relatif est validé comme les autres ressources ; URLs distantes, chemins absolus,
traversées, SVG et animations sont refusés. Le natif contrôle les signatures,
chunks/CRC et la décompression bornée, puis retire les métadonnées avant de
transmettre une image PNG au shell. Les images illisibles utilisent une initiale.
Les fichiers installés sont revérifiés avec leur inventaire avant affichage ;
aucun chemin natif ni nouveau droit SDK n'est exposé. Les icônes des contributions
restent des noms du catalogue fermé `HOST_ICONS`, distincts du logo du package.

L'accès inter-packages n'est pas réservé aux extensions : un package autonome
peut demander `permissions.exports` et une dépendance compatible sur le fournisseur.
Seules les collections explicitement exportées par celui-ci sont lisibles après
accord utilisateur. Les données privées non exportées et l'écriture dans un autre
namespace restent interdites. Aucun bouton global « accès à tous les packages »
n'est introduit par les changements d'interface.
