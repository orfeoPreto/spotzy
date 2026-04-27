<!-- DRAFT — needs human review by Duke -->

# Spotzy — Testgids voor verhuurders

**Uw naam:** {{testerName}}
**Uw login:** {{accountEmail}}
**Uw wachtwoord:** {{accountPassword}}
**Site:** {{loginUrl}}
**Benodigde tijd:** ongeveer 45 minuten
**Vragen?** {{contactEmail}}

---

## Voordat u begint

U heeft nodig: een telefoon of computer, uw inloggegevens hierboven, de testkaart `{{stripeTestCard}}`, en één foto van een parkeerplaats (of een willekeurige buitenruimte — het hoeft niet echt te zijn). U laadt die op als testfoto voor uw aanbieding.

Voor de stap waarbij u uw uitbetalingsrekening instelt, gebruikt u dit testbankrekeningnummer: `{{stripeTestIban}}`

Wanneer de site om een kaart vraagt, vul dan in: `{{stripeTestCard}}`, vervaldatum `12/26`, CVC `123`, postcode `1000`.

---

## Taak 1 — Uw account aanmaken

**Doel:** Registreren en uw e-mailadres bevestigen.

Ga naar {{loginUrl}} en registreer u met het e-mailadres en wachtwoord hierboven.

Controleer het volgende:
- Is er een bevestigingsmail in uw inbox gearriveerd?
- Was die e-mail in het Nederlands?
- Was het welkomstscherm na de bevestiging duidelijk?

---

## Taak 2 — Verhuurder worden

**Doel:** Uw uitbetalingsrekening instellen zodat u betalingen kunt ontvangen.

Zoek via uw dashboard de optie om verhuurder te worden. U wordt doorgeleid naar een instelprocedure voor uitbetalingen.

Wanneer om uw bankrekening wordt gevraagd, gebruik dan: `{{stripeTestIban}}`

Controleer het volgende:
- Was de instelprocedure duidelijk te volgen?
- Was een deel van het formulier verwarrend?
- Toonde uw dashboard na afloop dat u nu verhuurder bent?

---

## Taak 3 — Uw eerste aanbieding publiceren

**Doel:** Een volledige aanbieding voor een parkeerplaats aanmaken en publiceren.

Maak via uw dashboard een nieuwe aanbieding. Gebruik een adres naar keuze (een echt Brusselse adres werkt goed, bijv. Wetstraat 16, 1000 Brussel). Stel een prijs in, upload uw testfoto en publiceer.

Controleer het volgende:
- Was het duidelijk hoe u de prijs moest instellen? Toonde de voorvertoning wat een huurder zou betalen, inclusief kosten?
- Is uw foto zonder problemen geüpload?
- Stond de adresspeld op de kaart op de juiste plek?
- Kon u uw aanbieding terugvinden door op de site te zoeken na de publicatie?

---

## Taak 4 — Uw eigen aanbieding boeken als huurder

**Doel:** Bekijken hoe de boekingservaring er van de andere kant uitziet.

Open een privé- of incognitovenster in uw browser, of gebruik een tweede apparaat. Ga naar {{loginUrl}} en log in met uw tweede testaccount. Zoek de aanbieding die u zojuist heeft aangemaakt en reserveer die met de testkaart.

**Tweede account:** Gebruik een andere browser of een profiel waarbij u niet ingelogd bent. Neem contact met ons op als u een tweede login nodig heeft.

Controleer het volgende:
- Klopte de prijs die aan de huurder werd getoond met het tarief dat u had ingesteld?
- Verliep het afrekenen soepel?
- Hebben beide accounts een bevestiging ontvangen?

---

## Taak 5 — Het ontvangstbewijs lezen als huurder

**Doel:** Controleren of de betalingsspecificatie duidelijk is.

Log in als huurder en zoek het ontvangstbewijs of de boekingsbevestiging.

Controleer het volgende:
- Waren de afzonderlijke regels (uw tarief, eventuele belastingen, eventuele servicekosten) gemakkelijk te lezen?
- Waren de totalen duidelijk?
- Was er iets op het ontvangstbewijs dat verwarrend was?

---

## Taak 6 — Annuleren als huurder, controleren als verhuurder

**Doel:** De volledige annuleringsprocedure van beide kanten bekijken.

Annuleer de reservering terwijl u ingelogd bent als huurder. Schakel daarna terug naar uw verhuurderaccount.

Controleer het volgende:
- Heeft de huurder een duidelijk bericht over de annulering ontvangen?
- Heeft de huurder een annuleringsmail ontvangen?
- Is uw dashboard als verhuurder bijgewerkt om de annulering te tonen?
- Was er een bericht over de terugbetaling?

---

## Taak 7 — Probeer het te laten crashen

**Doel:** Iets vinden wat de vorige taken niet hebben gedekt.

Besteed 10 minuten aan onverwachte dingen: probeer een prijs van €0 in te stellen, upload een bestand dat geen foto is, maak een aanbieding zonder beschrijving, probeer uw aanbieding te bewerken terwijl er een actieve reservering is, wissel van taal halverwege. Probeer alles wat in u opkomt.

Noteer wat u heeft geprobeerd en wat er is gebeurd — ook als er niets mis ging.

---

## Hoe u uw bevindingen rapporteert

Vul het meldingsformulier in voor alles wat verkeerd, verwarrend of ontbrekend leek:

**{{defectFormUrl}}**

Als het formulier niet beschikbaar is, stuur uw aantekeningen dan per e-mail naar {{contactEmail}}.

Één formulier per probleem heeft de voorkeur, maar één e-mail met een lijst is ook prima.

Bedankt voor uw tijd — dit helpt ons echt iets beters te bouwen.
