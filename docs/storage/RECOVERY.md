# Stockage SQLite : validation et récupération

Le socle natif utilise `tracker.sqlite` ; les fichiers `data.json` et `settings.json` d’origine restent intacts. Les quatre anciennes clés de préférences du renderer restent disponibles pour récupération, mais l’application ne les réécrit plus après adoption.

## Développement isolé

La migration personnelle est admise uniquement pour l’app empaquetée de production qualifiée : macOS arm64, Electron 41.10.3, hors mode test. `main/core/release.ts` et `main/core/qualification.ts` refusent toujours un lancement de développement ou une plateforme/moteur non qualifiés. Ne pas modifier ces gardes pour tester le développement. Utiliser deux répertoires temporaires distincts :

```sh
export PROJECT_TRACKER_TEST=1
export PROJECT_TRACKER_DATA_DIR="$(mktemp -d /tmp/projecttracker-data.XXXXXX)"
export PROJECT_TRACKER_USER_DATA_DIR="$(mktemp -d /tmp/projecttracker-profile.XXXXXX)"
npm run dev
```

Pour essayer un import, copier exclusivement des fixtures synthétiques ou des copies isolées des JSON dans ce répertoire avant le lancement. Ne pas lancer deux applications sur le même répertoire. Ne pas supprimer le répertoire temporaire tant que ses résultats sont utiles.

Contrôles : `npm run typecheck`, `npm test`, `node scripts/e2e.mjs --build`. Ce dernier construit l’application sans packaging, utilise un profil et des données temporaires pour chaque scénario et vérifie que le répertoire personnel n’a pas changé.

## Sauvegarder

Depuis Réglages, « Sauvegarder la base » crée un sous-dossier de `backups/` avec `tracker.sqlite` et `backup.json`. La copie utilise l’API SQLite de sauvegarde et prend en compte le journal WAL. Ne pas copier manuellement le seul fichier actif pendant que l’application tourne.

« Exporter en JSON » crée un export versionné lisible contenant les objets métier, préférences, semaines, composition, documents de packages, références non résolues et archives de migration. Cet export permet l’inspection et l’extraction des données ; il n’existe pas encore de bouton de réimport de cet export. Ce fichier enveloppé n’est pas un ancien `data.json` et ne doit pas être renommé comme tel.

Les fichiers externes référencés par les projets ne sont pas inclus. Les ressources des packages gérés sont copiées à côté de la base et vérifiées. La sauvegarde v2 contient un inventaire SHA-256 ; les fichiers externes liés aux projets restent exclus.

## Restaurer une sauvegarde v2

Dans Réglages, choisir **Restaurer une sauvegarde…**, sélectionner le dossier contenant `backup.json` et `tracker.sqlite`, puis confirmer dans le dialogue natif (Annuler par défaut). Aucune fusion : la sauvegarde est vérifiée et préparée à côté, l'état courant est conservé dans `restore-<uuid>/previous/`, puis l'application redémarre sans tiers. Les packages restaurés exigent une réactivation explicite. Les JSON originaux restent intacts.

Les empreintes protègent contre une modification accidentelle, pas contre un éditeur malveillant qui les recalcule : la validation stricte du schéma et des ressources reste obligatoire. Ne pas modifier les empreintes ou `user_version` pour forcer une restauration refusée. Les anciennes sauvegardes v1/schémas différents ne sont pas admis par ce restaurateur.

En cas d'interruption après création de `restore-pending.json`, la reprise native termine le remplacement sous verrou avant d'ouvrir SQLite, sans exécuter de tiers. Ne pas effacer le journal ni mélanger manuellement base et WAL. Conserver le dossier `restore-<uuid>` et les sauvegardes pour diagnostic.

### Démarrer sans tiers

Action **Redémarrer sans tiers** dans Réglages, ou lancer le binaire avec `--safe-mode`. Quitter cette session et relancer normalement pour sortir de ce mode. Il empêche tout runtime/prévalidation/thème externe, sans désinstaller ni désactiver les packages à lui seul.

Le premier lancement distribué est qualifié dans un HOME/profil jetable, sans les variables TEST/MODULES/DATA_DIR. Les gardes de livraison sont ouvertes uniquement pour le bundle macOS arm64 et Electron 41.10.3 ; aucune migration personnelle n’a été exécutée pendant les tests. Voir `docs/packages/LOT8-PROGRESS.md` pour les résultats et limites.

## Import bloqué

Le shell et les réglages restent accessibles. Le rapport synthétique indique les références à vérifier et les valeurs archivées ; le dossier `migration/` contient les sources sauvegardées, empreintes et rapports détaillés. Corriger une copie de travail de la source, puis utiliser « Réessayer le démarrage ». Aucun marqueur d’import réussi ni données métier partielles ne sont conservés après un échec transactionnel.

Une base créée par une version plus récente est refusée. Ne pas modifier `user_version` pour forcer son ouverture : utiliser une version compatible ou restaurer une sauvegarde connue.
