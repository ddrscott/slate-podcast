# Create a new slate

Slates are top-level containers — one per podcast. Only **App-Admins** can create them.

You're an App-Admin if your `auth.ljs.app` JWT contains the `admin` scope or `slate:admin` scope.

## 1. Open the admin wizard

```
https://slate.ljs.app/admin/slates/new
```

## 2. Fill in

- **Name** — display name. Free-form.
- **Slug** — URL component. Lowercase letters, digits, dashes. **Mutable** — change it later for soft privacy ("rotate the URL").
- **Timezone** — IANA name (`America/Chicago`, `Europe/Berlin`). Slot times resolve in this zone.
- **Public?** — if checked, anyone with the URL sees the schedule. Uncheck for invite-only.

Submit. You're now the slate's first Speaker (App-Admins are implicitly Speakers everywhere, but the row is also written explicitly).

## 3. Add scheduling rules

```
https://slate.ljs.app/<slug>/admin/rules
```

Each rule generates slots on a recurring cadence. You can stack multiple — e.g., a weekly Monday rule plus a monthly first-Friday rule. See **[Reference: scheduling rules](../reference/scheduling-rules.md)** for the full grammar.

After adding rules, click **Regenerate slots**. This expands the rules over the configured horizon (default 1 year) and inserts open slots, idempotently — re-running won't create duplicates because of `UNIQUE(slate_id, start_time)`.

## 4. Promote your first Speakers

```
https://slate.ljs.app/<slug>/admin/people
```

Anyone who's joined as a Member shows up here. Click **Promote** to make them a Speaker. Speakers can claim slots and post show notes.

You can also demote — they revert to Member.

## 5. Share the slate URL

The public URL is `https://slate.ljs.app/<slug>`. Members join via the **Join** button on that page.

## 6. (Optional) Tighten the slug

If you want soft privacy without making the slate fully private, rotate the slug to something hard to guess:

```
https://slate.ljs.app/<slug>/admin/settings
```

Old URLs 404; existing members are unaffected (membership is by `slate_id`, not slug).
