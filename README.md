<p align="center"><img src="resources/design/logo-MyProjectTracker.png" width="120" alt="Project Tracker logo"></p>

<h1 align="center">Project Tracker</h1>

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

Aucune donnée n'est envoyée sur un serveur. Projets, notes, erreurs, checklists : tout est stocké dans un simple fichier JSON sur ta machine (`~/.data/ProjectTracker/data.json`), visible et modifiable directement depuis les Réglages de l'app (bouton "Ouvrir dans le Finder").

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
- Aucune base de données, aucun backend : un fichier JSON local (`main/helpers/data-store.ts`)

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
main/                 Processus principal Electron (IPC, stockage local, appel du programme IA)
renderer/             Interface Next.js (pages, composants, state)
resources/            Icônes, assets de design, captures d'écran
```

## Tests

- `npm test` : tests Vitest / React Testing Library puis les six scripts de régression historiques.
- `npm run test:unit` : premiers tests de logique, de données et d’interface.
- `npm run test:watch` : relance Vitest pendant le développement.
- `npm run typecheck` : vérification TypeScript.

Les tests React Testing Library vérifient les interactions et le DOM dans jsdom ; ils ne valident pas le rendu pixel par pixel. Playwright est installé pour les futurs tests de parcours Electron et de captures visuelles ; aucune suite Playwright n’est encore définie.

Le bouton « Lancer les tests » dans les Réglages exécute quatre vérifications de logique embarquées, sans modifier les données. Il n’exécute pas la suite de développement Vitest. Les tests réels du programme IA et les diagnostics de fichiers seront ajoutés séparément.

## Semaine type

La page « Semaine type » contient un planning global récurrent du lundi au dimanche, sans dates. Cliquer-glisser dans une journée pour dessiner un créneau (pas de 15 minutes, glissement déclenché après 5 pixels de déplacement vertical ; un simple clic désélectionne), puis nommer l’objectif dans la fenêtre qui s’ouvre. Un clic sélectionne le bloc ; Espace ou un double-clic ouvre son édition, Suppr ou Retour arrière le supprime, Échap désélectionne ou ferme la fenêtre. Les créneaux sont enregistrés avec les données locales de l’application. Les chevauchements et les créneaux passant minuit sont refusés ; scinder ces derniers sur deux journées.

La CLI affiche chaque test Vitest, les suites de régression et un bilan coloré avec leur durée. Utiliser `NO_COLOR=1 npm test` pour désactiver les couleurs. Les options Vitest sont transmises, par exemple `npm run test:unit -- -t "onglet"`.

Chaque créneau peut contenir une description, un projet lié, un lieu/adresse, des personnes (une par ligne) et un lien. Ces champs sont optionnels et vides par défaut, et sont conservés avec les données locales.

La couleur de chaque créneau se choisit dans son édition, via un sélecteur ou un code hexadécimal (#RGB / #RRGGBB). Le gris clair par défaut est #d1d5db.

Dans l’agenda, ⌘C / ⌘V (Ctrl C / Ctrl V sur Windows) copie et duplique le créneau sélectionné avec ses détails. Cliquer dans une journée avant de coller permet de choisir l’emplacement ; sans destination, le prochain emplacement libre est utilisé. Cette copie reste interne à l’agenda. Glisser-déposer un créneau met à jour son jour et ses horaires, conserve sa durée et affiche un aperçu. Un chevauchement est refusé sans modifier le créneau d’origine.

Le dashboard affiche une colonne « Planning du jour » lorsqu’au moins un objectif de la semaine type est prévu aujourd’hui. Les créneaux sont triés par heure et indiquent « Passé », « En cours » ou « À venir ». Le planning suit l’heure locale, se met à jour automatiquement et permet d’ouvrir l’agenda ou le projet lié.

Une flèche sur le bord gauche de chaque journée indique l’heure de réveil (07:00 par défaut). Glisser verticalement ajuste ce repère par pas de 15 minutes ; les flèches du clavier permettent aussi de l’ajuster. Chaque jour conserve sa propre heure, sauvegardée avec le planning, sans créer ni déplacer d’objectif.

Le menu « Semaine active » permet de conserver plusieurs semaines types nommées. « Nouvelle semaine » crée un planning vide ; « Dupliquer » copie les créneaux, leurs détails et les heures de réveil ; « Renommer » change le nom du preset actif. Les modifications sont sauvegardées automatiquement dans ce preset. La semaine déjà enregistrée est migrée en « Ma semaine », et le dashboard utilise toujours la semaine active.
