# Roles and permissions

Three roles. App-Admin is global; Member and Host are per-slate.

| Role | Scope | Granted by | Can be revoked? |
|---|---|---|---|
| **App-Admin** | All slates | `auth.ljs.app` JWT scope (`admin` or `slate:admin`) | Yes — by editing the user record in `auth.ljs.app` |
| **Host** | One slate | App-Admin, via slate's people page | Yes — same |
| **Member** | One slate | Self-service (Join button) | App-Admin can demote to nothing by removing the row |

App-Admins implicitly have Host rights on every slate. Hosts implicitly have Member rights.

## Permission matrix

| Action | Member | Host | App-Admin |
|---|:-:|:-:|:-:|
| View public schedule | ✓ | ✓ | ✓ |
| View private slate (`is_public = 0`) | ✓ | ✓ | ✓ |
| Join a slate (Member) | ✓ | — | — |
| Post a topic | ✓ | ✓ | ✓ |
| Upvote a topic | ✓ | ✓ | ✓ |
| Claim a slot | — | ✓ | ✓ |
| Pick / change a slot's topic | — | ✓ | ✓ |
| Sub in for another Host on a slot | — | ✓ | ✓ |
| Write & publish show notes (own slot) | — | ✓ | ✓ |
| Edit slot status (cancel, reopen) | — | — | ✓ |
| Edit scheduling rules | — | ✓ | ✓ |
| Regenerate slots | — | ✓ | ✓ |
| Bulk-edit slots in the AG Grid view | — | ✓ | ✓ |
| Promote Member → Host | — | ✓ | ✓ |
| Demote Host → Member | — | — | ✓ |
| Edit slate settings (slug / timezone / visibility) | — | — | ✓ |
| Create a slate | — | — | ✓ |
| Archive a topic | — | ✓ | ✓ |
| Edit any user's topic | — | — | ✓ |

## Where the checks live

`src/lib/access.ts`:

```typescript
requireUser(ctx)                 // → AuthUser, 401 if no session
requireAppAdmin(ctx)             // → 403 unless `admin` / `slate:admin` scope
requireMemberOnSlate(ctx, id)    // → 403 unless Member, Host, or App-Admin
requireHostOnSlate(ctx, id)   // → 403 unless Host or App-Admin
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
