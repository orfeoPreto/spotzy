# Localization Spec Addendum — Session 28b changes

## Companion to `spotzy_localization_v2.docx` and `28b_fee_exclusive_pricing_and_vat.md`

> This addendum lists every change to the Spotzy localization spec (`spotzy_localization_v2.docx`) that is required by the Session 28b corrective supplement. It does NOT supersede the localization spec — it amends it. When the next major revision of the localization spec is produced, these changes should be folded in.
>
> Apply order: (1) implement Session 28b, (2) add the new translation keys and email templates listed below to the `en/` source files, (3) run the i18n translation script from Session 30 to generate fr-BE and nl-BE versions, (4) deploy.

---

## 1. New translation keys

The new keys go into the existing `en/` namespace files. The Session 30 translation script will pick them up as missing keys on the next run and translate them to fr-BE and nl-BE.

### 1.1 `frontend/src/locales/en/pricing.yaml` — add the following

```yaml
hostNetLabel: "Your hourly rate (you keep this amount)"
hostNetHelperText: "This is what you receive per hour, before Spotzy's service fee and any applicable VAT."

earningsLadder:
  title: "Your earnings ladder (what you receive)"
  hourly: "Hourly  {rate}"
  daily: "Daily   {rate}/day  ({perHour}/h)"
  weekly: "Weekly  {rate}/week ({perHour}/h)"
  monthly: "Monthly {rate}/month ({perHour}/h)"

spotterPreview:
  title: "What the Spotter sees (gross with fees and VAT)"
  hourly: "Hourly  {grossRate}/h    (you keep {netRate})"
  daily: "Daily   {grossRate}/day  (you keep {netRate})"
  weekly: "Weekly  {grossRate}/week"
  monthly: "Monthly {grossRate}/month"
  note: "Spotzy adds a {feePct, number, ::percent} service fee + {vatPct, number, ::percent} VAT on its fee."

vatStatus:
  current: "Your VAT status: {status}"
  exempt: "Not VAT-registered (small enterprise)"
  registered: "VAT-registered ({vatNumber}) — {hostVatPct, number, ::percent} VAT will be added to your prices"
  changeLink: "Change VAT status →"

listingCard:
  fromPrice: "From {price}"
  inclFeesAndVat: "(incl. fees & VAT)"
```

### 1.2 `frontend/src/locales/en/booking.yaml` — add the following

```yaml
breakdown:
  tierLine: "{tierLabel} × {tierUnits}"
  tierLineSubtitle: "({tierRate} × {tierUnits})"
  hostVat: "Host VAT {rate, number, ::percent}"
  serviceFee: "Service fee"
  vatOnServiceFee: "VAT {rate, number, ::percent}"
  total: "Total"

confirmAndPay: "Confirm and pay {amount}"
allAmountsIncludeFeesAndVat: "All amounts include service fees and applicable VAT."

cheaperAlternative:
  shorter: "Booking {hours} hours instead of {currentHours} saves {savings}"
  longer: "Booking {hours} hours instead of {currentHours} saves {savings}"
  adjustDates: "Adjust dates"
```

### 1.3 `frontend/src/locales/en/errors.yaml` — add the following 7 error codes

```yaml
LEGACY_PRICING_FIELD_REJECTED: "The pricing field {field} has been renamed to {expectedField}. Please update your request."
VAT_NUMBER_REQUIRED: "A Belgian VAT number is required to register as VAT-registered."
VAT_NUMBER_INVALID_FORMAT: "Invalid Belgian VAT number format. Expected: BE0 followed by 9 digits."
VAT_NUMBER_INVALID_CHECKSUM: "The Belgian VAT number checksum is invalid. Please check for typos."
VAT_STATUS_REQUIRED_FOR_SPOT_MANAGER: "You must declare your VAT status to become a Spot Manager."
STRIPE_AMOUNT_MISMATCH: "The payment amount does not match the booking total. Please try again or contact support."
BOOKING_MISSING_PRICE_BREAKDOWN: "This booking is missing pricing information. Contact support to resolve."
```

### 1.4 `frontend/src/locales/en/spot_manager.yaml` — add the VAT step section

```yaml
commitmentGate:
  vatStep:
    title: "VAT status"
    description: "Tell us about your VAT registration status. This determines how prices are displayed to Spotters and Block Spotters."
    optionExempt: "I am NOT VAT-registered (small enterprise franchise)"
    optionExemptHelp: "Most casual hosts choose this option. The Belgian small enterprise threshold is €25,000 in annual revenue. If you exceed this threshold, you must register for VAT."
    optionRegistered: "I am VAT-registered"
    optionRegisteredHelp: "If you are operating commercially and have a Belgian VAT number, select this option. The platform will collect the appropriate {rate, number, ::percent} VAT on your behalf."
    vatNumberLabel: "Belgian VAT number"
    vatNumberPlaceholder: "BE0123456749"
    vatNumberFormatHint: "Format: BE0 followed by 9 digits"
```

### 1.5 New file: `frontend/src/locales/en/vat_settings.yaml`

The `/account/vat-settings` page has its own namespace because the strings are not used elsewhere.

```yaml
pageTitle: "VAT settings"
currentStatus: "Current VAT status: {status}"

intro: "Belgian small enterprise franchise (vrijstellingsregeling / régime de la franchise) applies if your annual turnover from parking rental is below €25,000. Most casual hosts qualify."

updateSection:
  title: "Update your VAT status"
  optionExempt: "Not VAT-registered (small enterprise)"
  optionRegistered: "VAT-registered"
  vatNumberLabel: "Belgian VAT number"
  vatNumberPlaceholder: "BE0"
  vatNumberHint: "Format: BE0 followed by 9 digits (e.g. BE0123456749)"

warning:
  title: "Important"
  body: "Changing your VAT status applies to FUTURE listings and bookings only. Your existing listings will continue to display prices according to their original VAT status. To update prices on existing listings, you must edit each listing individually."

saveButton: "Save changes"
saveSuccess: "VAT status updated successfully. Future listings will use the new status."
```

This brings the namespace count from 23 to **24** in the localization spec §4.1. Update the namespace inventory table when the next localization spec revision is produced.

---

## 2. Email template updates

### 2.1 Three existing templates updated

**`booking-confirmed-{locale}`** — already exists from Session 04 but the body needs to be replaced with a breakdown table. The Handlebars conditional `{{#if hostVatRate}}` shows the host VAT line only for bookings against VAT-registered Hosts.

```handlebars
<table>
  <tr>
    <td>{{i18n 'booking.breakdown.tierLine' tierLabel=tierLabel tierUnits=tierUnits}}</td>
    <td>{{format hostNetTotal}}</td>
  </tr>
  {{#if hostVatRate}}
    <tr>
      <td>{{i18n 'booking.breakdown.hostVat' rate=hostVatRate}}</td>
      <td>{{format hostVatEur}}</td>
    </tr>
  {{/if}}
  <tr>
    <td>{{i18n 'booking.breakdown.serviceFee'}}</td>
    <td>{{format platformFeeEur}}</td>
  </tr>
  <tr>
    <td>{{i18n 'booking.breakdown.vatOnServiceFee' rate=platformFeeVatRate}}</td>
    <td>{{format platformFeeVatEur}}</td>
  </tr>
  <tr class="total">
    <td><strong>{{i18n 'booking.breakdown.total'}}</strong></td>
    <td><strong>{{format spotterGrossTotalEur}}</strong></td>
  </tr>
</table>
```

The Lambda sending the email passes the `priceBreakdown` snapshot from the booking record as the `TemplateData` payload. SES interpolates the values into the template and sends.

**`block-confirmation-{locale}`** — same treatment. Show the worst-case authorisation amount with the full breakdown including the host VAT line for VAT-registered pools.

**`block-settlement-{locale}`** — same treatment. Show the final settled breakdown using the snapshotted values from `BLOCKALLOC METADATA.priceBreakdown`.

### 2.2 New email template family

**`vat-status-changed-{locale}`** — sent by the new `user-vat-status-update` Lambda whenever the user changes their VAT status. Template body:

```
Subject: {{i18n 'email.vatStatusChanged.subject'}}

{{i18n 'email.vatStatusChanged.greeting' firstName=firstName}}

{{i18n 'email.vatStatusChanged.body' newStatus=newStatus oldStatus=oldStatus changedAt=changedAt}}

{{#if newStatus_isRegistered}}
  {{i18n 'email.vatStatusChanged.registeredDetails' vatNumber=vatNumber}}
{{/if}}

{{i18n 'email.vatStatusChanged.warning'}}

{{i18n 'email.vatStatusChanged.signoff'}}
```

The matching strings live in a new `email_vat_status.yaml` namespace (or extended `notifications.yaml`):

```yaml
email:
  vatStatusChanged:
    subject: "Your VAT status has been updated"
    greeting: "Hi {firstName},"
    body: "We've updated your Spotzy VAT status from {oldStatus} to {newStatus} on {changedAt}."
    registeredDetails: "Your registered Belgian VAT number is {vatNumber}. Spotzy will collect 21% VAT on parking rentals from this listing forward."
    warning: "Important: This change applies to FUTURE listings and bookings only. Your existing listings continue to display prices according to their original VAT status. To update prices on existing listings, edit each listing individually."
    signoff: "If you didn't make this change, contact support immediately."
```

This brings the email template family count from **29 to 30** and the total SES template count from **87 to 90** (30 families × 3 locales). Update the localization spec §4.3 table when the next revision is produced.

---

## 3. Localization spec section updates

The following localization spec sections need updates in the next revision:

### 3.1 §4.1 Frontend UI strings inventory

Update the namespace count from 23 to 24 (added `vat_settings`). The total approximate string count goes from ~1,680 to ~1,740 (the new keys add roughly 60 strings across the 4 updated namespaces and the new `vat_settings` namespace).

### 3.2 §4.3 System emails

Update the email template family count from 29 to 30. Add `vat-status-changed` to the table with the trigger "user-vat-status-update Lambda call". Update the SES template total: 30 families × 3 locales = 90 templates for v2.x launch.

### 3.3 §13.1 Cost model — Claude API for UI translation

The new keys add about 60 source strings × 2 target locales × ~$0.002 per string = ~$0.24 additional one-time translation cost. Negligible. Total launch cost budget unchanged at "under €20".

### 3.4 §13.5 Total v2.x launch budget table

Add a row for the optional legal adviser consultation on the BR-VAT01 wording (the legal basis citations in BR-PT01 and BR-VAT01 should ideally be reviewed by a Belgian commercial lawyer): €0–€200 one-time, optional. Total range: under €1,000 with all optional legal review included.

---

## 4. Glossary additions

Add to `frontend/src/locales/_glossary.yaml`:

```yaml
terms:
  Service fee:
    rule: translate
    fr-BE: Frais de service
    nl-BE: Servicekosten
    de-BE: Servicegebühr
    en: Service fee

  VAT:
    rule: translate
    fr-BE: TVA
    nl-BE: BTW
    de-BE: MwSt.
    en: VAT

  Host VAT:
    rule: translate
    fr-BE: TVA hôte
    nl-BE: BTW verhuurder
    de-BE: Vermieter-MwSt.
    en: Host VAT

  Net rate:
    rule: translate
    fr-BE: Tarif net
    nl-BE: Nettotarief
    de-BE: Nettorate
    en: Net rate

  Gross price:
    rule: translate
    fr-BE: Prix tout compris
    nl-BE: Totaalprijs
    de-BE: Bruttopreis
    en: Gross price
```

These terms are critical to translate consistently — "service fee" in particular has multiple plausible French translations ("frais de service" vs "frais de plateforme" vs "commission"); the glossary forces consistency.

---

## 5. Acceptance criteria for the localization side of 28b

When Session 28b is implemented, the localization-side acceptance is:

1. All new keys from §1 above are present in `en/` source files
2. Running `npm run i18n:translate` produces fr-BE and nl-BE translations for all new keys
3. The i18n linter passes with zero missing keys
4. The 3 updated email templates render correctly in en, fr-BE, and nl-BE for both EXEMPT and VAT_REGISTERED Host scenarios
5. The new `vat-status-changed` email template family has all 3 locale versions deployed to SES
6. The glossary additions are present and the linter does not flag glossary violations
7. UC-H01 pricing form, UC-S04 booking summary, UC-BS03 plan display, and `/account/vat-settings` page all render correctly in fr-BE and nl-BE with no English leaks
8. The Belgian currency formatting (`Intl.NumberFormat` with `fr-BE` and `nl-BE` locales) produces `1 234,56 €` for fr-BE and `€ 1.234,56` for nl-BE — verify on the booking summary screen with a 4-digit total

---

## 6. Open questions for the next localization spec revision

1. **Should `vat_settings` be a separate namespace or folded into `profile` or `gdpr`?** I chose separate because the strings are conceptually distinct and may grow as VAT support expands. Either choice is defensible.

2. **Translation of "régime de la franchise" / "vrijstellingsregeling" / "small enterprise franchise"**: these are the official names of the Belgian VAT exemption regime. The English version says "small enterprise franchise" which is a literal-but-awkward translation. Consider whether to keep the original-language terms in parentheses on every locale ("Not VAT-registered (régime de la franchise / vrijstellingsregeling / small enterprise franchise)") for legal clarity. This is a glossary-level decision.

3. **Number formatting for currency in email templates**: SES's Handlebars templates do not natively support `Intl.NumberFormat`. The Lambda sending the email must format the numbers BEFORE passing them as `TemplateData`. The Lambda needs locale awareness to format `57.60` as `"57,60 €"` for fr-BE and `"€ 57,60"` for nl-BE. This is a shared backend helper, not a translation-side concern, but worth flagging for the implementer.

4. **VAT rate display in user-facing strings**: should the rate be hardcoded as "21%" in the strings, or interpolated as `{rate, number, ::percent}` so it updates automatically if the Belgian rate ever changes? I chose interpolation for forward compatibility. This means the Lambda passing the template data must include `vatRate: 0.21` (as a number, not a formatted string) and let ICU format it. Verify this is correctly handled in all 3 updated email templates.
