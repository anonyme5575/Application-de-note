# Sperme intelligent

Simulation dans le navigateur : des spermatozoïdes doivent atteindre l'ovule en évitant des obstacles. Personne ne leur programme de trajet : chacun est un agent doté d'un petit réseau de neurones, et ces réseaux s'améliorent de génération en génération par sélection naturelle.

## Lancer

Ouvrez `sperme-intelligent/index.html` dans un navigateur, sur ordinateur ou téléphone. Un seul fichier, aucune installation, aucune connexion requise.

## Installer sur téléphone

Le jeu s'installe comme une application depuis le navigateur (application web progressive) : icône sur l'écran d'accueil, plein écran, fonctionne hors connexion. Aucun store nécessaire.

- **Android** (Chrome, Edge, Samsung Internet) : menu ⚙ du jeu › **📲 Installer**, ou menu du navigateur › **Installer l'application**.
- **iPhone / iPad** : ouvrez le site dans **Safari** › bouton **Partager** › **Sur l'écran d'accueil** › **Ajouter**. Le bouton **📲 Installer** du jeu rappelle ces étapes, car Safari ne permet pas à un site de déclencher l'installation lui-même.

L'installation nécessite le site en ligne (HTTPS, par exemple via Vercel) : elle ne fonctionne pas en ouvrant le fichier depuis le disque.

## Commandes

| Action | Effet |
|---|---|
| Glisser sur le terrain | Dessine un obstacle |
| Clic droit ou appui long | Déplace l'ovule |
| Population | Nombre d'agents par génération (20 à 400) |
| Mutation | Probabilité qu'un poids du réseau soit modifié au hasard à la naissance (4 % par défaut) |
| Vitesse | Accélère la simulation (×1 à ×30) |
| Terrain | Classique, Piège en U, Labyrinthe, Vide, ou Aléatoire (un nouveau terrain à chaque génération, pour apprendre à se débrouiller partout) |
| ⚡ Turbo | Calcule autant de générations que l'appareil le permet |
| Ovule mobile | Place l'ovule au hasard à chaque génération |
| Effacer obstacles / Repartir de zéro | Retire les murs / efface les cerveaux appris et repart du hasard |

Les cerveaux appris sont gardés dans le navigateur : en revenant sur la page, l'entraînement reprend où il s'était arrêté.

Le champion de la génération est en jaune, avec ses capteurs visibles. Le panneau **Cerveau du champion** affiche son réseau en direct (bleu : positif, rouge : négatif), et la courbe verte le pourcentage d'agents arrivés à chaque génération.

## Fonctionnement

1. **Perception** : à chaque instant, l'agent mesure la distance au premier obstacle dans 7 directions, la direction et la distance de l'ovule, s'il voit l'ovule ou s'il est caché par un mur, et sa propre vitesse (12 entrées).
2. **Mémoire et décision** : un réseau de neurones récurrent (12 entrées + 10 neurones de mémoire → 10 neurones → 2 sorties, activation `tanh`) en déduit de combien tourner et accélérer. Les neurones cachés sont réinjectés au pas suivant : l'agent se souvient de ce qu'il vient de faire et peut suivre un mur ou insister dans un contournement. Toucher un mur ou un bord le tue.
3. **Score** : la distance qui lui reste à parcourir **en contournant les murs** (plus court chemin réel, calculé sur une grille de 8 px), et non la distance à vol d'oiseau. Foncer droit dans un mur ne rapporte rien ; trouver le passage, si. Atteindre l'ovule rapporte bien plus, d'autant plus vite. Mourir divise le score par deux. Les agents ne voient pas cette carte : elle sert uniquement à les noter.
4. **Évolution** : les 3 meilleurs passent intacts à la génération suivante. Les autres naissent de deux parents choisis par tournoi : chaque poids vient de l'un ou l'autre, puis subit éventuellement une mutation gaussienne.

Les poids ne sont jamais ajustés par rétropropagation : seule l'évolution les modifie (neuroévolution).

### Résultats mesurés

150 agents, 60 générations, moyenne de 3 essais ; pourcentage d'agents arrivés sur les 10 dernières générations :

| Terrain | Version précédente | Version actuelle |
|---|---|---|
| Classique | 77 % | 77 % |
| Piège en U | 64 % | 65 % |
| Labyrinthe | 35 % (un essai bloqué à 2 %) | 66 % (aucun échec) |

Sur un terrain jamais vu, une population entraînée sur un seul terrain réussit 0 à 5 % dès la première génération ; entraînée 100 générations sur des terrains aléatoires, 12 à 25 %. Le pourcentage d'arrivées plafonne sous 100 % parce que chaque génération contient des enfants mutés qui explorent.
