<!-- DRAFT — needs human review by Duke -->

# Spotzy — Guide de test pour les hôtes

**Votre nom :** {{testerName}}
**Votre identifiant :** {{accountEmail}}
**Votre mot de passe :** {{accountPassword}}
**Site :** {{loginUrl}}
**Durée estimée :** environ 45 minutes
**Questions ?** {{contactEmail}}

---

## Avant de commencer

Vous aurez besoin de : un téléphone ou un ordinateur, vos identifiants ci-dessus, la carte de test `{{stripeTestCard}}`, et une photo d'une place de parking (ou de n'importe quel espace extérieur — pas besoin que ce soit réel). Vous la téléchargerez comme photo d'annonce test.

Pour l'étape de configuration des paiements, vous utiliserez ce numéro de compte bancaire test : `{{stripeTestIban}}`

Lorsque le site vous demande une carte, saisissez : `{{stripeTestCard}}`, date d'expiration `12/26`, code CVC `123`, code postal `1000`.

---

## Tâche 1 — Créer votre compte

**Objectif :** S'inscrire et confirmer votre adresse e-mail.

Rendez-vous sur {{loginUrl}} et inscrivez-vous avec l'adresse e-mail et le mot de passe indiqués ci-dessus.

Vérifiez :
- Un e-mail de confirmation est-il arrivé dans votre boîte de réception ?
- Cet e-mail était-il en français ?
- Après confirmation, l'écran d'accueil était-il clair ?

---

## Tâche 2 — Devenir hôte

**Objectif :** Configurer votre compte de paiement afin de pouvoir recevoir des versements.

Depuis votre tableau de bord, trouvez l'option pour devenir hôte. Vous serez guidé(e) vers un processus de configuration des paiements.

Lorsque votre compte bancaire vous est demandé, utilisez : `{{stripeTestIban}}`

Vérifiez :
- Le processus de configuration était-il facile à suivre ?
- Une partie du formulaire vous a-t-elle semblé déroutante ?
- Après avoir terminé, votre tableau de bord indiquait-il que vous êtes désormais hôte ?

---

## Tâche 3 — Publier votre première annonce

**Objectif :** Créer une annonce de place de parking complète et la publier.

Depuis votre tableau de bord, créez une nouvelle annonce. Utilisez l'adresse de votre choix (une vraie adresse bruxelloise convient bien, par exemple Rue de la Loi 16, 1000 Bruxelles). Fixez un prix, téléchargez votre photo test et publiez.

Vérifiez :
- Était-il clair comment fixer le prix ? L'aperçu indiquait-il ce qu'un locataire paierait, frais inclus ?
- Votre photo s'est-elle téléchargée sans problème ?
- L'épingle d'adresse sur la carte était-elle au bon endroit ?
- Après la publication, pouviez-vous retrouver votre annonce en effectuant une recherche sur le site ?

---

## Tâche 4 — Réserver votre propre annonce en tant que locataire

**Objectif :** Voir à quoi ressemble l'expérience de réservation de l'autre côté.

Ouvrez une fenêtre de navigation privée ou incognito, ou utilisez un second appareil. Rendez-vous sur {{loginUrl}} et connectez-vous avec votre second compte test. Cherchez l'annonce que vous venez de créer et réservez-la avec la carte de test.

**Second compte :** Utilisez un autre navigateur ou profil où vous n'êtes pas connecté(e). Contactez-nous si vous avez besoin d'un second identifiant.

Vérifiez :
- Le prix affiché au locataire correspondait-il à ce que vous avez fixé comme tarif ?
- Le paiement s'est-il déroulé simplement ?
- Les deux comptes ont-ils reçu une confirmation ?

---

## Tâche 5 — Lire le reçu en tant que locataire

**Objectif :** Vérifier que le détail du paiement est clair.

Connecté(e) en tant que locataire, trouvez le reçu ou la confirmation de réservation.

Vérifiez :
- Les lignes individuelles (votre tarif, les éventuelles taxes, les éventuels frais de service) étaient-elles faciles à lire ?
- Les totaux étaient-ils clairs ?
- Y avait-il quelque chose de déroutant sur le reçu ?

---

## Tâche 6 — Annuler en tant que locataire, vérifier en tant qu'hôte

**Objectif :** Voir le processus d'annulation complet des deux côtés.

Annulez la réservation en étant connecté(e) en tant que locataire. Puis revenez sur votre compte hôte.

Vérifiez :
- Le locataire a-t-il reçu un message clair concernant l'annulation ?
- Le locataire a-t-il reçu un e-mail d'annulation ?
- En tant qu'hôte, votre tableau de bord s'est-il mis à jour pour afficher l'annulation ?
- Y avait-il un message concernant le remboursement ?

---

## Tâche 7 — Essayez de tout casser

**Objectif :** Trouver ce que les tâches précédentes n'ont pas couvert.

Passez 10 minutes à faire des choses inattendues : essayez de fixer un prix de 0 €, téléchargez un fichier qui n'est pas une photo, créez une annonce sans description, essayez de modifier votre annonce alors qu'une réservation est active, changez de langue en cours de route. Essayez tout ce qui vous vient à l'esprit.

Notez ce que vous avez essayé et ce qui s'est passé — même si rien n'a planté.

---

## Comment signaler ce que vous avez trouvé

Remplissez le formulaire de signalement pour tout ce qui vous a semblé incorrect, déroutant ou manquant :

**{{defectFormUrl}}**

Si le formulaire n'est pas disponible, envoyez vos notes par e-mail à {{contactEmail}}.

Un formulaire par problème est idéal, mais un seul e-mail avec une liste convient tout aussi bien.

Merci pour votre temps — cela nous aide vraiment à construire quelque chose de mieux.
