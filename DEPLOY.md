# The Sesh Room — public version

A cozy 21+ cannabis hangout: feed with posts/likes/comments, six chat
rooms, and live video seshes via Jitsi. By **Geeksmith Made Apps**.

## Pieces
- **Frontend:** plain static site (`index.html`, `styles.css`, `app.js`) — host on Netlify.
- **Backend:** Supabase project **"Sesh Room"** (ref `iajmxyiirgetcvymljoh`, us-east-1).
  Tables `sesh_posts`, `sesh_comments`, `sesh_messages` + `increment_sesh_likes()` —
  created by `supabase-setup.sql` (already run Oct 23, 2026).
- **Identity:** display names only (kept on each visitor's device) — no accounts in v1.
- **Live video:** Jitsi Meet embeds, rooms `geeksmith-sesh-<room-id>` on meet.jit.si (free).

## Redeploy
Push changes to the GitHub repo connected to the Netlify site; Netlify
redeploys automatically. Mind the credits: each production deploy costs
~15 of the free plan's 300 monthly credits — batch changes.
