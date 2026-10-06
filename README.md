# Sperme intelligent

Simulation dans le navigateur : des spermatozoïdes doivent atteindre l'ovule en évitant des obstacles. Personne ne leur programme de trajet : chacun est un agent doté d'un petit réseau de neurones, et ces réseaux s'améliorent de génération en génération par sélection naturelle.

## Lancer

Ouvrez `sperme-intelligent/index.html` dans un navigateur, sur ordinateur ou téléphone. Un seul fichier, aucune installation, aucune connexion requise.

## Commandes

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

## Fonctionnement

1. **Perception** : à chaque instant, l'agent mesure la distance au mur le plus proche dans 5 directions, l'angle et la distance de l'ovule, et sa propre vitesse (9 entrées).
2. **Décision** : un réseau 9 → 8 → 2 (activation `tanh`) en déduit de combien tourner et accélérer. Toucher un mur ou un bord tue l'agent.
3. **Score** : plus l'agent s'est approché de l'ovule, meilleur il est ; l'atteindre rapporte bien plus, d'autant plus s'il arrive vite ; mourir contre un mur divise le score.
4. **Évolution** : les 2 meilleurs passent intacts à la génération suivante. Les autres naissent de deux parents choisis par tournoi : chaque poids vient de l'un ou l'autre, puis subit éventuellement une mutation gaussienne.

Les poids ne sont jamais ajustés par rétropropagation : seule l'évolution les modifie (neuroévolution).

Ordre de grandeur mesuré (150 agents, terrain par défaut) : environ 75 à 90 % d'arrivées après une centaine de générations avec l'ovule fixe, et environ 75 % en moyenne avec l'ovule mobile, ce qui montre que les agents ont appris une stratégie générale plutôt qu'un trajet.
