# Jeux de données legacy synthétiques

Données inventées pour tester la migration JSON → SQLite. Aucune donnée personnelle.
Les tests copient ces fichiers dans un répertoire temporaire ; ne jamais pointer l'application sur ce dossier.

| Dossier | Cas couverts |
| --- | --- |
| `full-current` | Format actuel complet : hiérarchies de tâches sur 3 niveaux, identifiants enfants répétés entre projets (`t_root`, `d_1`, `mod_tasks`), blocs personnalisés (titres, tableau, graphique avec valeurs textuelles partielles `-`, `1,`, `""`, `007`), type de bloc inconnu, layout vide, corbeille liée à un projet supprimé, références orphelines (notes, erreurs, dossier, projet), plusieurs semaines avec identifiants de créneaux copiés, semaine active non par défaut, réglages et préférences renderer. |
| `legacy-v0` | Ancien format : plateformes en liste plate, projets sans `type`/`tags`/`layout`/`links`, dossier sans `displayMode`, semaine en `weekSlots`/`wakeTimes` seulement, créneaux invalides (chevauchement, heures, doublon, couleur, sans id) et heures de réveil incomplètes. |
| `divergent-weeks` | `weekPresets` et `weekSlots` divergents, noms en doublon sans casse, preset sans id, semaine active inconnue. |
| `invalid-json` | JSON tronqué : l'import doit échouer sans rien remplacer. |
| `duplicate-ids` | Deux projets de même identifiant : l'import doit être bloqué avec rapport. |
| `empty` | Aucun fichier legacy : première installation. |
