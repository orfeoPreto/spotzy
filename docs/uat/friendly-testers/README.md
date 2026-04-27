# Friendly Tester Onboarding Pack — Operator Guide

This folder contains everything you and the co-founder need to onboard the 3–5 external friendly testers for Spotzy's pre-launch UAT round (Phase 7).

---

## What's in this folder

```
invitation-email/          One invitation email per locale (en, fr-BE, nl-BE)
runbooks/spotter/          One-page task guide for Spotter testers, per locale
runbooks/host/             One-page task guide for Host testers, per locale
defect-form/               Defect report template, per locale
customise.ts               CLI script to generate a personalised pack for each tester
```

---

## Before you start

1. **Seed the UAT accounts.** Run `npm run seed:uat` (Session 31). This produces `scripts/uat-manifest.json`, a list of test accounts (email, password, persona, locale).

2. **Create the Google Form.** Open `defect-form/defect-form-template.en.md` and use the field list there to build the form in your Google account. Copy the public form URL — you'll need it in step 3.

3. **Set environment variables.** The customise script reads two env vars:
   ```
   FRIENDLY_DEFECT_FORM_URL=https://forms.gle/your-form-id
   FRIENDLY_CONTACT_EMAIL=hello@spotzy.be
   FRIENDLY_TESTER_CREDIT_AMOUNT=30   # optional, defaults to 30
   ```

4. **Review fr-BE and nl-BE drafts.** Every non-English file in this folder carries a `<!-- DRAFT — needs human review by Duke -->` header. Review each one, make any edits, and remove the header line when you're happy. The pack is not ready to send until all draft headers are gone.

---

## Generating a personalised pack

Run this command for each tester:

```bash
npm run friendly-pack:build "Marie Dubois" spotter fr-BE
```

Arguments: `"<Full Name>"` `<persona>` `<locale>`

- `persona` is either `spotter` or `host`
- `locale` is one of `en`, `fr-BE`, `nl-BE`

The script picks an unused UAT account matching the persona and locale, marks it as assigned, and writes the tester's personalised pack to:

```
outputs/friendly-pack-marie-dubois/
├── README.md
├── invitation-email.md
├── runbook.md
└── defect-form-template.md
```

Re-running for the same tester name reuses the same account — the script is idempotent.

If there are no unused accounts left for the requested persona + locale, the script exits with an error and tells you to re-seed or assign manually.

---

## Sending the pack

1. Open `outputs/friendly-pack-{name}/invitation-email.md`. Copy the body into an email. Send from the team address.
2. Attach (or paste) the `runbook.md` content into the same email or a follow-up.
3. Include a link to the defect form (it's also embedded in the runbook).
4. The account credentials are already filled in the runbook. Double-check them before sending.

---

## Tracking assignments

`scripts/uat-friendly-assignments.json` is updated automatically by the customise script. It records which account was assigned to which tester and when. Check this file if a tester says their login doesn't work.

---

## Tester profile

Friendly testers are people the team knows personally — neighbours, family, friends of the co-founder. They are:

- Not technical
- Testing on their own devices (phones and laptops)
- Available for roughly 30–45 minutes
- Being thanked with €30 in launch credits

Do not ask them to install anything. Do not ask them to open the browser console. Do not ask them to write a formal report — the defect form is intentionally informal.

---

## Phase 7 schedule

Phase 7 runs for 5 days. Suggested timing:

| Day | Action |
|-----|--------|
| 1   | Send packs to all testers |
| 2–3 | Testers complete their sessions |
| 4   | Collect defect forms, triage in the issue tracker |
| 5   | Fix P0/P1 regressions; close the round |

---

## Open question (for Duke)

Runbook task 6 (Spotter) asks testers to open the site on their phone. Some testers may only have one device. The default assumption is that this is fine — they skip task 6 and we note the gap in mobile coverage. If you'd prefer to send a separate mobile-only pack or loan a test phone, flag this before sending invitations.
