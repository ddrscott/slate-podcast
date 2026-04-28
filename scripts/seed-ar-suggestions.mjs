// Seed 20 episode suggestions into the live Abolitionist Rising Daily slate.
// Uses the same JWT_SECRET as auth.ljs.app to mint a session token for Scott
// (whose auth.ljs.app userId already lives in the production users table from
// his earlier sign-ins). App-Admins bypass slate membership checks, so this
// works without first joining as a Member.

import fs from 'node:fs';
import path from 'node:path';

const SLATE_ID = 'slt_09c091e75a5c111d';
const BASE = process.env.BASE ?? 'https://slate.ljs.app';
const SECRET = fs.readFileSync(path.join(import.meta.dirname, '..', '.dev.vars'), 'utf8')
  .match(/^JWT_SECRET=(.+)$/m)[1];
const USER_ID = '8df61415-bd89-47b6-9ef6-cba8573ed122'; // Scott's auth.ljs.app userId
const EMAIL = 'ddrscott@gmail.com';

async function generateToken() {
  const payload = {
    email: EMAIL,
    userId: USER_ID,
    scopes: ['admin', 'life:access'],
    gravatarHash: 'cf48aeb05f4375b2c65440d90a2435d6',
    exp: Date.now() + 3600_000,
    iat: Date.now(),
    iss: 'auth.ljs.app',
  };
  const data = JSON.stringify(payload);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  const sigHex = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  return btoa(JSON.stringify({ data, sig: sigHex }));
}

const SUGGESTIONS = [
  {
    title: 'The Norman Statement, Article by Article',
    description: 'A walking tour through the eleven articles that define the movement. Each speaker takes one article, unpacks the affirmation, denial, and proof texts, and grounds it in plain language for someone hearing it for the first time. Anchor series for new listeners.',
    tags: 'foundations, doctrine, series',
  },
  {
    title: 'Why We Call It Child Sacrifice',
    description: 'Defending the biblical category against accusations of being inflammatory. Walking Psalm 139, Jeremiah 1:5, and Exodus 21:22-25 from the text into the language we use in public. Why "tragic choice" is itself an iniquitous decree of the heart.',
    tags: 'language, exegesis, doctrine',
  },
  {
    title: 'What This Movement Is Actually For',
    description: 'Article XI as the centering force. Without the gospel, abolitionism is just another single-issue activism. With it, the activism makes sense and the urgency lands differently. Why we have to keep saying it.',
    tags: 'gospel, foundations',
  },
  {
    title: 'Isaiah 10 and the Six-Week Bill',
    description: 'Close-reading "Woe to those who decree iniquitous decrees" and applying it directly to the gestational bills, exception clauses, and "compromise wins" celebrated in pro-life circles. The text doesn\'t leave room for celebration.',
    tags: 'incrementalism, exegesis, legislation',
  },
  {
    title: 'Romans 13 Doesn\'t Say What You Think',
    description: 'The verse most often weaponized against abolitionists who defy unjust laws. Walk through it next to Daniel 3, Acts 5, Exodus 1, and the lesser-magistrate doctrine. Submission has limits, and the text shows them.',
    tags: 'lesser-magistrate, exegesis, defiance',
  },
  {
    title: 'Why We Stopped Saying Pro-Life',
    description: 'Article IX is the most controversial article in the Statement. This episode owns it: how the Pro-Life Movement has become an obstacle to abolition, why linguistic separation isn\'t tribalism, and what it looks like to walk it out without being a jerk.',
    tags: 'pro-life-vs-abolition, strategy',
  },
  {
    title: 'A Fifty-Year Loss: The Case Against Incrementalism',
    description: 'Incrementalism in theory is perpetuity in practice. Half a century of "pro-life wins" and a million abortions a year. Bring on a former pro-lifer who walked it backward and can name the moment the math broke.',
    tags: 'incrementalism, history, strategy',
  },
  {
    title: 'Some Children, Not Others: The Sin of Partial Bills',
    description: 'The argument that\'s often skipped: every bill that protects some children but not others codifies partiality, which Scripture forbids over and over. Deuteronomy 1:16-17, Leviticus 19:15, James 2:8-9.',
    tags: 'partiality, exegesis, legislation',
  },
  {
    title: 'What If Abolition Polls Badly?',
    description: 'Article II\'s denial — "we deny that public polling or the political winds should dictate what Christians say and do." Useful when an abolitionist bill polls poorly and speakers feel the pressure to soften the message.',
    tags: 'pragmatism, strategy',
  },
  {
    title: 'Follow the Pro-Life Money',
    description: 'Investigative episode: who profits when abortion remains legal-but-restricted? Names, dollars, and the incentive structures that keep the Pro-Life Industrial Complex losing on purpose. Pairs with Article IX.',
    tags: 'pro-life-industry, investigation',
  },
  {
    title: 'The 14th Amendment Already Bans Abortion',
    description: 'The strongest constitutional argument for criminalizing abortion as homicide. Equal protection isn\'t aspirational — it\'s already in the text. Bring a constitutional lawyer and walk through how the courts have dodged it.',
    tags: 'legal, 14th-amendment, equal-protection',
  },
  {
    title: 'Should Mothers Be Prosecuted?',
    description: 'The question abolitionists get asked most. How to hold both that there is forgiveness for the sin of murder AND that justice for victims must be established. Pastoral, not punitive — and why blanket immunity is itself an injustice.',
    tags: 'prosecution, gospel, pastoral',
  },
  {
    title: 'The Pill Is the Loophole',
    description: 'Pills by mail, telehealth, and the abortion-doula network. If only doctors can be prosecuted, the industry just routes around them. Why "doctor-only" laws are already obsolete and what equal-protection legislation has to address.',
    tags: 'prosecution, pills, strategy',
  },
  {
    title: 'The Sermon Your Pastor Won\'t Preach',
    description: 'Matthew 5:13-16 applied to fifty years of evangelical equivocation. Why the pulpits went quiet, what kept them quiet, and a call to repentance. Honest about the cultural Christianity, donor fear, and eschatology that made silence feel responsible.',
    tags: 'church, pastors, repentance',
  },
  {
    title: 'What an Abolitionist Church Actually Looks Like',
    description: 'Concrete picture: what it looks like for one local church to meaningfully oppose the abortion holocaust in word and deed. Sermons, signs, sidewalk presence, lobbying lawmakers, training the next generation. Interview a pastor doing it.',
    tags: 'church, practical, action',
  },
  {
    title: 'How to Talk to Your Pastor (Without Burning the Bridge)',
    description: 'Listener-facing how-to. Scripts, books to gift, push-backs to expect, when to leave a church that won\'t move, when to stay and labor. Written for the abolitionist sitting in the pew on Sunday.',
    tags: 'practical, listener-action, pastors',
  },
  {
    title: 'At the Abortion Mill',
    description: 'What direct action looks like at the killing place. Sidewalk counseling, the "rescue" tradition (and the law that punished it), legal risk in 2026, and where each of our speakers personally draws the line. Proverbs 24:11 in practice.',
    tags: 'direct-action, sidewalk, rescue',
  },
  {
    title: 'What Repentance Actually Costs a Nation',
    description: 'Daniel 9, Ezra 9-10, Jonah 3, 2 Chronicles 7:14. Beyond the bumper sticker. The shape of corporate confession, fasting, solemn assembly, and bearing fruit. Could anchor a Day of Mourning episode.',
    tags: 'repentance, exegesis, national',
  },
  {
    title: 'Given Over: Reading Romans 1 in 2026',
    description: 'The diagnostic passage. "God gave them up to a darkened mind that thinks child sacrifice is good." Track the cultural collapses that mirror the chapter beat-by-beat — without flattening it into a culture-war screed.',
    tags: 'judgment, exegesis, cultural-analysis',
  },
  {
    title: 'Wilberforce Was Slow. He Was Also Right.',
    description: 'The historical analogue most abolitionists invoke. Honest account, not hagiography. What Wilberforce, Sharp, and Clarkson got right (immediatism, gospel-centered argument) and where they compromised (the slow march, the apprentice clauses). Lessons for now.',
    tags: 'history, wilberforce',
  },
];

async function main() {
  console.log(`Minting JWT for ${EMAIL} (admin scope)...`);
  const token = await generateToken();

  console.log('Hitting /api/auth/callback to set session cookie...');
  const cbRes = await fetch(`${BASE}/api/auth/callback?next=/&token=${encodeURIComponent(token)}`, {
    redirect: 'manual',
  });
  const cookie = cbRes.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error(`auth callback failed: ${cbRes.status}`);
  console.log(`session cookie: ${cookie.slice(0, 40)}...`);

  console.log(`\nSeeding ${SUGGESTIONS.length} suggestions to ${SLATE_ID}...\n`);
  let ok = 0, dup = 0, fail = 0;
  for (const [i, s] of SUGGESTIONS.entries()) {
    const res = await fetch(`${BASE}/api/slates/${SLATE_ID}/suggestions`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(s),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      console.log(`✓ ${String(i + 1).padStart(2, ' ')}. ${s.title}`);
      ok++;
    } else if (res.status === 409 && body?.error === 'duplicate') {
      console.log(`~ ${String(i + 1).padStart(2, ' ')}. ${s.title}  (duplicate of ${body.duplicate?.id})`);
      dup++;
    } else {
      console.log(`✗ ${String(i + 1).padStart(2, ' ')}. ${s.title}  → ${res.status} ${JSON.stringify(body)}`);
      fail++;
    }
  }
  console.log(`\n── ${ok} created, ${dup} duplicates skipped, ${fail} failed ──`);
}

main().catch(err => { console.error(err); process.exit(1); });
