# Getting started as a Slate user

This is a 10-minute walkthrough of joining a slate, suggesting an episode, and claiming a slot. Follow it once and you'll know enough to use Slate without thinking about it.

You'll need:

- An invite link to a slate (looks like `https://slate.ljs.app/<slug>`).
- Any email address.

## 1. Sign in

Open the slate URL. Click **Sign in** in the top-right.

You'll land on `auth.ljs.app`. Type your email, hit submit. Check your inbox for a magic link from `hello@ljs.app`. Click it.

You're now back on Slate, signed in. The cookie lasts 30 days.

## 2. Join the slate

The first time you visit a slate you're not a member of, you'll see a **Join** button. Click it.

You're now a **Member**. That means:

- You can post episode topics.
- You can upvote other people's topics.
- You can see the schedule.

You can't claim slots yet — that's the Host role, and only an App-Admin can promote you.

## 3. Suggest an episode

Click **Suggest** in the slate nav.

Fill in:

- **Title** — what the episode is about. Required.
- **Description** — context, talking points, links. Optional.
- **URL** — one canonical link if there is one (article, video, etc.). Optional.

Submit. The form will warn you if your title fingerprints to an existing topic (case + punctuation insensitive) — go upvote that one instead.

## 4. Upvote topics

Open the **Topics** tab. Click the upvote arrow on anything you'd like to hear discussed. The list reorders by vote count.

This is how Hosts decide what to schedule next.

## 5. (Hosts only) Claim a slot

Once an App-Admin promotes you to Host, you can do this:

1. Open the slate's main schedule grid. Open slots are blue.
2. Click an open slot.
3. On the slot page, click **Claim & schedule**.
4. Pick a topic from the pool (or write a custom title).
5. Confirm.

The slot is now `confirmed` and yours. You'll get reminder emails 48h and 24h before showtime.

## 6. (Hosts only) Write show notes

After you record, open your slot and click **Edit show notes**. The markdown editor supports:

- Standard markdown.
- Asset attachments (audio, video, transcript, image, link) via the asset CRUD below the editor.

Click **Publish** when ready. Published notes render to the public slot page, sanitized.

## What's next

- **[How-to: configure scheduling rules](../how-to/configure-scheduling-rules.md)** — for App-Admins setting up a new slate.
- **[Reference: roles & permissions](../reference/roles-and-permissions.md)** — exactly what each role can do.
- **[Explanation: why slates instead of shows](../explanation/why-slates.md)** — the model behind the model.
