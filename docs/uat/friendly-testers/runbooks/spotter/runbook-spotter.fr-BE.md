<!-- DRAFT — needs human review by Duke -->

# Spotzy — Guide de test Spotter

**Votre nom :** {{testerName}}
**Votre identifiant :** {{accountEmail}}
**Votre mot de passe :** {{accountPassword}}
**Site :** {{loginUrl}}
**Durée estimée :** environ 30 minutes
**Questions ?** {{contactEmail}}

---

## Avant de commencer

Vous aurez besoin de : un téléphone ou un ordinateur, vos identifiants ci-dessus, et le numéro de carte de test `{{stripeTestCard}}`. Cette carte est fournie par notre partenaire de paiement pour les tests — aucune somme réelle ne sera débitée.

Lorsque le site vous demande une carte, saisissez : `{{stripeTestCard}}`, date d'expiration `12/26`, code CVC `123`, code postal `1000`.

---

## Tâche 1 — Créer votre compte

**Objectif :** S'inscrire et confirmer votre adresse e-mail.

Rendez-vous sur {{loginUrl}} et inscrivez-vous avec l'adresse e-mail et le mot de passe indiqués ci-dessus.

Vérifiez :
- Un e-mail de confirmation est-il arrivé dans votre boîte de réception ?
- Cet e-mail était-il en français ?
- Après confirmation, l'écran d'accueil était-il clair ? Y avait-il quelque chose de déroutant ?

---

## Tâche 2 — Trouver une place de parking

**Objectif :** Rechercher une place et examiner le prix.

Cherchez une place de parking près de la Grand-Place à Bruxelles pour demain à 14 h, pour 2 heures.

Vérifiez :
- La carte était-elle facile à utiliser ?
- Les résultats de recherche affichaient-ils les prix clairement ?
- En cliquant sur une place, pouviez-vous voir le montant total que vous paieriez — frais de service inclus ?
- L'adresse et la description de la place étaient-elles faciles à comprendre ?

---

## Tâche 3 — Effectuer une réservation

**Objectif :** Finaliser une réservation de bout en bout.

Choisissez l'une des places trouvées et réservez-la avec la carte de test `{{stripeTestCard}}`.

Vérifiez :
- Le montant affiché lors du paiement correspondait-il à celui de la page d'annonce ?
- Avez-vous obtenu une page de confirmation après le paiement ?
- Un e-mail de confirmation est-il arrivé ? En français ?
- Y a-t-il un moyen d'ajouter la réservation à votre agenda ?

---

## Tâche 4 — Annuler la réservation

**Objectif :** Annuler proprement et vérifier le message de remboursement.

Rendez-vous sur votre tableau de bord et annulez la réservation que vous venez d'effectuer.

Vérifiez :
- L'option d'annulation était-elle facile à trouver ?
- Le site vous a-t-il indiqué si vous seriez remboursé(e) ?
- Un e-mail d'annulation est-il arrivé ? En français ?

---

## Tâche 5 — Réserver à nouveau et envoyer un message

**Objectif :** Tester la messagerie.

Cherchez une place disponible dans au moins 25 heures (après-demain ou plus tard). Réservez-la. Envoyez ensuite un court message à l'hôte — par exemple : « Bonjour, où se trouve exactement l'entrée ? »

Vérifiez :
- Le message s'est-il envoyé sans erreur ?
- Si vous avez reçu une réponse, était-elle en français ?
- La conversation était-elle facile à suivre ?

---

## Tâche 6 — Ouvrir le site sur votre téléphone

**Objectif :** Vérifier que tout fonctionne sur un petit écran.

Si vous êtes sur ordinateur, ouvrez {{loginUrl}} sur votre téléphone. Si vous êtes déjà sur téléphone, essayez de faire pivoter l'écran en mode paysage puis revenez en portrait.

Vérifiez :
- Le site était-il facile à lire sur un petit écran ?
- La carte répondait-elle bien au toucher ?
- Les boutons étaient-ils faciles à appuyer avec le pouce ?

Si vous n'avez qu'un seul appareil, passez cette tâche — notez-le simplement.

---

## Tâche 7 — Essayez de tout casser

**Objectif :** Trouver ce que les tâches précédentes n'ont pas couvert.

Passez 10 minutes à faire des choses inattendues : entrez une adresse sans sens dans la recherche, essayez de réserver une place dans le passé, tapez un très long message, changez de langue en cours de réservation, utilisez une connexion lente si possible. Essayez tout ce qui vous vient à l'esprit.

Notez ce que vous avez essayé et ce qui s'est passé — même si rien n'a planté. « J'ai essayé X et tout allait bien » est une information utile.

---

## Comment signaler ce que vous avez trouvé

Remplissez le formulaire de signalement pour tout ce qui vous a semblé incorrect, déroutant ou manquant :

**{{defectFormUrl}}**

Si le formulaire n'est pas disponible, envoyez vos notes par e-mail à {{contactEmail}}.

Un formulaire par problème est idéal, mais si vous préférez envoyer un seul e-mail avec une liste, c'est également parfait.

Merci pour votre temps — cela nous aide vraiment à construire quelque chose de mieux.
