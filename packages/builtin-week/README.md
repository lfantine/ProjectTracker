# Semaine type — package livré 1.1.2

Package autonome livré avec amber et importable manuellement par le même
installateur que les packages externes. Ses trois contributions sont `planner`
(majeur), `project-slots` (mineur de projet) et `today` (widget).
Le logo utilisateur `assets/logo.png` est inclus dans le ZIP et déclaré par
`logo` dans le manifeste ; sa source intacte est `docs/logo/week-module-logo.png`.

## Construire

Depuis la racine :

```bash
node scripts/build-week-package.mjs
```

Produit `dist/packages/builtin.week-1.1.2.zip` et son inventaire SHA-256. Le build
Nextron construit aussi cette archive dans `app/runtime/` pour la livraison.
Les sorties sont ignorées par Git. Ce script spécifique au dépôt n'est pas le
futur CLI npm décrit dans `docs/packages/AUTHORING-TOOLKIT.md`.

## Interface et gestes

- Calendrier hebdomadaire local, lundi à dimanche : sélection discrètement
  teintée, couleur pleine uniquement sur le créneau sélectionné. Un clic dans
  le vide désélectionne ; les titres restent en haut des événements et suivent
  le défilement tant que leur créneau est visible. Espace/Entrée
  ou double-clic ouvre son **dialog**, sans démonter le calendrier derrière.
- Glisser dans le vide prépare une création ; le dialog permet de compléter
  objectif, description, projet, couleur, lieu, personnes et lien.
- Glisser un créneau conserve son identité et sa durée ; sa poignée inférieure
  ajuste la fin par quarts d'heure. Ces gestes sauvegardent à la fin, sans
  ouvrir de formulaire. Échec/conflit signalé sans écraser les nouvelles données.
  Chevauchements et passage à travers minuit refusés.
- Réveils : marqueurs sur le bord gauche des journées, déplaçables au pointeur, indépendants des événements. Un clic ou une
  activation clavier ouvre le dialog de réglage. Aucun couloir vide réservé
  devant les événements ; la flèche affiche son heure au survol/focus. Ils ne contribuent pas aux minutes planifiées.
- Gestion des semaines dans un dialog : création vide, duplication intégrale de
  la consultée, renommage, consultation distincte de l'activation et suppression
  avec confirmation native. Dernière instance protégée transactionnellement par
  `minInstances: 1`, pas seulement par un bouton désactivé.
- Détails hebdomadaires repliables et actions clavier conservés. Suppr demande
  confirmation ; Échap ferme le dialog. Copier/coller par boutons ou ⌘/Ctrl C/V
  reste interne au calendrier, sans presse-papiers système. Le collage prépare
  une copie avec nouvelle identité et confirmation, à une destination choisie
  ou au prochain espace libre.
- Widget : timeline du jour, repère d'heure, créneau courant mis en avant,
  barre d'avancement et temps restant ; états passé/à venir et réveil. Le fond
  par défaut est transparent, sans seconde carte ajoutée par le shell.
- Mineur : uniquement les créneaux liés au projet propriétaire.
- Le titre du majeur est intégré dans l'en-tête du shell, pas répété dans la
  frame. Les palettes clair/sombre et les tokens d'un thème actif sont respectés.

Le majeur suit la hauteur naturelle de son contenu et le scroll de la page
hôte, pas un calendrier vertical limité à un viewport. Les jours et titres
d’événements restent visibles au défilement ; les dialogs se placent dans la
zone visible du shell. L’aide `?` est ronde et affiche son infobulle après 900 ms.

Lectures rafraîchies par événements, minuteur local et reprise focus/visibilité ;
nettoyage au démontage. Les lectures ne créent aucun document. Les gestes et
les dialogs suspendent le remplacement de l'interface ; la position de défilement
et le focus sont conservés au rafraîchissement.

## Stockage, droits et mise à jour

Namespace inchangé `builtin.week`, stockage **v1**, collection `week`, document
`schedule`, portée de l'instance explicite. Les identifiants, révisions, champs
et métadonnées métier non édités sont conservés. Les sauvegardes utilisent le
SDK avec révision attendue/CAS ; pas de second état métier dans le shell.
Les données invalides sont signalées, jamais effacées ou normalisées en silence.

La version 1.1.2 ne demande **aucun droit supplémentaire** : uniquement lecture
CORE des projets. Aucun Node, SQL, fichier, terminal, IA ou pont `window.api` dans
le package. Les textes métier restent du texte, pas du HTML. Les liens HTTP(S)
passent par la navigation/confirmation natives ; les autres restent inertes.
L'absence d'`allow-forms` dans la sandbox est conservée : les actions de sauvegarde
utilisent le SDK, sans soumission HTML.

Au démarrage, amber peut remplacer les anciennes versions **1.0.0 ou 1.1.0 actives,
origine bundled, stockage v1, droits exactement identiques**, par l'archive
1.1.2 livrée et vérifiée, via le vrai installateur et la prévalidation sandbox.
Pas de migration des documents. Échec : version précédente conservée. Aucun
package désactivé/suspendu/désinstallé n'est réactivé ; une version provenant d'un
ZIP/dossier utilisateur n'est pas remplacée automatiquement. Pour cette dernière,
importer explicitement le nouveau ZIP dans le marketplace puis l'activer.
Ce mécanisme ponctuel n'est ni un auto-update distant ni un accord générique
pour de nouveaux droits. Le marketplace conserve ses consentements natifs.

## Intégration et extensions

- `/module?package=builtin.week&contribution=planner[&instance=…]` ouvre le majeur,
  instance active ou fixe. `/week` reste une façade statique de cette contribution.
- Les widgets des dashboards et mineurs des projets sont des emplacements
  SQLite, avec configuration et liaison active/fixe indépendantes. Une instance
  fixe absente reste indisponible, sans repli silencieux sur l'active.
- Les contextes sont révoqués/remontés après changement de nom, liaison ou droits.
- Export `week-slots` v1 : documents de la collection `week` de l'instance
  consultée (`schedule` avec `slots` et `wakeTimes`), identité/révision et
  métadonnées d'instance. Instantané SDK en lecture seule, aucun accès SQL.
- Jours lundi = 0 à dimanche = 6 ; horaires locaux `HH:mm`, pas timestamps UTC.
- Slot `summary` v1 : features isolées rendues par l'hôte, dont le package livré
  `builtin.week-report`. Thème livré `builtin.amber-theme`, activation explicite.

## Validation

```bash
npm test
npm run typecheck
npm run test:runtime
node scripts/e2e.mjs --build modules ux bundled-update
```

Ces commandes utilisent des bases/profils temporaires. Les parcours du vrai
shell contrôlent dialogs, sélection, déplacement/redimensionnement, réveils,
progression du widget, mise à jour depuis une ancienne archive gérée et
conservation exacte des documents/instances. Admission personnelle limitée à
la livraison qualifiée macOS arm64 / Electron 41.10.3 ; les tests ne lancent
jamais l'application sur les données personnelles. Limites de distribution :
`docs/packages/LOT8-PROGRESS.md`.
