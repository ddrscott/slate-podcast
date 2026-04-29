// Centralized display-name resolution. Wherever a person appears in the
// UI, render via displayName() so changing the rule is one edit.
//
// Rule: prefer the user's chosen display_name (set via Edit Profile, or
// auto-populated from a Gravatar profile lookup). Fall back to the local
// part of the email — `scott@trifectadb.com` becomes `scott`. We never
// show the @domain in the UI; emails reach into address books and feel
// like leaking. The resolved name is good enough for in-app attribution.

export interface PersonLike {
  display_name?: string | null;
  email?: string | null;
}

export function displayName(p: PersonLike | null | undefined): string {
  if (!p) return '';
  const name = p.display_name?.trim();
  if (name) return name;
  const email = p.email ?? '';
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : email;
}

// Local part only, no display_name override. Used when we want the bare
// fallback (e.g., for the avatar initial when no headshot is set).
export function emailLocal(email: string | null | undefined): string {
  if (!email) return '';
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : email;
}
