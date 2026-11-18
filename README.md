# CS2 Home Panel

Panel web pour **créer et gérer un serveur Counter-Strike 2 hébergé sur ton propre PC Windows** : tu choisis un mode de jeu, une map, quelques réglages, et le serveur se lance en un clic. Le tout se pilote depuis le navigateur (console en direct, joueurs connectés, changement de map, plugins…).

![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A518.17-339933) ![Windows](https://img.shields.io/badge/OS-Windows%2010%2F11-0078D6) ![CS2](https://img.shields.io/badge/Counter--Strike-2-F7A41D)

## Fonctionnalités

- **Installation de CS2 en un clic** via SteamCMD (téléchargé automatiquement), avec barre de progression, vérification des fichiers et mises à jour.
  Ou bien **réutilisation du CS2 installé par Steam** (aucun téléchargement).
- **10 modes prêts à l'emploi** : Compétitif, Casual, Wingman, Deathmatch, Course aux armements, Retakes (officiel), Entraînement (munitions infinies, trajectoires de grenades…), Surf, Bunny hop, Personnalisé.
- **Maps** : toutes celles présentes dans l'installation, ou n'importe quelle **map du Workshop** (ID ou lien).
- **Réglages** : nom, mot de passe, joueurs max, bots et difficulté, port, token GSLT, cvars personnalisées, `-insecure`.
- **Tableau de bord temps réel** : statut, map, joueurs, durée, adresses de connexion (PC, réseau local, Internet) à copier, bouton « Rejoindre ».
- **Actions rapides RCON** : relancer la partie, fin d'échauffement, pause, ajouter / retirer des bots, changer de map, message à tous, expulser un joueur.
- **Console en direct** avec historique des commandes (↑ / ↓), filtre et commandes rapides.
- **Plugins** : installation de Metamod:Source + CounterStrikeSharp en un clic, import de plugins `.zip` par glisser-déposer (structure détectée automatiquement), activation / désactivation, admins en jeu.
- **Robuste** : le serveur CS2 continue de tourner si tu fermes le panel, et le panel le reprend en main au redémarrage. Redémarrage automatique en cas de plantage.
- **Panel protégé par mot de passe**, accessible seulement depuis ce PC par défaut (ou depuis ton réseau local si tu l'autorises).

## Prérequis

- Windows 10 ou 11.
- [Node.js](https://nodejs.org) 18.17 ou plus récent (version LTS conseillée).
- **≈ 70 Go libres** pour le serveur dédié : SteamCMD réserve toute la place dès le début du téléchargement.
  (Pas besoin si tu utilises le CS2 déjà installé par Steam.)

## Démarrage

Double-clique sur **`start.bat`** : il installe les dépendances au premier lancement, démarre le panel et ouvre <http://localhost:8420>.

Ou en ligne de commande :

```bash
npm install
npm start
```

Au premier accès, le panel te demande de choisir un mot de passe.

### Première utilisation

1. **Installer CS2** depuis l'accueil :
   - *Serveur dédié (recommandé)* : téléchargé par SteamCMD dans `D:\CS2Server\cs2` par défaut (modifiable dans **Paramètres**). Évite OneDrive et le dossier du projet.
   - *Utiliser mon CS2 Steam* : le panel détecte ton installation Steam. Rien à télécharger, mais **les plugins sont désactivés** dans ce mode : Metamod modifie les fichiers du jeu, ce qui pourrait poser problème avec VAC sur le jeu que tu utilises pour jouer.
2. **Créer un serveur** : choisis un mode, une map, règle le reste, puis **Créer et lancer**.
3. Dans CS2, ouvre la console (`~`) et tape l'adresse affichée sur l'accueil, par exemple `connect 192.168.1.10:27015`, ou clique sur **Rejoindre**.

## Jouer avec des amis

| Situation | Ce qu'il faut faire |
|---|---|
| Sur ce PC | `connect 127.0.0.1:27015` |
| Même réseau (même box) | `connect <IP locale du PC>:27015` (affichée dans le panel) |
| Par Internet | 1. Crée un **token GSLT** sur <https://steamcommunity.com/dev/managegameservers> (App ID **730**) et colle-le dans les options avancées du serveur ou dans les paramètres.<br>2. Dans l'interface de ta box, redirige le port **27015 en UDP** vers l'IP locale de ce PC.<br>3. Tes amis utilisent `connect <ton IP publique>:27015` (affichée dans le panel). |

Sans token GSLT, CS2 affiche « Connections will be restricted to LAN only » et refuse les joueurs venant d'Internet.

**Pare-feu Windows** : au premier lancement, Windows demande d'autoriser `cs2.exe` ; accepte au moins pour les réseaux privés. Le port TCP de RCON n'a pas besoin d'être ouvert (le panel s'y connecte en local).

> N'ouvre **jamais** le port du panel (8420) sur ta box : le panel peut lancer des programmes sur ton PC.

## Plugins (CounterStrikeSharp)

1. Page **Plugins** → **Installer Metamod + CounterStrikeSharp** (dernières versions, depuis alliedmods.net et GitHub).
2. Télécharge le `.zip` d'un plugin depuis sa page GitHub « Releases » et glisse-le dans la zone prévue. Le panel reconnaît les archives du type `addons/…`, `counterstrikesharp/…`, `plugins/MonPlugin/…` ou une DLL seule.
3. Ajoute ton SteamID64 dans **Admins en jeu** pour utiliser les commandes des plugins.

À chaque mise à jour de CS2, Valve remplace `gameinfo.gi` : le panel remet automatiquement la ligne de Metamod avant chaque lancement.

## Comment ça marche

```
navigateur ──HTTP / Socket.IO──► panel Node.js (Express)
                                   ├─ SteamCMD ............ installe / met à jour CS2 (app 730, connexion anonyme)
                                   ├─ cs2.exe -dedicated .. lancé via Start-Process (vraie console Windows, masquée)
                                   ├─ console.log ......... lu en continu (option -condebug) -> console du panel
                                   ├─ RCON (TCP) .......... commandes, liste des joueurs (`status`)
                                   └─ A2S_INFO (UDP) ...... statut, map, nombre de joueurs
```

- Les réglages d'un serveur sont écrits dans `game/csgo/cfg/cs2panel.cfg`, exécuté au lancement puis après chaque config de mode (`gamemode_*_server.cfg`), pour que tes cvars aient toujours le dernier mot. Quand le serveur s'arrête, ce fichier est vidé.
- Le mot de passe RCON est généré par le panel ; RCON écoute sur l'IP locale principale du PC, que le panel retrouve via `netstat`.

### Structure

```
src/
  server.js         API REST + Socket.IO
  servermanager.js  cycle de vie de cs2.exe, console, RCON, statut
  steamcmd.js       installation / mise à jour via SteamCMD
  plugins.js        Metamod, CounterStrikeSharp, import de plugins, admins
  profiles.js       serveurs enregistrés (data/servers.json)
  modes.js          définition des modes de jeu
  rcon.js, query.js protocoles Source RCON et A2S
  auth.js           mot de passe du panel, sessions
public/             interface (HTML/CSS/JS sans étape de build)
data/               configuration locale (ignorée par git)
```

### Options

| Option | Effet |
|---|---|
| `--port=8500` / `PANEL_PORT` | port du panel (sinon celui des paramètres, 8420 par défaut) |
| `PANEL_HOST=0.0.0.0` | écoute sur tout le réseau local |
| `--data-dir=…` / `PANEL_DATA_DIR` | dossier de configuration (plusieurs panels séparés) |
| `--open` | ouvre le navigateur au démarrage |

## Limites connues

- **Un seul serveur à la fois** : CS2 écrit sa console dans un fichier unique (`game/csgo/console.log`), et un PC suffit rarement pour plusieurs serveurs en même temps.
- Les bots n'apparaissent qu'une fois un joueur connecté (le serveur « hiberne » quand il est vide).
- Windows uniquement.

## Dépannage

- **« Le port 27015 est déjà utilisé »** : un autre serveur (ou CS2 lui-même en partie locale) occupe ce port ; change le port du serveur.
- **Le serveur plante au démarrage** : regarde la console ; une map Workshop invalide ou une cvar personnalisée est souvent en cause.
- **Mot de passe du panel oublié** : arrête le panel, supprime la clé `auth` dans `data/settings.json`, relance : le panel te propose d'en créer un nouveau.
- **Les amis n'arrivent pas à se connecter** : vérifie le token GSLT, la redirection du port UDP sur la box et le pare-feu Windows.
