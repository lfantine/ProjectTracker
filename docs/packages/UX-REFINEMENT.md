# Refonte UX — shortcuts, dashboards et Semaine type

Demande utilisateur : 16 octobre 2026, après les lots 0–8. Le nom reste **amber**.
Ce travail est un incrément UX, pas un nouveau lot de la refonte modulaire.

## Implémenté

### Personnalisation par package

- Écran d'entrée composé des packages installés, dont **CORE**, toujours présent.
- CORE : apparence, accès aux préférences/sauvegardes, dashboards et restauration
  de la navigation intégrée. Plus de liste de boutons Monter/Descendre.
- Autres packages : accès aux majeurs/instances et configuration des widgets
  réellement placés ; états inactifs et absence d'options explicités.
- Pas d'API fictive de réglages globaux de package : seules les configurations
  de contribution déclarées existent. Les options des mineurs restent accessibles
  depuis leurs emplacements de projet ; thèmes/features dans le marketplace.

### Shortcuts

- Bouton pointillé **Add a shortcut** ; choix nom, icône, page CORE, dashboard
  ou majeur (instance fixe ou active). Les commandes natives valident les cibles.
- Glisser-déposer pour l'ordre ; corbeille contextuelle en bas de fenêtre pour
  retirer le shortcut, jamais ses données métier.
- Groupes nommés, repliables, **un seul niveau**. Déposer sur un titre pour ranger,
  hors groupe pour dégrouper. Groupes réordonnables ; suppression d'un groupe =
  ses shortcuts conservés hors groupe. Pas d'arborescence récursive.
- Les shortcuts hors groupe précèdent les groupes ; l'ordre des groupes est
  indépendant. Pas d'interclassement libre des groupes avec les liens racine.
- Métadonnées host-owned dans la préférence SQLite `sidebar-organization` :
  groupes, repli et appartenance. Révision/CAS, idempotence et transaction de
  composition conservés. Aucun changement de schéma ni réécriture des documents.
- Métadonnées incluses dans l'export JSON et les sauvegardes/restaurations SQLite.
  Personnalisation et Réglages restent accessibles si tous les shortcuts ont été
  retirés. Alt + flèches et Alt + Suppr restent des alternatives clavier.

### Dashboards

- Bouton Personnaliser à droite. Barre d'édition compacte et hiérarchisée :
  Ajouter un widget, Options du dashboard et aide `?`.
- Suppression des commandes visuelles Haut/Bas/Largeur+/Hauteur+/Retirer.
- Poignée de déplacement et quatre coins de redimensionnement, uniquement en
  édition. Retrait via corbeille contextuelle ; aucune suppression de l'instance.
- Persistance à la fin du geste, pas à chaque mouvement. Un drop en corbeille
  ne sauvegarde pas aussi une nouvelle disposition. Contrôles de breakpoint,
  collisions, droits et révision conservés. Alternatives clavier sur la poignée.
- Plus de fond, bordure, arrondi ou padding systématique autour des contenus.
  Les composants CORE gardent leurs propres cartes si pertinentes, comme tout
  package ; pas de deuxième carte imposée par l'hôte.

### Semaine type 1.1.0

- Grille hebdomadaire intégrée ; titre du majeur dans le shell, pas de second H1
  dans le contenu. Titre de thème fermé `week.title` transmis par le lancement
  natif, pas par un message libre du package.
- Clic = sélection teintée/pleine ; Espace/Entrée ou double-clic = vrai `<dialog>`.
  Calendrier conservé derrière, focus restauré, Échap/fermeture sans sauvegarde.
  Instances, réveils et suppressions utilisent également des dialogs.
- Création par sélection dans le vide, déplacement direct et poignée inférieure
  pour ajuster la fin ; validation des chevauchements et sauvegarde SDK/CAS.
  Réveils distincts à gauche des colonnes, déplaçables sans ouvrir de formulaire.
- Défilement et liste détaillée repliable conservés au rafraîchissement ; les
  lectures déclenchées par le focus ne volent plus le focus pendant la copie.
- Widget du jour : timeline, heure/réveil, repère Maintenant, événement courant
  mis en avant avec progression et minutes restantes. Fond transparent par
  défaut ; tokens d'un thème actif prioritaires en clair/sombre.
- Namespace, stockage v1, droits et documents inchangés. Une mise à jour locale
  ciblée de la 1.0.0 livrée active vers la 1.1.0 passe par le vrai installateur,
  les empreintes et la prévalidation sandbox ; aucun ajout de droits silencieux.
  Les versions importées par ZIP/dossier et les packages inactifs/désinstallés
  ne sont pas remplacés. Échec d'activation : ancienne version conservée et
  diagnostic technique. Aucun auto-update distant introduit.

## Vérifications et limites

- `npm test` : **233 DOM + 354 services = 587 tests**, **6/6 suites legacy**.
- `npm run typecheck` : zéro erreur sur les six périmètres.
- `npm run test:runtime` : vraie sandbox Chromium, ZIP compilé, SDK/CAS,
  navigation, droits, réseau/WebRTC et migrations privées.
- `npm run build:local` : build de production puis app macOS arm64 avec ASAR,
  sans signature, **sans reconstruire de DMG/ZIP de distribution**.
- App locale : **17/17 scénarios Electron**. Nouveau parcours UX : création de
  groupe, rangement réel au pointeur, repli, création/retrait, retrait d'un
  widget à la corbeille, dialogs, sélection/Espace, déplacement et resize de
  créneau, réveil, progression du widget et persistance après redémarrage.
- Ancienne archive 1.0.0 réellement importée/gérée en fixture, puis démarrage
  avec le nouvel artefact livré : activation 1.1.0 et comparaison exacte des
  lignes métier/instances avant-après, révisions comprises. La vieille UI
  minimale est amorcée hors ligne avec des hooks de test ; **la nouvelle UI
  passe bien par la validation runtime réelle du shell**.
- Sauvegarde/restauration avec groupe et appartenance vérifiées après le vrai
  redémarrage natif. Premier lancement normal de l'app compilée sans variables
  de qualification dans un HOME jetable : migration, runtime, sauvegarde,
  redémarrage, préférences, safe mode et récupération vérifiés.
- Captures Electron réelles inspectées : personnalisation, dashboard normal et
  édition, calendrier clair/sombre et dialog. Captures de qualification dans
  `/tmp/amber-ux-*.png`, pas des captures de données personnelles.

Toutes les données/profils d'essai sont temporaires ; empreintes personnelles
inchangées. Aucun lancement utilisateur automatique, commit ou reset. Pas de
nouvelle qualification autre OS/architecture/Electron, signature/notarisation,
Gatekeeper téléchargé, veille matérielle, panne électrique ou HTTPS live.
Les limites du lot 8 restent applicables. Logs de cette passe :
`/tmp/amber-ux-{tests,types,runtime,local-build,packaged-e2e,release}-final.log`.

## Complément — ajustements suivants (16/10/2026)

Ce complément remplace les détails d'interface/version concernés ci-dessus :

- Majeurs/features à hauteur naturelle et scroll de page, mesure par le
  bootstrap isolé et canal de présentation contrôlé (source/origine exacte,
  hauteur entière bornée). Les widgets/mineurs compacts conservent leur grille.
  Aucune permission ajoutée ; voir `FORMAT.md` pour les variables du viewport.
- Aides `?` rondes de 22 px et délai de 900 ms. Renommage du groupe directement
  par clic sur son texte ; chevron réservé au repli et Échap sans sauvegarde.
- Sélecteur de shortcuts compact/centré, aperçu et grille des 18 icônes du
  catalogue fermé ; mêmes vrais pictogrammes affichés dans la sidebar.
- Semaine type **1.1.1** : titres en haut/sticky, jours sticky, clic vide pour
  désélectionner, pas de couloir réservé aux réveils. Marqueurs flèche superposés
  avec heure au survol/focus ; déplacement par delta pour éviter les arrondis de
  sous-pixels. Dialog visible dans le viewport parent, même après scroll.
- Mise à jour locale étroite depuis les anciennes bundled 1.0.0 **et** 1.1.0
  actives, sans nouveaux droits, stockage/métier inchangés. Versions manuelles,
  inactives et désinstallées toujours exclues.
- Métadonnées : nom/description existants ; logo standard du manifeste encore
  absent (un package peut déjà afficher ses propres images dans sa frame).
  Exports inter-packages existants pour packages ordinaires aussi : lecture
  seule, dépendance compatible et permission accordée, jamais accès privé global.

Vérifié : **241 DOM + 354 services = 595 tests**, 6/6 legacy, six périmètres
TypeScript, runtime réel et **19/19 E2E de production**. Nouveaux contrôles de
messages de taille forgés/étrangers/hors limites, taille qui peut diminuer,
nettoyage des observateurs, viewport/sticky/absence de scroll interne du planning,
dialog ouvert après scroll, aide à 900 ms et édition visuelle. Les deux anciennes
versions ont été réellement installées avant mise à jour et leurs documents et
instances comparés exactement. Captures réelles dans `/tmp/amber-ux2-*.png`.
Aucun test sur les données personnelles ; limites de plateforme du lot 8 conservées.

## Logo utilisateur de Semaine type — 1.1.2

Le logo fourni (`docs/logo/week-module-logo.png`) est maintenant inclus sans
retouche dans l'archive livrée et affiché dans la personnalisation, le marketplace
et son détail. Le champ optionnel `logo` du manifeste est pris en charge pour tous
les packages/extensions, selon les contraintes PNG locales de `FORMAT.md`.
Les icônes de raccourcis restent personnalisables indépendamment du logo.
L'absence de support décrite dans l'incrément historique ci-dessus est donc levée.

Mise à jour locale depuis les seules bundled 1.0.0, 1.1.0 et 1.1.1 actives ;
données et droits inchangés. Tests : **608 tests + 6/6 legacy**, typecheck, runtime
réel et **20/20 E2E sur la build locale**, décodage PNG réel vérifié dans les deux
écrans et capture inspectée. Les données personnelles n'ont pas été modifiées.
