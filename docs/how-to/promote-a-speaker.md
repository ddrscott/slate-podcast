# Promote a Member to Speaker (or demote one)

Members can post and upvote suggestions. **Speakers** can claim slots, write show notes, and edit slate rules.

**Promotion** is peer — any Speaker on the slate can promote a Member. **Demotion** is App-Admin only, by design: peer-promote is additive and safe, but speaker-on-speaker demotion would enable coups.

## Promote

1. Open `https://slate.ljs.app/<slug>/admin/people`.
2. Find the user in the **Members** list.
3. Click **Promote**.

The change is live immediately. They'll see the Speaker actions on their next page load.

## Demote

Same page, **Speakers** list, click **Demote** (App-Admin only). They revert to Member. Slots they own stay theirs (we don't auto-orphan slots) — but another Speaker can boot them off any slot afterward.

## Speakers booting other Speakers

Slate intentionally lets any Speaker overwrite any slot's `speaker_id`. If someone hijacks a slot they shouldn't have, demote them and re-claim. The activity log records every reassignment.

## How "App-Admin" differs

App-Admin is set on the **JWT issued by `auth.ljs.app`**, not in Slate's DB. To make someone an App-Admin:

1. Update their user record in `auth.ljs.app` to add the `admin` or `slate:admin` scope.
2. They sign out and back in to pick up the new scope (the scope lives in the JWT).

App-Admins implicitly have Speaker rights on every slate.
