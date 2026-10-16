<p align="center"><img src="docs/logo/Amber-logo.png" width="120" alt="Logo amber"></p>

<h1 align="center">amber</h1>

<p align="center">
  Une app de bureau (Electron + Next.js) pour suivre tes projets perso : tâches, deadlines, notes, erreurs, checklists d'achat… le tout dans une seule fenêtre.
</p>

> [!WARNING]
> **Projet en développement actif.** Les fonctionnalités, le format des données et l'interface peuvent changer sans préavis. À utiliser en connaissance de cause.

## Aperçu

| Accueil | Projets | Réglages |
| --- | --- | --- |
| ![Accueil](resources/screenshots/home.png) | ![Projets](resources/screenshots/projects.png) | ![Réglages](resources/screenshots/settings.png) |

*(Captures avec des données d'exemple.)*

## Ce qu'il faut savoir

### 🔒 Toutes les données restent en local

Les données métier sont locales. Le nouveau socle utilise SQLite (`~/.data/ProjectTracker/tracker.sqlite`) et conserve les JSON historiques pour récupération. La migration au premier lancement est admise uniquement dans l’app empaquetée qualifiée (macOS arm64, Electron 41.10.3) ; le développement reste bloqué sur les données personnelles. Les fonctions IA dépendent du programme externe choisi ; un package ne peut joindre que les domaines HTTPS explicitement accordés.

### 🤖 L'IA passe par un programme externe, au choix

Les fonctionnalités assistées par IA (création guidée de projets/notes/erreurs, réécriture de notes…) n'appellent aucune API directement depuis l'app. Elles délèguent l'appel à un **programme en ligne de commande configurable**, invoqué avec `--request "<texte>"` (et parfois `--format "<texte>"`), dont la réponse est lue sur la sortie standard.

Tu choisis ce programme dans **Réglages → Intelligence artificielle** : un champ texte (nom d'un binaire dans le `PATH`, ou chemin complet) plus un bouton pour le sélectionner directement via un sélecteur de fichier. Par défaut, l'app s'attend à trouver un outil nommé `groqtool`, mais n'importe quel exécutable respectant ce contrat d'appel peut être utilisé à la place.

### 🚧 En développement

Ce projet est un outil personnel en construction. Attends-toi à des changements de structure, des bugs, et des fonctionnalités incomplètes.

## Navigation, IA et récupération

- Les projets ouverts restent accessibles dans la barre d’onglets. Épingle un onglet avec le losange pour empêcher sa fermeture ; désépingle-le pour le fermer. Les onglets et l’épinglage sont restaurés au redémarrage.
- `⌘1` à `⌘9` sur Mac, ou `Ctrl+1` à `Ctrl+9`, ouvre l’onglet correspondant. La position de défilement, le mode de tâches et les filtres sont conservés entre les projets pendant la session.
- **Créer ou modifier avec l’IA** présélectionne le projet ou la note ouverte. Après génération, utilise **Ajuster cette proposition** pour modifier le brouillon sans repartir de zéro. Tu peux annuler le dernier ajustement et comparer avec la version précédente avant de valider.
- Une note supprimée rejoint **Notes → Corbeille**. **Annuler** permet de la récupérer immédiatement ; **Restaurer** récupère ensuite son contenu et ses liens aux projets encore présents.

Pour vérifier les changements : `npm test` exécute les tests de régression, et `npm run typecheck` vérifie le code source TypeScript.

## Stack

- [Electron](https://www.electronjs.org/) + [Nextron](https://github.com/saltyshiomix/nextron) — coquille bureau
- [Next.js](https://nextjs.org/) + React — interface (dossier `renderer/`)
- TypeScript de bout en bout (processus principal `main/` et interface `renderer/`)
- SQLite local dans le processus principal ; pas de backend distant. JSON historiques conservés pour récupération.

## Installation

```bash
# installer les dépendances
pnpm install

# lancer en mode développement
pnpm dev

# build de production
pnpm build
```

## Configuration de l'IA

1. Ouvre **Réglages** dans l'app.
2. Dans la section **Intelligence artificielle**, renseigne le nom ou le chemin du programme à exécuter (par défaut `groqtool`), ou clique sur **Choisir un programme** pour le sélectionner via l'explorateur de fichiers.
3. Ce programme doit accepter `--request <texte>` (et optionnellement `--format <texte>`) et écrire sa réponse sur `stdout`.

## Structure du projet

```
main/                 Processus principal Electron (IPC, SQLite, installateur et runtime des packages, IA)
renderer/             Interface Next.js (pages, composants, state)
shared/               Contrats communs : manifeste, SDK, icônes, limites, schéma JSON publié
sdk/                  SDK des packages (côté frame) et hôte des frames (côté shell)
packages/             Sources des packages : Semaine type, extensions livrées, LinkedIn Post Planner
scripts/              Builds (app, ZIP de packages), tests, qualification
docs/                 Format des packages, guide de création, stockage, logos
resources/            Icônes, assets de design, captures d'écran
PLANS/                Notes personnelles (plan de refonte, journal) — locales, ignorées par Git
```

## Tests

- `npm test` : tests Vitest / React Testing Library puis les six scripts de régression historiques.
- `npm run test:unit` : premiers tests de logique, de données et d’interface.
- `npm run test:watch` : relance Vitest pendant le développement.
- `npm run typecheck` : vérification TypeScript.

Les tests React Testing Library vérifient les interactions et le DOM dans jsdom ; ils ne valident pas le rendu pixel par pixel. Les parcours Electron utilisent de vrais processus et des profils/données temporaires ; `npm run test:packaged` les rejoue sur une copie de l’app provenant du DMG.

Le bouton « Lancer les tests » dans les Réglages exécute quatre vérifications de logique embarquées, sans modifier les données. Il n’exécute pas la suite de développement Vitest. Les tests réels du programme IA et les diagnostics de fichiers seront ajoutés séparément.

## Personnalisation et shortcuts

- **Personnalisation** présente les packages installés. **CORE** rassemble l'apparence
  et les préférences de l'application ; les autres cartes donnent accès aux
  instances, vues et configurations réellement déclarées par chaque package.
- Les liens de sidebar sont des **shortcuts**. Glisser-déposer pour les ranger ;
  déposer dans la corbeille qui apparaît en bas pour les retirer, sans effacer
  de données. **Add a shortcut** permet d'ajouter un lien ou un groupe nommé.
- Groupes repliables sur un seul niveau : déposer un shortcut sur leur titre
  pour le ranger, ou dans la zone hors groupe pour l'en sortir. Les groupes se
  déplacent aussi ; supprimer un groupe conserve ses shortcuts hors groupe.
  Cliquer sur le nom pour renommer, sur le chevron pour replier. Le sélecteur
  de shortcuts présente les icônes visuellement avec un aperçu : les 18
  icônes courantes d'abord, puis **Voir plus** pour les 54 (étoile, idée,
  objectif, équipe, LinkedIn, sport, café…). Le même catalogue fermé sert aux
  icônes déclarées par les packages.
- Dashboard : **Personnaliser le dashboard** à droite active les poignées de
  déplacement et de redimensionnement aux quatre coins. La corbeille retire un
  widget, pas ses données. **Ajouter un widget** et **Dashboard** donnent accès
  aux autres opérations ; l'aide `?` décrit aussi les raccourcis clavier.
  Hors édition, la disposition n'est pas modifiable. Le shell n'ajoute aucune
  carte/bordure autour des contenus : chaque contribution choisit son rendu.

## Semaine type

Calendrier à hauteur naturelle utilisant le scroll de page, avec titres
d’événements en haut et persistants au défilement. Un clic dans le vide
désélectionne. Planning récurrent lundi–dimanche, avec plusieurs semaines nommées. Un clic
sélectionne un créneau ; Espace/Entrée ou double-clic ouvre son dialog. Glisser
dans le vide prépare une création ; glisser un événement le déplace et sa
poignée inférieure ajuste la durée. Réveils indépendants, sur le bord gauche de
chaque journée, également déplaçables. Chevauchements et passage minuit refusés.

Les dialogs permettent d'éditer objectif, description, projet, couleur, lieu,
personnes et lien. La suppression est confirmée. ⌘/Ctrl C/V prépare une copie
interne, avec nouvelle identité et confirmation. **Gérer les semaines** distingue
la semaine consultée de l'active ; les widgets peuvent suivre l'active ou une
instance fixe. Le widget du jour souligne le créneau courant avec progression,
temps restant et repère d'heure, sans carte englobante imposée.

Le package livré passe en **1.1.2**, sans changement de stockage ni de droits.
Les anciennes 1.0.0/1.1.0 actives livrées avec amber sont mises à jour via l'installateur et la
sandbox ; les versions importées manuellement et les désactivations ne sont
pas remplacées. Détails : [package Semaine type](packages/builtin-week/README.md).

## Marketplace

Deux onglets : **Modules à installer** (packages) et **Modules intégrés** (modules
de projet fournis avec amber).

- Une carte par module : logo, description, contenu en pictos (Page, Widget,
  Bloc projet, Thème, Complément), **un statut** (Actif, À activer, Mise à jour,
  Désactivé, Disponible, Désinstallé) et **un bouton** pour l'étape suivante
  (Installer, Activer, Mettre à jour, Réactiver, Ouvrir). Sections « Installés »
  et « Disponibles », recherche et filtre Tout / Modules / Thèmes et compléments.
- **Importer un ZIP** et **Installer** enchaînent import puis activation, chacun
  confirmé par une boîte de dialogue native ; un refus laisse le module « À
  activer ». La fiche du module s'ouvre ensuite : **Ouvrir**, **Ajouter au menu**,
  **Ajouter à un dashboard / à un projet**, accès demandés, usages, infos
  techniques repliées, Désactiver / Désinstaller (les données sont conservées).
- **Lier un dossier** affiche les ZIP qu'il contient dans « Disponibles ».
- Les problèmes sont écrits en clair (« Nécessite builtin.week », « Version
  d'amber incompatible »…) et bloquent le bouton concerné.

## Modules majeurs

Une page de module majeur occupe au minimum toute la hauteur visible (moins les
compléments affichés dessous) : ses dialogs et popups ne sont plus rognés quand
le contenu est court. Au-delà, elle suit sa hauteur naturelle et le scroll de
la page. Widgets et blocs de projet gardent la taille de leur emplacement.

## LinkedIn Post Planner

Package externe (non livré avec amber) pour préparer ses posts LinkedIn : idées
avec `#tags`, type Découverte / Expertise / Vente / Autre, date et heure, contenu
avec compteur et aperçu de l'accroche, image, onglets Idées / Planning /
Historique, posts « à confirmer » une fois l'heure passée, répartition des types
et liens **Ouvrir mon LinkedIn** / **Écrire sur LinkedIn**. Plusieurs profils
possibles, aucune permission demandée.

```bash
npm run build:local                            # d'abord : ce build vide dist/
node scripts/build-linkedin-planner-package.mjs
npm run start:local                            # Marketplace → Importer un ZIP
```

L'archive est `dist/packages/lfantine.linkedin-post-planner-1.0.0.zip`. Détails et
limites : [README du package](packages/linkedin-post-planner/README.md).

## Distribution et récupération

- `npm run build:mac` : DMG + ZIP pour l’architecture macOS courante.
- `npm run test:packaged` : copie depuis le DMG, démontage, premier lancement normal dans un HOME jetable puis les scénarios isolés sur l’app empaquetée.
- Usage personnel, sans DMG ni signature : `npm run build:local`, puis `npm run start:local` (ou `npm run build:local:open`). Produit `dist/mac-arm64/amber.app`.
- Réglages : sauvegarde vérifiée, restauration avec conservation de l’état précédent, démarrage sans tiers et export du diagnostic technique.

Le lot 8 est terminé pour la **distribution locale macOS arm64 non signée**. Au premier lancement de cette distribution qualifiée, les JSON historiques sont conservés et archivés avant migration SQLite. Les autres plateformes, architectures et versions Electron restent bloquées sur le répertoire personnel. État et limites : [lot 8](docs/packages/LOT8-PROGRESS.md), [récupération](docs/storage/RECOVERY.md). Aucun engagement Windows/Linux ou Gatekeeper/notarisation à ce stade.

### Identité visuelle

Logo source : `docs/logo/Amber-logo.png`. Le package Semaine type utilise son propre logo utilisateur (`docs/logo/week-module-logo.png`), inclus dans son archive et affiché dans la personnalisation et le marketplace. Les packages peuvent déclarer un `logo` PNG local optionnel (voir `docs/packages/FORMAT.md`). `npm run brand:assets` génère les variantes transparentes de l’interface, favicon et icônes PNG/ICO (ICNS sur macOS avec `iconutil`), sans modifier le dessin original. Les styles par défaut utilisent une palette ambre claire/sombre ; les thèmes de packages restent prioritaires.

## Créer un module / package

Voir le [guide de création de modules](docs/packages/CREER-UN-MODULE.md) : exemple complet, manifeste, SDK, stockage, instances, compilation/ZIP, import, permissions et checklist pour les prochaines sessions. Le futur outillage npm est décrit séparément dans [AUTHORING-TOOLKIT.md](docs/packages/AUTHORING-TOOLKIT.md).
