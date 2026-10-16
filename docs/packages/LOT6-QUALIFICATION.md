# Lot 6 — Composition et navigation (16 octobre 2026)

## Livré

- Service natif de composition : commandes fermées, validation des références, configurations et liaisons, CAS global, identifiants d'opération idempotents et mutations SQLite atomiques. Les événements publics ne contiennent pas les documents privés.
- Dashboards : création, renommage, duplication avec nouveaux identifiants d'emplacements, choix du défaut, suppression avec remplacement atomique du défaut et conservation obligatoire d'un dashboard. Dupliquer ne duplique pas les instances métier.
- Grille React Grid Layout v2 : largeur du conteneur (lg ≥1200/12 colonnes, md ≥800/6, sm/1), dérivation sans écriture des dispositions manquantes, sauvegarde indépendante à la fin du geste, poignées en édition seulement, déplacement clavier et boutons de déplacement/redimensionnement. Contraintes min/max déclarées appliquées ; collisions refusées nativement. Interactions des frames désactivées pendant le geste.
- Accueil : huit widgets CORE existants et widget Semaine type, rendus dans les emplacements persistants. État vide explicite sans supprimer l'emplacement. Dépendances indisponibles : configuration et layouts conservés.
- Widgets et mineurs de package : ajout, retrait et éditeur déclaratif, liaison à l'instance active ou fixe. Les instances inexistantes ne sont pas remplacées silencieusement ; reconfiguration explicite possible. Les interfaces spécifiques restent dans les frames SDK.
- Sidebar persistante : ajout, destination native/dashboard/majeur, instance active/fixe, nom, icône, masquage, ordre et retrait. Réglages et Personnalisation sont permanents. Restauration des entrées par défaut sans supprimer les raccourcis personnalisés, dashboards ou packages, et sans réinstallation.

## Vérifications exécutées

- `npm run typecheck` : zéro erreur sur les six périmètres.
- Tests DOM : 216 ; services Electron-Node : 323 ; 6 suites legacy réussies. Les services n'utilisent que des bases temporaires.
- `node scripts/e2e.mjs --build` : production sans packaging et neuf scénarios Electron réussis, dont le vrai shell avec Semaine type confinée.
- `node scripts/e2e.mjs composition` : parcours renforcé après le build, déplacement clavier, glisser et redimensionner réels, absence d'écriture pendant le glisser, persistance lg/md/sm après redémarrage, masquage de toute la navigation puis restauration depuis l'accès permanent.
- Services : suppression du dernier dashboard refusée, remplacement du défaut, duplication indépendante, CAS/idempotence, inventaire de grille, absence d'écriture partielle, cibles manquantes, commandes injectées et bindings invalides. Widgets composés sur deux dashboards : invalidation de la liaison active, conservation de la liaison fixe, suppression de sa cible sans altérer les layouts puis reconfiguration.
- `git diff --check` réussi. Empreinte du répertoire personnel inchangée pendant les E2E.

## Frontières conservées

Qualification sur Electron/macOS et données synthétiques, sans ouverture des imports externes dans le profil personnel. `EXTERNAL_RUNTIME_QUALIFIED` et `PERSONAL_SQLITE_MIGRATION_QUALIFIED` restent faux. Pas de nouvelle qualification runtime réseau : les primitives de confinement ne changent pas. Pas de packaging/installateur distribué ni migration personnelle (lot 8). Marketplace et moteurs d'extensions restent au lot 7.
