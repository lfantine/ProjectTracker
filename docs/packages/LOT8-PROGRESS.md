# Lot 8 — Livraison et récupération (terminé sur macOS arm64)

## Livré dans ce premier incrément — 16 octobre 2026

### Sauvegarde et restauration natives

- Sauvegarde v2 publiée seulement après validation : snapshot via API SQLite (WAL cohérent), ressources gérées, inventaire taille/SHA-256. Un dossier `.pending` n'est pas une sauvegarde terminée. Les JSON originaux et fichiers externes restent inchangés.
- Vérification sur copie temporaire : une connexion SQLite même read-only peut créer des sidecars WAL/SHM ; aucune ouverture SQLite directe de la sauvegarde sélectionnée. Schéma exactement reconnu, intégrité, clés étrangères, manifestes et ressources gérées vérifiés ; aucune extension SQLite chargée. Refus des liens symboliques, dépassements, fichiers ajoutés/altérés et schémas exécutables inattendus même réempreintés.
- Sélecteur de dossier et confirmation natifs, Annuler par défaut. Pas de chemin fourni par le renderer, aucune fusion. Préparation à côté, puis journal persistant et remplacement reprenable avant toute ouverture de base. L'état précédent (base, WAL/SHM et packages) reste dans `restore-<uuid>/previous/` ; les JSON et les sauvegardes existantes ne sont pas remplacés.
- Tous les packages actifs restaurés deviennent disabled/requires-consent ; les anciens dossiers liés sont déliés. Aucun auteur ni droit sauvegardé ne constitue un nouvel accord d'exécution.
- Le runtime est fermé avant remplacement ; la fermeture de sa fenêtre ne doit pas terminer le travail natif de restauration. Redémarrage sans tiers après la fin. Tests SIGKILL réels aux cinq frontières journal/base/packages, reprise idempotente.
- Les sauvegardes v1 et schémas différents ne sont pas acceptés par ce nouveau restaurateur ; ne jamais les forcer en modifiant leurs métadonnées.

### Repli et diagnostic

- `--safe-mode` (ou `AMBER_SAFE_MODE=1`) lance le shell sans runtime, thèmes ou prévalidation de tiers. Action Réglages avec confirmation native. Aucun changement des états d'installation au simple démarrage sans tiers.
- Shell statique de récupération disponible même si le runtime modulaire était demandé et que l'import échoue. Nouvelle tentative dans ce mode repasse par un redémarrage complet, pas par un service de packages à moitié initialisé.
- Reprise native des quatre anciennes clés localStorage du profil historique avant ouverture de la session isolée : page vide, aucun ancien script ni preload, clés fermées, adoption transactionnelle une fois seulement. Les valeurs SQLite déjà présentes restent prioritaires. Sources non effacées ; échec de lecture = récupération, pas adoption silencieuse des défauts.
- Diagnostic technique consultable/exportable (200 entrées, champs techniques seulement), sans messages libres ou documents métier. Export local dans `logs/`.
- Correction de nettoyage : ne pas accéder au webContents d'une fenêtre déjà détruite. Les erreurs natives fatales ne restent plus bloquées dans une boîte modale ; les stacks sont limitées au mode de test.
- Surcharges de tests : refus du répertoire personnel même par lien symbolique ; profil Electron de test réellement sous le temporaire système.

### Distribution macOS

- Produit affiché `amber`, icônes existantes, DMG et ZIP arm64. Identités techniques historiques et emplacement `~/.data/ProjectTracker` conservés ; aucun déplacement de données.
- Code/renderer dans ASAR. Runtime et archives livrées également disponibles comme ressources réelles `Contents/Resources/amber-runtime/` : préloads, bootstrap et inventaires inclus. Données SQLite, installations et staging restent hors du bundle.
- `npm run build:mac` construit la distribution ; `npm run test:packaged` monte le DMG en lecture seule, copie réellement l'app dans un dossier Applications temporaire en conservant ses liens relatifs de frameworks, démonte le volume, puis rejoue les parcours contre cette copie.
- Le harnais de distribution ne lance jamais l'app sans données/profil temporaires. Barrière d'attachement CDP limitée au mode test : Electron empaqueté ignore le loader `-r` de Playwright ; les fenêtres des sessions isolées doivent être créées après attachement. La barrière ne modifie ni droits, ni consentements, ni confinement. Fermeture du harnais bornée, échec explicite plutôt que blocage infini.
- Construction locale **non signée et non notarisée**. Aucun certificat, compte Apple ou mécanisme de mise à jour ajouté. Les tests ne prouvent pas Gatekeeper pour une app téléchargée, ni Windows/Linux/x64.

## Clôture — 16 octobre 2026

- **Lot terminé pour la distribution locale macOS arm64**, Electron **41.10.3**, macOS **26.5.1 (25F80)**. Les paragraphes « premier incrément » ci-dessus restent l'historique du travail.
- Gardes `PERSONAL_SQLITE_MIGRATION_QUALIFIED=true` et `EXTERNAL_RUNTIME_QUALIFIED=true`, mais elles ne suffisent jamais seules : admission native initialisée une seule fois, app réellement empaquetée, production, plateforme/architecture/moteur exacts et hors mode test. Aucun paramètre IPC ne peut accorder cette admission. Un changement de moteur impose une nouvelle qualification ; développement, x64, Windows/Linux et versions Electron différentes ne migrent pas le répertoire personnel. La comparaison des chemins résout aussi les liens symboliques.
- Les parcours TEST/MODULES restent séparés, sous données/profil temporaires. L'app empaquetée en mode test n'obtient pas l'admission de livraison.
- `scripts/qualify-release.mjs` lance réellement l'exécutable installé **sans TEST, MODULES, DATA_DIR ni barrière de qualification**. Seuls HOME et le profil Electron sont redirigés vers le temporaire. Contrôles : chemin personnel par défaut sous ce HOME, import complet de trois projets, JSON original identique, archive datée identique et SHA-256 vérifié, reprise des préférences, activation/ouverture native de builtin.week, sauvegarde v2, deuxième lancement sans réimport, préférence persistante, mode sans tiers et récupération accessible sur JSON invalide. Les données et le profil historiques réels sont empreintés avant/après.
- Le harnais DMG exécute désormais cette répétition du premier lancement normal **après copie et démontage**, avant les 15 scénarios Electron existants.
- Veille/reprise : test du vrai composant du widget avec saut d'horloge simulant une suspension, focus puis visibilité : progression recalculée, créneau passé, aucune écriture. Tests de brouillon préservé au focus et arrêt/nettoyage des abonnements conservés. Les coupures SIGKILL de restauration et d'installation/migration sont qualifiées séparément.
- **Limites explicites :** pas de vraie veille matérielle, coupure électrique, certificat Apple, notarisation/Gatekeeper téléchargé, auto-update, HTTPS public live, autre OS/architecture ou nouvelle version de moteur qualifiés. Ces limites ne deviennent pas des promesses de livraison publique. L'app peut migrer au prochain lancement utilisateur qualifié ; aucun essai n'a migré les données réelles.

## Validations réellement exécutées

Sur macOS **26.5.1 (25F80), arm64**, Electron 41.10.3 :

- `npm run typecheck` : zéro erreur sur six périmètres.
- `npm test` : **225 DOM + 341 services = 566 tests**, **6/6 suites legacy** réussies. La restauration du jeu complet compare maintenant l'export avant/après via le vrai validateur/journal, pas une simple copie manuelle.
- `npm run test:runtime` : Chromium, refus réseau/WebRTC, SDK, prévalidation et migrations réussis (avant les dernières modifications du bootstrap natif, qui sont couvertes séparément par les parcours de distribution).
- `CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:mac` : build de production, ASAR, DMG et ZIP réussis. Les dépendances optionnelles des autres architectures non embarquées ne constituent pas un test de ces plateformes.
- `npm run test:packaged` : **15/15 scénarios** sur l'app réellement copiée depuis le DMG puis exécutée après démontage de l'image. Inclut les vrais ZIP externes/thème/features/migration, annulation native, restauration confirmée/redémarrage sans tiers, échec d'import accessible en shell modulaire et adoption des préférences de l'ancien profil une fois seulement. Empreinte personnelle inchangée.
- `git diff --check` réussi.

Logs locaux : `/tmp/amber-lot8-{types,tests,runtime,build,packaged,e2e}-final.log`. Les essais intermédiaires échoués ont permis les corrections documentées ; ils ne sont pas comptés comme qualifications réussies. Artefacts de préversion : `dist/amber-1.0.0-mac-arm64.dmg` et `.zip`.

- Passe E2E hors packaging sur le même build final : `node scripts/e2e.mjs`, **15/15 scénarios**, empreinte personnelle inchangée.

### Passe finale après ouverture contrôlée des gardes

- `npm run typecheck` : six périmètres, zéro erreur.
- `npm test` : **226 DOM + 350 services = 576 tests**, **6/6 suites legacy** réussies (9 tests de politique de livraison et 1 test de reprise simulée ajoutés).
- `npm run test:runtime` : réussi, SDK, migrations et confinement Chromium/WebRTC.
- `CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:mac` : ASAR, ressources réelles, DMG et ZIP construits.
- `node scripts/qualify-release.mjs <exécutable dist>` : premier lancement normal et reprises réussis.
- `npm run test:packaged` : premier lancement normal depuis la copie du DMG démonté, puis **15/15 scénarios**, empreintes personnelles inchangées.
- `node scripts/e2e.mjs` : **15/15**, empreinte personnelle inchangée.
- `git diff --check` : réussi. Logs finaux `/tmp/amber-lot8-finish-{types,tests,runtime,build,release,packaged,e2e}.log`.

Récupération utilisateur : [procédure](../storage/RECOVERY.md). Artefacts locaux non signés : `dist/amber-1.0.0-mac-arm64.dmg` et `.zip`. Aucun commit/reset, travail préexistant conservé.
