# Pulse Spike J0 : mode d'emploi

Application de test pour lever les doutes techniques de la PWA. Aucune donnée réelle, aucune donnée de patient.

## Mise en ligne (HTTPS obligatoire : caméra, installation et biométrie l'exigent)
Déposer ce dossier tel quel sur un hébergement statique : Cloudflare Pages (glisser-déposer du dossier), GitHub Pages ou Netlify. Ouvrir l'adresse sur chaque téléphone, puis :
- iPhone (Safari) : Partager, puis « Sur l'écran d'accueil ». Android (Chrome) : menu, puis « Installer l'application ».
- Toujours tester l'application **installée**, pas l'onglet du navigateur.

## Déroulé
| Jour | Onglet | Test | Résultat attendu |
|---|---|---|---|
| 1 | 1 | Installer, « Demander le stockage persistant », noter l'état | Installée : oui ; persistant : true si accordé |
| 1 | 2 | « Générer » 1 000 photos (en 10 lots de 100), puis « Déchiffrer et vérifier » | 0 échec |
| 1 | 1 | Lancer la caméra, scanner des QR (onglet 1, papier, écran) sur le téléphone d'entrée de gamme | Délai moyen < 2000 ms |
| 2 | 2 | Relever compression, chiffrement, écriture (moyenne, p95, max) | Imperceptible, pas de surchauffe |
| 3 | 3 | Créer 50 fiches hors ligne (mode avion), couper puis rétablir le réseau pendant l'envoi, fermer l'application en cours d'envoi, rouvrir | « Contrôle d'intégrité » : aucune perte, aucun doublon |
| 4 | 4 | Créer un identifiant, déverrouiller ; changer la biométrie de l'appareil et réessayer | Fonctionne ; comportement noté |
| 4 | 4 | Imprimer l'étiquette, sans réseau internet, puis la scanner avec l'onglet 1 | Lisible et lue |
| 4 | SQL | Exécuter `supabase/spike_rls.sql` dans un projet Supabase de test, puis dérouler le jeu de test en bas du fichier (déjà rejoué sur PostgreSQL local : voir `test_local_postgres.sql`) | Auditeur : lecture seule ; écriture refusée ; on ne valide pas sa propre capture |
| 5 | 1 | Ne pas ouvrir l'application depuis le jour 1, puis l'ouvrir : lire « Persistance » | Photos et fiches intactes |

Chaque téléphone : onglet « Relevé », « Copier », puis coller le texte dans un fichier au nom du modèle.

## Limites connues de cette application
- Mode « serveur simulé » : l'envoi est simulé dans le téléphone. Pour un vrai test réseau, choisir « URL réelle » avec un point d'entrée qui accepte un POST JSON.
- Les photos de test sont synthétiques ; une vraie photo réelle (onglet 2, haut) donne les tailles réelles.
- Le chiffrement mesuré ici est celui de WebCrypto sur le téléphone, avec une clé non exportable stockée dans le navigateur : c'est la concession de la PWA (pas de coffre matériel).
