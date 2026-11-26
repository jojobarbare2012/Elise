# 04 — Intelligence et raisonnement

> **Statut : brouillon v1, à valider.** Décisions D54 à D65 issues de la discussion de cadrage.
> Les passages marqués *[proposition]* sont des ajouts de Claude, à confirmer ou supprimer.

## 1. Modèles de langage

- Élise utilise **plusieurs modèles selon le besoin** : rapide pour le banal, plus puissant pour le difficile. *(D63)*
- L'architecture est **indépendante du fournisseur** : on doit pouvoir changer de modèle sans reconstruire l'application. À terme, un modèle local remplace les services externes. *(D18, document de passation §5)*
- Les données sensibles ne sont jamais envoyées à un modèle distant ; elles passent par un modèle local, même modeste. *(D48)* *[proposition : formulation de la conséquence de D48]*

## 2. Raisonnement

- **Questions simples :** réponse rapide. *(D61)*
- **Questions qui demandent de réfléchir :** elle te **prévient** qu'elle réfléchit plus longtemps. *(D61)*
- **Travail en parallèle :** elle peut travailler en arrière-plan pendant que je continue à discuter, puis me rend le résultat. La conversation n'est jamais bloquée par une tâche de fond. *(D62)*
- Elle explore des pistes indépendamment et mène des recherches en parallèle. *(document de passation §2.1)*

## 3. Mémoire

Deux niveaux distincts :

1. **Faits durables et structurés :** mes projets, mes préférences, ce que nous avons appris ensemble, mes habitudes. *(D54)*
2. **Souvenir des conversations :** une mémoire des discussions passées, « dans une certaine mesure ». Moins prioritaire que le premier niveau. *(D55)*

Règles de gestion :

- **Oubli sur demande**, déjà présent dans la V0. *(D56)*
- **Tri et actualisation autonomes :** si un nouveau souvenir contredit un ancien, elle met l'information à jour. *(D57)*
- **Trace de l'ancien :** l'ancien souvenir est conservé comme historique et distingué de l'information actuelle. *(D59)*
- **Cas ambigus :** elle me demande avant d'actualiser. *(D60)*
- **Mises à jour silencieuses**, sauf pour ce qui est vraiment important : elle me le dit, voire me demande confirmation. *(D58)*

## 4. Gestion du contexte

Le contexte me suit d'un appareil à l'autre (chapitre 03, D45). Le point central qui le garde est décrit au chapitre 08.

## 5. Collaboration intellectuelle

Le comportement de contradiction, de pédagogie et de rigueur est défini aux chapitres 01 et 02 (D2, D4, D22 à D24, D36, D37).

## 6. Budget

- **20 € par mois maximum**, en plus de l'abonnement Claude Pro. *(D64)*
- **Priorité de budget :** la qualité de la voix est protégée en dernier. En cas de budget insuffisant, la puissance du raisonnement et la disponibilité permanente cèdent d'abord. *(D65)*
- Piste à étudier au chapitre 08 : un petit serveur loué (cœur d'Élise), des API pour le raisonnement et la voix, mon PC pour les modèles locaux, puis la machine à domicile. *[proposition]*

## 7. Points ouverts

| Point | Chapitre |
|---|---|
| Ce qu'Élise ne doit jamais retenir ; confidentialité des proches | 09 |
| Définition d'une « source fiable » selon le domaine | 04 (à reprendre) |
| Peut-on utiliser l'abonnement Claude Pro pour Élise, ou faut-il l'API ? (à vérifier dans la documentation officielle) | 08 |
| Séparation entre ce qui est stocké sur le serveur loué et ce qui reste chez moi | 08, 09 |
| Arbitrage du budget entre raisonnement, voix et disponibilité | 08 |
