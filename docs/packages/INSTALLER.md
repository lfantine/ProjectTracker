# Installateur local — état de qualification

Les services `main/packages` sont **natifs uniquement**. Ils ne sont pas encore
raccordés au démarrage ou à une API renderer de l'application normale.
`EXTERNAL_RUNTIME_QUALIFIED` et `PERSONAL_SQLITE_MIGRATION_QUALIFIED` restent faux.
Le lot 4 est terminé en qualification isolée ; voir `QUALIFICATION.md` et
`PLANS/PLAN.md` (local) pour les preuves, limites et relais vers les lots suivants.

## Ordre de démarrage obligatoire

Avant de créer la moindre frame de package ou d'exposer les opérations :

1. Ouvrir la base et obtenir le verrou applicatif habituel, sur les chemins
   résolus par `main/helpers/paths.ts` (jamais une racine fournie par un package).
2. `LocalPackageInstaller.recover()` nettoie les préparations abandonnées et les
   versions non enregistrées appartenant à des imports interrompus.
3. `PackageActivation.recover()` clôt les activations interrompues, sans rejouer
   une copie privée. Cet appel est encore soumis à la garde de qualification.
4. `auditActivePackages(db, paths.packages, hooks)` vérifie les versions actives.
5. Seulement après réussite de ces étapes, le futur registre pourra recréer des
   contextes pour les packages dont l'état est encore `active`.

Si une étape lève une erreur, rester dans le shell natif de récupération ; ne
pas ignorer l'erreur et lancer quand même les packages. La qualification isolée
est une option native du constructeur d'activation, contrôlée par le mode test,
le chemin réel de la base sous le répertoire temporaire système et sa racine
`packages` sœur. Ce booléen ne doit jamais devenir un paramètre IPC/SDK.

## États et opérations

- **Catalogue disponible** : ZIP inspecté, non installé. Un dossier lié contient
  uniquement des ZIP de premier niveau ; aucun dépôt ne déclenche une opération.
- **Import** : instantané borné, accord natif, fichiers versionnés conservés,
  version `ready` et premier package `disabled`. Rien n'est exécuté ou activé.
- **Activation** : nouvel accord, intégrité, compatibilité et prévalidation,
  barrière de contextes, migration privée éventuelle, CAS et transaction unique.
  `runtimeActivationHooks` fournit les vrais adaptateurs des sandboxes, à partir
  des bundles hôte compilés et d'un registre natif ; pas de callbacks tiers.
- **Échec avant commit** : version/données anciennes intactes. Si les contextes
  avaient déjà été révoqués, demander une relance explicite ; ne pas restaurer
  silencieusement une ancienne copie de données.
- **Désinstallation logique** : package `uninstalled`, pointeur actif vidé,
  versions `retired`. Données, instances, configurations, placements et fichiers
  conservés. Le réimport identique ne réactive rien. Pas de downgrade de code à
  la réinstallation : le journal conserve la dernière version activée.
- **Audit** : fichiers absents/altérés/liens, métadonnées incohérentes, droits
  manquants, dépendances incompatibles ou moteurs d'extension indisponibles
  entraînent une suspension, propagée aux consommateurs actifs transitifs.
  Les pointeurs, versions et données sont conservés. Aucun rétablissement
  automatique quand les fichiers redeviennent disponibles.

Les opérations partagent une file par racine gérée dans le processus. Ce n'est
pas un remplacement du verrou contre un second processus. Le dossier `.staging`
de l'installateur est exclusif ; le catalogue doit préparer ses scans ailleurs.

Les hooks de révocation sont synchrones et obligatoires. Ceux de changement
sont après commit et ne contiennent pas les documents privés. Une erreur de
notification est diagnostiquée, elle ne transforme pas un commit réussi en
rollback. Le raccordement au rafraîchissement du shell reste à réaliser.

## Preuves et limites

`npm test` exécute des workers Electron en mode Node réellement tués par
`SIGKILL` après extraction, journal, déplacement, pendant/après transaction
et à l'attente de migration. Après réouverture : intégrité SQLite, absence de
journal commencé, un seul état actif cohérent et reprise idempotente. Ces
workers utilisent des hooks de qualification contrôlés, pas une migration
Chromium en cours : le parcours Chromium réel réussi/échoué est couvert
séparément par `npm run test:runtime`.

Il ne s'agit **pas** d'une preuve de résistance à la panne électrique ni d'une
qualification de distribution Windows/Linux. Le nettoyage physique des versions
retirées, le câblage natif utilisateur et le démarrage normal sécurisé restent
à finaliser. Les adaptateurs de sources partagent désormais le pipeline commun.

## Sources natives (import explicite)

`PackageSourceImports` adapte le dossier lié et un inventaire de ZIP livrés fourni
par le processus natif à `LocalPackageInstaller`. Aucun chemin d'inventaire ne doit
être accepté directement depuis un SDK/IPC. Lister les offres ou lier un dossier
ne déclenche aucun import ni activation.

Une sélection de catalogue est liée à son identité/version et son empreinte de
contenu, revérifiées sur le nouvel instantané avant tout accord, même pour une
version déjà connue. Une recompression à contenu identique reste acceptable.
Le dossier doit toujours être lié avant préparation, après préparation et après
accord ; seuls les noms ZIP de premier niveau et fichiers réguliers sont admis.
La copie préparée est la seule source utilisée pour le commit : modifier le ZIP
ensuite ne modifie pas les fichiers approuvés. L'origine du premier import est
conservée lors des mises à jour/réimports.

Les offres livrées excluent les tombstones `uninstalled`. Un réimport explicite
reste possible, mais un résultat `unchanged` ne restaure jamais l'état actif.
Les bundles n'ont aucun passe-droit de consentement, compatibilité ou permissions.
Cet adaptateur n'ajoute pas de scan automatique, d'IPC ni d'interface utilisateur ;
les vrais artefacts livrés seront construits dans le lot dédié aux packages.


## Coordinateur natif de démarrage et d'opérations

`PackageManager` construit et raccorde import, sources, activation, arrêt et audit.
Il exige une base déjà ouverte sous verrou applicatif et une racine gérée native.
Il ne possède/ferme pas cette base et ne prend pas lui-même le verrou : le futur
appelant de démarrage reste responsable de leur durée de vie.

- `start()` impose reprise import → reprise activation → audit → nettoyage des
  préparations de catalogue abandonnées → scan du dossier lié. Les appels
  simultanés partagent une seule promesse ; un démarrage réussi est idempotent.
- États `idle`, `starting`, `ready`, `recovery`. Les opérations demandées hors
  `ready` sont rejetées immédiatement, pas différées après le démarrage.
- Échec de reprise/audit : `recovery`, aucun lancement autorisé ; un nouvel appel
  natif explicite à `start()` permet de retenter. Une source absente reste une
  erreur de catalogue non fatale, sans désinstaller ni suspendre les actifs.
- File native distincte autour des opérations de services, sans imbrication de
  leur verrou par racine. Une opération annulée/échouée ne bloque pas la suivante.
- Scan au démarrage, à la liaison et au rafraîchissement manuel seulement ; aucun
  watcher ni import sur dépôt. Les instantanés sont copiés, les sélections gelées
  avant mise en file et les imports revalident toujours leur contenu.
- `packages()` expose les états et raisons d'indisponibilité sans documents
  privés. `canLaunch()` est un verrou d'admission natif (jamais une preuve de
  sécurité autonome) : le registre de contextes, ses barrières, les droits et le
  protocole restent obligatoires. CORE est exclu de cette admission externe.
- Les hooks `changed` d'activation/arrêt/audit relaient après commit les identités
  affectées et la révision. Le futur shell doit invalider ses vues puis remonter
  explicitement les contributions autorisées, pas réutiliser des exports périmés.

Ce coordinateur est employé dans le harnais Electron isolé avec les vrais hooks
Chromium de prévalidation/migration. Il n'est **pas** encore importé par `main.ts`,
ne crée aucune frame. Son adaptateur IPC optionnel est décrit ci-dessous. Avec la qualification normale fermée,
`start()` échoue volontairement à la reprise d'activation : ne pas contourner
cette garde pour afficher artificiellement un état `ready`.


## Pont de gestion réservé au shell

`installPackageShellBridge` enregistre les canaux fermés de
`shared/packageShell.ts` sur **un** WebContents et l'URL exacte de son document
principal. Même URL dans une autre fenêtre, sous-frame ou document remplacé :
refus. Le pont doit être disposé avant remplacement d'une fenêtre ; navigation
principale/destruction le dispose automatiquement, retire les handlers et annule
les opérations en attente via AbortSignal. La mutation d'un dossier liée mise en
file vérifie aussi ce signal avant écriture. Un commit déjà terminé n'est pas
annulé rétrospectivement.

Aucun argument de chemin n'est accepté depuis le renderer. Import ZIP et liaison
ouvrent les sélecteurs natifs parentés (`nativePackagePickers`) ; leurs réponses
restent natives, sont revalidées après attente et ne sont pas renvoyées au shell.
Le catalogue expose des jetons de sélection éphémères, liés au document et
renouvelés à chaque nouvel instantané. L'import revalide ensuite l'identité et
le contenu avec l'installateur commun. Les offres livrées sont expurgées de leurs
chemins internes ; listes d'états/versions et erreurs fermées ne contiennent ni
chemins natifs ni documents privés. Les payloads ont des champs stricts ; aucune
option de qualification ou commande générique n'est exposée.

`bridge.notify` relaie les invalidations après commit avec identités et révision,
uniquement vers le document encore autorisé. En récupération, seul l'instantané
vide et son état restent consultables ; les dialogues/opérations sont refusés.
Il n'existe pas d'IPC permettant de forcer une nouvelle qualification.

Le harnais Electron utilise un **preload de test dédié**, les vrais IPC et les
hooks runtime pour importer/activer/mettre à jour. Une autre fenêtre ayant la même
URL est réellement refusée. Les sélecteurs et accords sont contrôlés dans ce
harnais : aucune boîte de dialogue personnelle n'est ouverte. Le premier essai a
reproduit le refus correct d'une fenêtre non attachée dans la session runtime ;
le harnais utilise désormais sa propre session non persistante avec proxy fermé
et garde attachée, sans relâcher la politique de confinement.

**Limite :** ces handlers ne sont pas enregistrés dans `main.ts` et le preload
normal n'expose pas ces canaux. L'interface finale de gestion, les états visuels
indisponibles et le remontage des contributions restent à implémenter. Ne pas
brancher ce pont dans un runtime non qualifié pour contourner ses gardes.
