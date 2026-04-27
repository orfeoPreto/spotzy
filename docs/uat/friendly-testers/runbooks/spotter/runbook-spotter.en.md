# Spotzy — Spotter Testing Guide

**Your name:** {{testerName}}
**Your login:** {{accountEmail}}
**Your password:** {{accountPassword}}
**Site:** {{loginUrl}}
**Time needed:** about 30 minutes
**Questions?** {{contactEmail}}

---

## Before you start

You'll need: a phone or computer, your login details above, and the test card number `{{stripeTestCard}}`. This card is provided by our payment partner for testing — no real money is charged.

When the site asks for a card, enter: `{{stripeTestCard}}`, expiry `12/26`, CVC `123`, postcode `1000`.

---

## Task 1 — Create your account

**Goal:** Sign up and confirm your email.

Go to {{loginUrl}} and sign up using the email and password above.

Check these:
- Did a confirmation email arrive in your inbox?
- Was the email in your language?
- After confirming, did the welcome screen make sense? Was anything confusing?

---

## Task 2 — Find a parking spot

**Goal:** Search for a spot and look at the price.

Search for a parking spot near Grand-Place in Brussels for tomorrow at 14:00, for 2 hours.

Check these:
- Was the map easy to use?
- Did the search results show prices clearly?
- When you clicked on a spot, could you see the full price you'd pay — including any service fees?
- Was the spot's address and description easy to understand?

---

## Task 3 — Make a booking

**Goal:** Complete a booking from start to finish.

Pick one of the spots from your search and book it using the test card `{{stripeTestCard}}`.

Check these:
- Did the checkout show the same total as the listing page?
- Did you get a confirmation page after paying?
- Did a confirmation email arrive? In your language?
- Is there a way to add the booking to your calendar?

---

## Task 4 — Cancel the booking

**Goal:** Cancel cleanly and check the refund message.

Go to your dashboard and cancel the booking you just made.

Check these:
- Was the cancellation easy to find?
- Did the site tell you whether you'd get a refund?
- Did a cancellation email arrive? In your language?

---

## Task 5 — Book again and send a message

**Goal:** Try the messaging feature.

Find a different spot that's at least 25 hours away (look for spots available the day after tomorrow or later). Book it. Then send a short message to the host — something like "Hi, where exactly is the entrance?"

Check these:
- Did the message send without any errors?
- If you received a reply, was it in your language?
- Was the conversation easy to follow?

---

## Task 6 — Open the site on your phone

**Goal:** Check that everything works on a smaller screen.

If you're on a computer, open {{loginUrl}} on your phone. If you're already on your phone, try rotating to landscape mode and back.

Check these:
- Was the site easy to read on a small screen?
- Was the map smooth to use with your finger?
- Were the buttons easy to tap?

If you only have one device, skip this task — just make a note of it.

---

## Task 7 — Try to break it

**Goal:** Find anything the testing tasks above didn't cover.

Spend 10 minutes doing things that seem unexpected: enter a nonsense address in the search, try to book a spot in the past, type a very long message, switch languages mid-booking, use a slow mobile connection if you can. Try anything that comes to mind.

Write down what you tried and what happened — even if nothing broke. "I tried X and it was fine" is useful information.

---

## How to report what you found

Please fill in the defect form for anything that seemed wrong, confusing, or missing:

**{{defectFormUrl}}**

If the form isn't available, email your notes to {{contactEmail}}.

One form per issue is ideal, but if it's easier to send one email with a list, that's fine too.

Thank you for your time — it genuinely helps us build something better.
