# Application de note — réunions enregistrées et analysées

Application de prise de notes qui enregistre en direct un appel ou une visioconférence (Zoom, Teams, Google Meet, Discord…) depuis votre ordinateur, le transcrit, puis range les idées et informations dans des tableaux :

| Tableau | Colonnes |
|---|---|
| Décisions | Décision, Contexte |
| Actions | Tâche, Responsable, Échéance |
| Idées | Idée, Auteur |
| Informations clés | Sujet, Détail |
| Questions | Question, Statut, Réponse |

Plus un résumé, vos notes manuelles et la transcription horodatée. Toutes les cellules sont modifiables. Export en Markdown ou en CSV (compatible Excel).

Le dépôt contient aussi une seconde application indépendante, [Sperme intelligent](#sperme-intelligent) : une simulation d'agents IA qui apprennent par évolution.

## App Android

L'app **Notes Réunion** fonctionne de deux façons :

| | Téléphone seul | Connecté au PC |
|---|---|---|
| Son enregistré | micro du téléphone (réunion en présentiel, ou téléphone posé près des haut-parleurs) | micro du téléphone, **ou** son de l'ordinateur capté par le PC (tous les participants de l'appel) |
| Transcription et analyse | clés API saisies dans les Réglages de l'app, sinon analyse locale par mots-clés | faites par le PC avec ses clés (`.env`) |
| Notes | stockées sur le téléphone | notes du PC, synchronisées en direct dans les deux sens |

### Installer l'app

1. Sur le téléphone, ouvrez la page **Releases** du dépôt GitHub et téléchargez le dernier `notes-reunion-1.0.N.apk` (compilé automatiquement par GitHub Actions à chaque modification).
2. Ouvrez le fichier, puis autorisez l'installation depuis le navigateur si Android le demande.
3. Les versions suivantes s'installent par-dessus sans effacer les notes.

### Connecter le téléphone au PC

1. Lancez l'application sur le PC (`npm start`) et ouvrez http://localhost:3000.
2. Mettez le téléphone et le PC sur le même réseau :
   - **même Wi-Fi**, ou
   - **câble USB** : sur le téléphone, Paramètres › Réseau › Point d'accès et partage de connexion › **Partage de connexion USB**. Le PC passe alors aussi par les données mobiles du téléphone pour Internet (transcription et analyse) : comptez quelques Mo par heure de réunion.
3. Sur le PC, cliquez sur **📱 Connecter le téléphone**. Dans l'app : Réglages › **Scanner le QR code du PC**.
4. Si Windows demande d'autoriser Node.js sur le réseau, acceptez pour les réseaux privés.

L'app se reconnecte seule quand le PC redevient joignable (en 10 s environ).

### Enregistrer depuis le téléphone

- **🎙 Enregistrer avec le micro du téléphone** : le téléphone enregistre et envoie des segments de 20 s à la transcription. Gardez l'app au premier plan : l'écran reste allumé, et Android coupe le micro des apps en arrière-plan.
- **💻 Enregistrer le son de la réunion sur le PC** (note stockée sur le PC) : le PC affiche « Démarrer maintenant ». Un clic sur le PC reste obligatoire, car les navigateurs n'autorisent jamais le partage d'écran ou de son sans action de l'utilisateur. La transcription et les tableaux s'affichent ensuite en direct sur le téléphone, qui peut arrêter l'enregistrement.

Le câble USB ne transporte pas le son du PC vers le téléphone : Android ne peut pas servir de micro USB au PC, ni capter le son d'un appel passé sur le téléphone lui-même. C'est pourquoi la capture du son de l'appel se fait sur le PC.

### Compiler l'APK soi-même

```bash
npm ci && (cd mobile && npm ci && npm run sync)
cd mobile/android && ./gradlew assembleRelease   # nécessite le SDK Android
```

APK produit : `mobile/android/app/build/outputs/apk/release/app-release.apk`. Pour tester l'interface mobile dans un navigateur : `cd mobile && npm run serve`, puis lancez le serveur PC avec `MOBILE_ORIGINS=http://127.0.0.1:5173`.

## Démarrage

Prérequis : Node.js 20.12 ou plus récent, Chrome ou Edge.

```bash
npm install
cp .env.example .env   # puis renseignez les clés (voir ci-dessous)
npm start
```

Ouvrez http://127.0.0.1:3000.

## Configuration (`.env`)

| Variable | Rôle | Sans elle |
|---|---|---|
| `ANTHROPIC_API_KEY` | Analyse de la transcription par Claude : comprend le contexte, attribue les responsables, sépare décisions et simples idées. | Extracteur local par mots-clés : gratuit et hors ligne, mais bien moins fiable. |
| `TRANSCRIPTION_API_KEY` (+ `TRANSCRIPTION_API_URL`, `TRANSCRIPTION_MODEL`) | Transcription côté serveur de **tout** l'audio (vous + les autres participants), via n'importe quelle API compatible Whisper : OpenAI (`whisper-1`, `gpt-4o-transcribe`), Groq (`whisper-large-v3`), ou un serveur local (`faster-whisper-server`, `whisper.cpp`). Pour un serveur local sur `localhost`, aucune clé n'est nécessaire. | Seule la reconnaissance vocale du navigateur est disponible : elle n'entend que votre micro. |

## Enregistrer une réunion

1. Créez une note, puis choisissez la source **Réunion : son de l'ordinateur + micro**.
2. Cliquez sur **Démarrer l'enregistrement**. Le navigateur demande quoi partager :
   - **Réunion dans le navigateur** (Meet, Teams web…) : choisissez l'**onglet** de la réunion et cochez **Partager l'audio de l'onglet**.
   - **Application de bureau** (Zoom, Teams) : choisissez **Écran entier** et cochez **Partager l'audio du système**. Cette option existe sous Windows et ChromeOS. Sous macOS, Chrome ne capture que l'audio d'un onglet : utilisez la version web de la réunion, ou un périphérique audio virtuel ([BlackHole](https://github.com/ExistentialAudio/BlackHole)) configuré comme entrée micro, avec la source **Micro uniquement**.
3. L'audio est découpé en segments de 20 s envoyés à la transcription. Si **Analyse en direct** est cochée, les tableaux se mettent à jour toutes les 90 s, puis une dernière fois à l'arrêt.
4. À la fin, **Télécharger l'audio** récupère l'enregistrement complet (.webm).

À noter : une nouvelle analyse remplace les tableaux, y compris vos modifications manuelles. Faites vos corrections après l'analyse finale.

## Architecture

```
navigateur                                    serveur Node (127.0.0.1)
────────────────────────────────              ─────────────────────────────────────
getDisplayMedia (son onglet/écran) ─┐
getUserMedia (micro) ───────────────┴─ mix Web Audio
   ├─ MediaRecorder (fichier complet, téléchargeable)
   └─ MediaRecorder par segment de 20 s ──► POST /api/transcribe ─► API Whisper
                                                                 ◄─ texte
transcription + notes ─────────────────────► POST /api/analyze ──► Claude (sortie JSON structurée)
                                                                 ◄─ tableaux
notes (titre, texte, transcription, tableaux) ◄─► /api/notes ────► data/notes.json
```

- Un enregistreur est redémarré à chaque segment : les fragments produits par un seul `MediaRecorder` ne sont pas lisibles séparément par l'API de transcription.
- Les segments silencieux ne sont pas envoyés, et les phrases que Whisper invente sur du silence (« Sous-titres réalisés par la communauté d'Amara.org »…) sont filtrées.
- L'analyse utilise `claude-opus-5` avec une sortie structurée validée par un schéma Zod (`src/analyze.js`), et le repli serveur automatique en cas de refus.
- Le serveur écoute sur le réseau local pour l'app Android. Toute requête qui ne vient pas de la page ouverte sur le PC doit présenter la clé de jumelage (générée au premier lancement, stockée dans `data/pairing.json`). La page du PC est aussi protégée contre les appels d'autres sites ouverts dans le navigateur (contrôle des en-têtes `Origin` et `Host`). Avec `HOST=127.0.0.1`, le serveur n'est accessible que depuis le PC.
- Pour révoquer l'accès d'un téléphone : arrêtez le serveur, supprimez `data/pairing.json`, relancez, puis rescannez le QR code.

| Fichier | Contenu |
|---|---|
| `server.js` | Démarrage du serveur |
| `src/app.js` | API HTTP, authentification, événements en direct, télécommande |
| `src/pairing.js` | Clé de jumelage, adresses réseau, QR code |
| `src/claude.js` | Extraction par Claude (partagé avec le mobile) |
| `src/heuristic.js` | Extracteur local par mots-clés (partagé) |
| `src/whisper.js` | Client de l'API de transcription (partagé) |
| `src/store.js` | Stockage JSON des notes |
| `public/recorder.js` | Capture et mixage audio, segmentation (partagé) |
| `public/tables.js` | Rendu des tableaux modifiables (partagé) |
| `public/export.js` | Définition des tableaux, export Markdown/CSV (partagé) |
| `public/app.js` | Interface du PC |
| `mobile/src/` | App Android : interface, liaison au PC, stockage local, scanner de QR code |
| `mobile/android/` | Projet Android (Capacitor) |
| `sperme-intelligent/` | Application [Sperme intelligent](#sperme-intelligent), indépendante du reste |

## Tests

```bash
npm test
```

## Confidentialité

Prévenez les participants avant d'enregistrer : l'enregistrement d'une conversation sans le consentement des personnes est illégal dans de nombreux pays, dont la France. L'audio est envoyé au fournisseur de transcription configuré, et le texte à Anthropic si l'analyse Claude est activée.

## Sperme intelligent

Simulation dans le navigateur : des spermatozoïdes doivent atteindre l'ovule en évitant des obstacles. Personne ne leur programme de trajet : chacun est un agent doté d'un petit réseau de neurones, et ces réseaux s'améliorent de génération en génération par sélection naturelle.

### Lancer

Ouvrez `sperme-intelligent/index.html` dans un navigateur, sur ordinateur ou téléphone. Un seul fichier, aucune installation, aucune connexion requise.

### Commandes

| Action | Effet |
|---|---|
| Glisser sur le terrain | Dessine un obstacle |
| Clic droit ou appui long | Déplace l'ovule |
| Population | Nombre d'agents par génération (20 à 400) |
| Mutation | Probabilité qu'un poids du réseau soit modifié au hasard à la naissance |
| Vitesse | Accélère la simulation (×1 à ×30) |
| Ovule mobile | Place l'ovule au hasard à chaque génération, pour vérifier que les agents généralisent |
| Effacer obstacles / Recommencer | Retire les murs / repart de cerveaux aléatoires |

Le champion de la génération est en jaune, avec ses capteurs visibles. Le panneau **Cerveau du champion** affiche son réseau en direct (bleu : positif, rouge : négatif), et la courbe verte le pourcentage d'agents arrivés à chaque génération.

### Fonctionnement

1. **Perception** : à chaque instant, l'agent mesure la distance au mur le plus proche dans 5 directions, l'angle et la distance de l'ovule, et sa propre vitesse (9 entrées).
2. **Décision** : un réseau 9 → 8 → 2 (activation `tanh`) en déduit de combien tourner et accélérer. Toucher un mur ou un bord tue l'agent.
3. **Score** : plus l'agent s'est approché de l'ovule, meilleur il est ; l'atteindre rapporte bien plus, d'autant plus s'il arrive vite ; mourir contre un mur divise le score.
4. **Évolution** : les 2 meilleurs passent intacts à la génération suivante. Les autres naissent de deux parents choisis par tournoi : chaque poids vient de l'un ou l'autre, puis subit éventuellement une mutation gaussienne.

Les poids ne sont jamais ajustés par rétropropagation : seule l'évolution les modifie (neuroévolution).

Ordre de grandeur mesuré (150 agents, terrain par défaut) : environ 75 à 90 % d'arrivées après une centaine de générations avec l'ovule fixe, et environ 75 % en moyenne avec l'ovule mobile, ce qui montre que les agents ont appris une stratégie générale plutôt qu'un trajet.
