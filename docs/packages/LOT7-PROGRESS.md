# Lot 7 — Marketplace et extensions

> Historique du premier incrément. Le lot est désormais terminé en qualification isolée : voir [LOT7-QUALIFICATION.md](LOT7-QUALIFICATION.md). Les mentions « en cours » et « reste à réaliser » ci-dessous décrivent uniquement cet ancien incrément.

## Premier incrément : marketplace raccordé (16 octobre 2026)

Le lot reste **en cours**. L'interface de gestion ne signifie pas que les moteurs d'extensions sont disponibles.

### Réalisé

- Vues disponibles/installés/extensions avec recherche sur identité, nom, description, auteur et contributions, normalisation des accents et filtres de contributions par union. Filtres distincts thème/fonctionnalités et cible exacte.
- Consultation du contenu complet, associations majeur/mineurs/widgets, version/API hôte, auteur non vérifié, droits, dépendances et problèmes de compatibilité ; compteurs distincts instances/widgets/mineurs utilisés.
- Snapshot natif des manifestes enregistrés, validés avant exposition, sans répertoire géré ni chemin source. Liste des versions conservées et états active/disabled/suspended/uninstalled.
- Import ZIP par sélecteur natif, dossier lié/délié, scan explicite et sélection opaque des archives. Import et activation restent séparés. Activation d'une version, désactivation et désinstallation logique raccordées aux confirmations natives existantes. Reprise et nettoyage déjà assurés par les services des lots précédents.
- Ouverture d'un majeur, ajout de raccourci et ajout d'un mineur/widget à une cible existante avec l'éditeur déclaratif. Sans projet, consultation et import restent possibles ; la création d'un projet est proposée pour un mineur.
- Catalogue CORE historique conservé dans une vue séparée, désormais consultable même sans projet.
- Pont natif réservé au document principal exact et renouvelé après navigation. Pas de méthode générique IPC ou de chemin fourni par le renderer. L'accord automatique de la qualification est limité au bootstrap initial livré ; les demandes du marketplace utilisent les dialogues natifs Annuler par défaut.
- Événements de registre : rafraîchissement de la composition et du cache public après migration ; remontage des frames révoquées et nouvelle tentative des emplacements précédemment indisponibles.

### Frontière de sécurité

Ces actions sont raccordées **dans le shell de qualification confiné uniquement**, qui exige les variables de test et des données réellement sous le répertoire temporaire système. Le profil personnel explique l'indisponibilité de la gestion native et conserve le catalogue CORE. Les deux gardes personnelles/runtime restent fausses.

Une archive d'extension peut être inspectée/importée sans activation. Les moteurs de thèmes et de fonctionnalités sont toujours refusés nativement : aucun contrôle supprimé pour afficher un faux succès.

### Reste à réaliser avant de cocher le lot 7

1. Moteur de thèmes de données validées : tokens/textes/clés exposés, fonds locaux autorisés, un thème par cible, indépendance clair/sombre/système et retour aux valeurs par défaut.
2. Moteur features : slots versionnés, tri stable, contexte isolé par extension et résolution de l'instance de la vue hôte ; invalidations/permissions/exports et configuration persistante appropriés.
3. Archives livrées `builtin.amber-theme` et `builtin.week-report`, ce dernier calculant les minutes par jour et projet, y compris sans projet et projet manquant, sans compter les réveils.
4. Adapter prévalidation, migrations, activation, audit et lancement pour ces deux catégories, sans contourner les garanties existantes.
5. Qualifier l'installation depuis des ZIP externes de chaque catégorie, conflits de thèmes, plusieurs features, cible absente/incompatible et réactivation explicite. Compléter la présentation des offres livrées avant import et les usages détaillés si nécessaire.

Le lot 8 reste distinct : migration personnelle, distribution/installateur réel et qualification complète finale.

### Validations de cet incrément

- `npm test` : 222 tests DOM, 324 services Electron-Node, 6 suites legacy réussies.
- `npm run typecheck` : zéro erreur sur les six périmètres.
- `node scripts/e2e.mjs --build` : build de production sans packaging et 10 scénarios Electron réussis ; empreinte des données personnelles inchangée. Le parcours marketplace vérifie aussi l'annulation de la désactivation dans le vrai hook de confirmation natif (dialogue simulé, Annuler par défaut), sans arrêter le package.
- `git diff --check` réussi. Pas de nouvelle qualification du confinement réseau ni de distribution installée.
