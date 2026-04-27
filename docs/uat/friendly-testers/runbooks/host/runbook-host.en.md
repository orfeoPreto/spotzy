# Spotzy — Host Testing Guide

**Your name:** {{testerName}}
**Your login:** {{accountEmail}}
**Your password:** {{accountPassword}}
**Site:** {{loginUrl}}
**Time needed:** about 45 minutes
**Questions?** {{contactEmail}}

---

## Before you start

You'll need: a phone or computer, your login details above, the test card `{{stripeTestCard}}`, and one photo of any parking spot (or any outdoor space — it doesn't have to be real). You'll upload it as a test listing photo.

For the payout setup step, you'll use this test bank account number: `{{stripeTestIban}}`

When the site asks for a card, enter: `{{stripeTestCard}}`, expiry `12/26`, CVC `123`, postcode `1000`.

---

## Task 1 — Create your account

**Goal:** Sign up and confirm your email.

Go to {{loginUrl}} and sign up using the email and password above.

Check these:
- Did a confirmation email arrive in your inbox?
- Was the email in your language?
- After confirming, did the welcome screen make sense?

---

## Task 2 — Become a Host

**Goal:** Set up your payout account so you can receive payments.

From your dashboard, find the option to become a Host. You'll be taken to a payout setup flow.

When asked for your bank account, use: `{{stripeTestIban}}`

Check these:
- Was the setup process clear to follow?
- Did any part of the form feel confusing?
- After finishing, did your dashboard show that you're now a Host?

---

## Task 3 — Publish your first listing

**Goal:** Create a complete parking spot listing and publish it.

From your dashboard, create a new listing. Use any address you like (a real Brussels address works well, e.g. Rue de la Loi 16, 1000 Brussels). Set a price, upload your test photo, and publish.

Check these:
- Was it clear how to set the price? Did the preview show what a renter would pay, including fees?
- Did your photo upload without problems?
- Was the address pin on the map in the right place?
- After publishing, could you find your listing by searching on the site?

---

## Task 4 — Book your own listing as a renter

**Goal:** See what the booking experience looks like from the other side.

Open a private/incognito browser window, or use a second device. Go to {{loginUrl}} and log in with your second test account (details below). Search for the listing you just created and book it using the test card.

**Second account:** Use `{{accountEmail}}` with the suffix `.2` replaced — or use another browser profile where you're not logged in. Ask us if you need a second login.

Check these:
- Did the price shown to the renter match what you set as your rate?
- Was the checkout straightforward?
- Did both accounts receive a confirmation?

---

## Task 5 — Read the receipt as the renter

**Goal:** Check that the payment breakdown is clear.

While logged in as the renter, find the booking receipt or confirmation.

Check these:
- Were the individual line items (your rate, any taxes, any service fees) easy to read?
- Did the totals add up clearly?
- Was anything on the receipt confusing?

---

## Task 6 — Cancel as the renter, check as the host

**Goal:** See the full cancellation flow from both sides.

Cancel the booking while logged in as the renter. Then switch back to your host account.

Check these:
- Did the renter see a clear message about the cancellation?
- Did the renter get a cancellation email?
- As the host, did your dashboard update to show the cancellation?
- Was there any message about the refund?

---

## Task 7 — Try to break it

**Goal:** Find anything the tasks above didn't cover.

Spend 10 minutes doing unexpected things: try setting a price of €0, upload a file that isn't a photo, create a listing with no description, try to edit your listing while there's an active booking, switch languages mid-way. Try anything that comes to mind.

Write down what you tried and what happened — even if nothing broke.

---

## How to report what you found

Please fill in the defect form for anything that seemed wrong, confusing, or missing:

**{{defectFormUrl}}**

If the form isn't available, email your notes to {{contactEmail}}.

One form per issue is ideal, but a single email with a list is fine too.

Thank you for your time — it genuinely helps us build something better.
