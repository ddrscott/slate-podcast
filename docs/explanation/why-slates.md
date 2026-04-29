# Why "slates" instead of shows + organizations

Earlier drafts of Slate had a two-level hierarchy: an `organizations` table that owned `shows`. Slate threw that out. Now there's just one top-level entity — the **slate** — and a single membership table.

This is a deliberate choice with real costs. Worth explaining why.

## The Calendly-inversion model

Calendly is "host posts availability, guest picks a slot." Slate inverts that: **the host posts a year of empty demand, and many hosts see the gaps and claim the ones they want.**

The core unit isn't a person's calendar. It's a *show's* calendar. The data model should reflect that.

## Why not orgs/shows?

A separate `organizations` table would let one org own many shows, share members across them, and roll up reporting. That's the SaaS playbook.

We don't need it because:

1. **Volunteer shows usually map 1:1 to "the show".** There's no parent company. The org would be empty boilerplate.
2. **Cross-show membership is rare.** When the same person is on two shows, two memberships is fine. We don't lose anything by not deduping.
3. **Two levels of routing is two levels of confusion.** `/[org]/[show]/...` doubles the URL surface and forces every UI affordance to ask "which org? which show?". A single slug is mentally simpler.
4. **Adding orgs later is cheap.** A future `org_id` column on `slates` plus an `organizations` table covers it. Pulling them out now is the expensive direction.

## What we lose

- **Brand cohesion across multiple shows under one org.** A network like NPR would want this. Slate isn't aimed at NPR.
- **Cross-show host reuse.** A host on two shows has two memberships and two role rows. Trivial cost in DB; small annoyance in user-onboarding emails.
- **Org-level admin scope.** If you run two slates, you're an App-Admin (global) — there's no middle tier. The blast radius of App-Admin is wider than is strictly clean. We accept this; the user pool is small.

## Why "slate"

"Show" is a thing that has aired. "Slate" is the planning surface — the empty year of slots before they're filled. The name is the model: the noun is the schedule itself, not the episodes.

It's also short and unique enough to claim `slate.ljs.app`.
