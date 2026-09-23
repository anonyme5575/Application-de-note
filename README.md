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
- Le serveur n'écoute que sur `127.0.0.1` : les notes et les clés restent sur votre machine. La capture audio exige un contexte sécurisé (`localhost` ou HTTPS).

| Fichier | Contenu |
|---|---|
| `server.js` | API HTTP et fichiers statiques |
| `src/analyze.js` | Extraction par Claude et extracteur local |
| `src/transcribe.js` | Client de l'API de transcription |
| `src/store.js` | Stockage JSON des notes |
| `public/recorder.js` | Capture et mixage audio, segmentation, reconnaissance du navigateur |
| `public/app.js` | Interface |
| `public/export.js` | Définition des tableaux, export Markdown/CSV |

## Tests

```bash
npm test
```

## Confidentialité

Prévenez les participants avant d'enregistrer : l'enregistrement d'une conversation sans le consentement des personnes est illégal dans de nombreux pays, dont la France. L'audio est envoyé au fournisseur de transcription configuré, et le texte à Anthropic si l'analyse Claude est activée.
