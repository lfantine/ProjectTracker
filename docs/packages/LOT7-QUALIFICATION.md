# Lot 7 — Qualification isolée (16 octobre 2026)

## Périmètre livré

Le marketplace décrit dans `LOT7-PROGRESS.md` est désormais complété par les moteurs natifs de thèmes et de fonctionnalités. Les archives livrées sont consultables avant import, avec contenu et permissions ; import et activation restent deux opérations distinctes avec confirmation native. Les sélections opaques du catalogue survivent aux lectures concurrentes et sont invalidées au rafraîchissement explicite.

### Thèmes

- JSON strict, limité à 16 Kio : version 1, palettes light/dark, cinq clés fermées background/surface/text/accent/border, couleurs hexadécimales à six chiffres. Aucun CSS arbitraire.
- Texte exposé `week.title` uniquement, injecté comme texte ; aucun remplacement des messages de sécurité du shell.
- Fond local facultatif, présent dans l'inventaire vérifié, limité à 512 Kio : PNG/JPEG/WebP avec vérification de signature. Pas de SVG, HTML ou URL distante.
- Un seul thème actif par cible : remplacement confirmé, désactivation atomique de l'ancien et invalidation des consommateurs. Un conflit conservé anormalement est suspendu par l'audit, sans choix arbitraire.
- Cible CORE ou package compatible ; préférences clair/sombre/système indépendantes. Le bootstrap suit le mode système ; disparition du thème restitue les valeurs par défaut. Le champ informatif SDK du mode système reste initialement light, il ne constitue pas un abonnement dynamique au thème.
- `builtin.amber-theme` cible Semaine type, avec palettes Ambre et titre exposé. Le shell CORE emploie ses propres variables fermées lorsqu'un thème le cible.

### Fonctionnalités et slots

- Cible active et version compatible obligatoires ; identité/version de slot contrôlées nativement. Une mise à jour de cible supprimant un slot utilisé est refusée, ancienne version conservée. Désactivation de cible suspend les consommateurs ; réactivation explicite.
- Ordre stable par identité de package. Chaque feature possède son contexte, origine, droits et espace privé propres, sans héritage des permissions du parent.
- L'instance est celle de la vue consultée, active ou fixe ; révocation du parent révoque ses features. Les frames sont des frères montés dans une zone de slots gérée par l'hôte sous le majeur, jamais des iframes arbitraires insérées par le package.
- Même sandbox, prévalidation et migrations privées que les packages. La projection native vers le runtime ne permet pas au renderer de fabriquer des droits ou une identité.
- Le contrat actuel ne déclare pas de formulaire de configuration mutable des features : pas d'éditeur arbitraire ajouté. Le stockage privé reste disponible selon les droits.

### Bilan de la semaine

`builtin.week-report` consomme l'export autorisé de `builtin.week` et les projets CORE en lecture. Totaux en minutes par jour et projet ; catégories explicites Sans projet et Projet manquant ; réveils exclus. Les événements d'export/projets rafraîchissent le bilan. Aucune copie des documents métier partagés dans un second stockage.

Les deux archives sont produites par `scripts/build-extension-packages.mjs` et intégrées au build avec inventaires d'empreinte. Elles ne sont pas compilées dans le renderer et ne sont pas automatiquement activées.

## Preuves exécutées

- `npm test` : 225 tests DOM + 331 services, soit 556 ; 6 suites legacy réussies.
- `npm run typecheck` : zéro erreur sur six périmètres.
- `npm run test:runtime` : confinement Chromium, réseau/WebRTC, prévalidation et migrations réussis.
- `node scripts/e2e.mjs --build` : build de production sans packaging et 11 scénarios Electron réussis.
- `node scripts/e2e.mjs extensions` : parcours complété avec migration réelle d'une extension vers stockage v2 dans la sandbox, puis redémarrage sans ZIP source, réussi.
- Les parcours réels importent des ZIP externes de majeur/mineur/widget, thème et features ; deux features isolées, plusieurs semaines (270/510 minutes), projet manquant, suppression de tous les projets, mode sombre et redémarrage. Les tests services couvrent conflits de thèmes, données refusées, cible/slot incompatible, suspension/réactivation et révocation du parent.
- Empreinte personnelle inchangée dans les E2E ; toutes les bases/profils/sources de test sont temporaires. `git diff --check` réussi.

## Limites conservées et reprise

`EXTERNAL_RUNTIME_QUALIFIED=false` et `PERSONAL_SQLITE_MIGRATION_QUALIFIED=false`. L'intégration reste limitée au shell de qualification avec variables de test et répertoire réellement temporaire. Aucun consentement personnel implicite, aucune migration personnelle, aucun commit/reset.

Le lot 8 reste distinct : migration réelle contrôlée et distribution desktop, installateur/ASAR, autres OS et scénarios de panne non qualifiés ici. Ne pas déduire de cette qualification une autorisation d'ouvrir le runtime personnel.

Dernière passe de clôture : les quatre commandes `npm test`, `npm run typecheck`, `npm run test:runtime` et `node scripts/e2e.mjs` ont toutes terminé avec le code 0. Les 11 scénarios incluent désormais la migration réelle de feature. Logs locaux : `/tmp/amber-lot7-close-{tests,types,runtime,e2e}.log`. Des latences intermittentes de fermeture/lancement Electron ont été observées ; elles ne constituent pas une qualification de performance.
