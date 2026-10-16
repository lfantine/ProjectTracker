# Registre des contributions — début du lot 5

## Résolution commune

`ContributionRegistry` (`main/packages/registry.ts`) résout une référence
`{ packageId, contributionId }` et un type attendu (`major/minor/widget`) :

- CORE : descripteurs natifs maintenus avec l'application, jamais remplacés par
  une ligne d'installation ou une archive portant un nom similaire.
- Package : uniquement la version pointée **active**, elle-même enregistrée
  `active`, avec un manifeste valide et cohérent avec l'identité/nature/version.
  Une mise à jour `ready` n'est pas utilisée à la place du pointeur actif.
- Indisponible : raison explicite (absent, désactivé, suspendu, désinstallé,
  version invalide/absente, contribution inconnue, mauvais type, extension non
  supportée). La résolution ne supprime ni ne répare aucun usage.

C'est une **découverte de métadonnées**, pas une autorisation de lancement.
`PackageManager.resolveContribution` exige un manager prêt ; la création de
contextes exige toujours qualification, audit, vérification des ressources,
liaison d'instance et permissions natives. Aucune source disponible n'est
consultée comme si elle était installée, aucun code ni fichier du package n'est
chargé par la résolution. Les définitions retournées sont détachées.

## Adaptateurs CORE

`shared/contributionRegistry.ts` décrit les blocs natifs, leurs métadonnées de
catalogue et les identifiants d'adaptateurs, ainsi que les widgets déjà déclarés
par `shared/core.ts`. Le catalogue renderer existant consomme maintenant cette
source, avec sa propre table d'icônes React de confiance ; aucun package ne peut
y injecter du code ou du SVG.

L'ordre et les modes d'insertion restent inchangés : table, stack, échéances,
image/texte, graphique, note épinglée, erreur épinglée. Les tâches restent la
section existante du projet, sans nouveau bloc ajoutable. Les corps de rendu CORE de `ProjectModules` sont maintenant une table
d'adaptateurs typée, choisie via le même résolveur ; composants et fonctions
préexistants conservés. Une contribution non résolue produit un état explicite
sans effacer sa configuration. L'hébergement des frames reste à raccorder au
shell normal.

Le CORE historique utilise `deadlines` à la fois pour son bloc de projet et son
widget d'accueil. Le type d'hôte est donc obligatoire à la résolution native :
aucun renommage d'identité persistée ni migration de données n'est effectué ici.
Cela ne change pas la règle d'unicité des identifiants locaux dans les manifestes
externes, et CORE n'est pas installé depuis un manifeste ZIP.

## Portée de cet incrément

Une première [archive Semaine type de qualification](../../packages/builtin-week/README.md)
existe désormais avec trois vues sur le SDK, éditeurs de créneaux/réveils,
copier-coller, grille et gestion des semaines. La qualification détaillée et ses
limites sont consignées dans PLANS/PLAN.md (local) et le README du package. Pas encore de nouvelle route ou de frame de package dans l'application
normale. Les anciennes façades de stockage restent en place ;
aucun réimport legacy ni duplication d'instances/données. Les gardes runtime et
migration personnelle restent fermées. Le lot 5 reste ouvert.
