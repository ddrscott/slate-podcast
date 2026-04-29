# Roles and permissions

Three roles. App-Admin is global; Member and Speaker are per-slate.

| Role | Scope | Granted by | Can be revoked? |
|---|---|---|---|
| **App-Admin** | All slates | `auth.ljs.app` JWT scope (`admin` or `slate:admin`) | Yes — by editing the user record in `auth.ljs.app` |
| **Speaker** | One slate | App-Admin, via slate's people page | Yes — same |
| **Member** | One slate | Self-service (Join button) | App-Admin can demote to nothing by removing the row |

App-Admins implicitly have Speaker rights on every slate. Speakers implicitly have Member rights.

## Permission matrix

| Action | Member | Speaker | App-Admin |
|---|:-:|:-:|:-:|
| View public schedule | ✓ | ✓ | ✓ |
| View private slate (`is_public = 0`) | ✓ | ✓ | ✓ |
| Join a slate (Member) | ✓ | — | — |
| Post a suggestion | ✓ | ✓ | ✓ |
| Upvote a suggestion | ✓ | ✓ | ✓ |
| Claim a slot | — | ✓ | ✓ |
| Pick / change a slot's topic | — | ✓ | ✓ |
| Boot another Speaker off a slot | — | ✓ | ✓ |
| Write & publish show notes (own slot) | — | ✓ | ✓ |
| Edit slot status (cancel, reopen) | — | — | ✓ |
| Edit scheduling rules | — | ✓ | ✓ |
| Regenerate slots | — | ✓ | ✓ |
| Bulk-edit slots in the AG Grid view | — | ✓ | ✓ |
| Promote Member ↔ Speaker | — | — | ✓ |
| Edit slate settings (slug / timezone / visibility) | — | — | ✓ |
| Create a slate | — | — | ✓ |
| Archive a suggestion | — | ✓ | ✓ |
| Edit any user's suggestion | — | — | ✓ |

## Where the checks live

`src/lib/access.ts`:

```typescript
requireUser(ctx)                 // → AuthUser, 401 if no session
requireAppAdmin(ctx)             // → 403 unless `admin` / `slate:admin` scope
requireMemberOnSlate(ctx, id)    // → 403 unless Member, Speaker, or App-Admin
requireSpeakerOnSlate(ctx, id)   // → 403 unless Speaker or App-Admin
```

Throws `HttpError(status, code)`; the caller wraps with `jsonError(err)` to produce the canonical `{ ok: false, error: code }` body.

## App-Admin scope source

The scope is set on the `auth.ljs.app` user record, not Slate. Slate reads the JWT payload's `scopes: string[]` field and checks via `isAppAdmin(scopes)`:

```typescript
export function isAppAdmin(scopes: string[] | undefined): boolean {
  if (!scopes) return false;
  return scopes.includes('admin') || scopes.includes('slate:admin');
}
```

A scope change requires the user to sign out and back in (the JWT is opaque after issuance).
