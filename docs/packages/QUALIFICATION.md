# Lot 4 — Revue de sortie (16 octobre 2026)

## Périmètre

Installateur et cycle de vie **qualifiés dans des profils temporaires**, avec un
point d'entrée natif minimal via vrais IPC Electron. Ce bilan ne qualifie pas une
livraison publique ni l'activation sur les données personnelles. Les gardes
`EXTERNAL_RUNTIME_QUALIFIED` et `PERSONAL_SQLITE_MIGRATION_QUALIFIED` restent fausses.
Le shell normal ne charge pas encore ces services ; aucun package utilisateur
n'est exécuté au démarrage normal.

## Critères du plan et preuves

| Critère | Implémentation / preuve |
| --- | --- |
| ZIP borné, manifeste, fichiers référencés, chemins et liens refusés | `archive.ts`, `archive.test.ts` : quotas centralisés, extraction réelle bornée, collisions et entrées ambiguës refusées, nettoyage. |
| Empreinte canonique indépendante du ZIP | Tests d'archives recompressées ; conflit explicite d'identité/version avec contenu différent dans `installer.test.ts`. |
| Sources manuelle, livrée et dossier lié dans le même pipeline | `sourceImports.ts`, `source-imports.test.ts` ; inventaire natif synthétique livré, origine conservée. Les vrais bundles métier appartiennent au lot 5/7. |
| Un dossier, premier niveau, démarrage/actualisation manuelle, sans auto-installation | `sources.ts`, `catalogue.ts`, `manager.ts` et leurs tests ; dossiers manquants non destructifs, liens et récursion exclus. |
| Disponible n'est pas installé/actif ; dépendances sans téléchargement | `eligibility.ts`, tests de graphe/cycles/hôte/extensions ; éligibilité recalculée sur les manifestes actifs, même pour un catalogue en cache. |
| Consentement natif et droits complets | `consent.ts`, `import-consent.test.ts` : annulation par défaut, éditeur non vérifié, droits ajoutés/complets, empreintes. Import et activation ont chacun leur accord ; aucune permission partielle inventée. |
| Versions gérées indépendantes du ZIP et sans rebuild à l'import | `installer.test.ts` et `runtime-harness.cjs` : ZIP créés après démarrage du code hôte, supprimés avant activation, ressources exécutées depuis la version gérée. Aucune compilation du package à l'import. |
| Réimport identique sans mutation ; intégrité complète | Vérificateur commun `managedVersion.ts` pour réimport/audit/activation : empreintes, manifeste, inventaire complet, bornes, liens et parents contrôlés. Fichiers ajoutés et métadonnées altérées refusés. |
| Prévalidation sans effets sur les données actives | Vrais scénarios Electron : chargement/SDK, erreur script, entrée absente, boucle infinie, annulation ; contextes jetables et API métier refusées. |
| Mise à jour transactionnelle, échec gardant version/données anciennes | `activation.ts`, `applyMigration.ts`, tests CAS/droits/migrations/quotas/identités ; parcours IPC + Chromium réussi/échoué, ancienne version active intacte à l'échec. |
| Révocation et arrêt conservateur | `lifecycle.ts`, tests avec vrai registre : dépendants annoncés/suspendus, données/configurations/instances/placements/fichiers conservés ; tombstone livré jamais réinstallé automatiquement. |
| Reprise après interruption | Huit workers réellement SIGKILL, puis réouverture SQLite, reprise/audit, intégrité et FK, pointeur/version/stockage/documents cohérents ; seconde reprise idempotente. Ce n'est pas une preuve de panne électrique. |
| Démarrage sans tiers en cas d'erreur | `PackageManager` impose reprise → audit → catalogue ; erreur fatale = récupération, aucune admission de package. Audit suspend les versions invalides et consommateurs sans effacer leurs usages. |
| Point d'entrée natif minimal de test | `shellBridge.ts` et preload de qualification : vrais IPC, identité WebContents + frame + URL exacte. Autre fenêtre de même URL refusée ; chemins natifs non fournis au renderer, sélection opaque, navigation/fermeture annulent les attentes. |
| Aucun CORE externe / moteur absent / downgrade activé | Identité CORE réservée ; dépendances natives résolues par l'hôte. Extensions refusées à l'activation jusqu'au lot 7 ; rétrogradation bloquée, même après désinstallation. |

## Corrections issues de la revue

1. Le réimport idempotent contrôlait seulement les fichiers présents dans le ZIP
   proposé, et pouvait ignorer un fichier ajouté ou un parent remplacé par un
   lien. Il utilise maintenant le même vérificateur borné complet que l'audit et
   l'activation ; aucune réparation silencieuse des fichiers n'est effectuée.
2. La reprise et la création des répertoires doivent refuser une racine ou un
   parent géré remplacé par un lien symbolique. `packageDirectory` vérifie les
   composants avant nettoyage/déplacement ; tests root/stage/versions/package et
   stage de catalogue avec sentinelles externes conservées. Cela ne constitue pas
   une protection contre un attaquant OS modifiant simultanément les chemins :
   verrou applicatif et propriété exclusive du répertoire restent requis.
3. L'éligibilité du catalogue en cache pouvait devenir périmée après activation
   ou désactivation d'une dépendance. Elle est maintenant recalculée à la lecture
   sans scanner les ZIP ni installer quoi que ce soit automatiquement.

## Hors qualification et relais explicites

État historique de sortie du lot 4 ; le portage/raccordement suivant est maintenant
qualifié séparément dans [LOT5-QUALIFICATION.md](LOT5-QUALIFICATION.md).

- **Lot 5** : vrais registres/routes CORE et package Semaine type livré, association
  des usages du shell, remontage explicite des contributions après invalidation.
- **Lots 6/7** : vues explicatives indisponibles gardant les emplacements, interface
  complète de catalogue/gestion, thèmes et moteurs de slots/features. Les états,
  raisons et notifications natifs nécessaires existent ; pas encore leur UI.
- **Lot 8** : vrais bundles et ressources distribués hors ASAR, sauvegarde/restauration,
  récupération de livraison, migration personnelle et qualification finale macOS.
  Build production sans packaging ≠ installateur distribué qualifié.
- Pas de purge physique de versions/données, téléchargement ou mise à jour
  automatique, garantie contre panne électrique/fsync, ni qualification Windows/Linux.
- Les dialogues sont simulés pour les tests ; aucune acceptation personnelle ni
  promesse d'audit de sécurité exhaustif/absence de vulnérabilités Chromium.

La clôture du lot 4 signifie que son **installation locale est testable avec des
contributions supportées et validées dans le harnais** (§11 du plan). Elle
n'autorise pas à lever une garde ni à anticiper les lots suivants.
