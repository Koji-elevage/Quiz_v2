# Issue Notes

## 2026-02-25

- Dev process management gap:
  - `npm run dev:status` showed `pidfile=none` while a Node process was still listening on `:3000`.
  - This means the running process was started outside the managed daemon scripts (`/tmp/quizv2.pid`), which can cause confusion during restart/stop checks.
  - Out of scope for the current prompt-pipeline fix; consider unifying startup to `dev:daemon` or `pm2` only.

- Dev daemon PID drift:
  - After `dev:daemon`, the recorded PID (`/tmp/quizv2.pid`) became stale while another Node process later served `:3000`.
  - Indicates another launcher/supervisor may be restarting `server.js` independently.
  - Out of scope for this fix; startup authority should be reduced to one process manager.

## 2026-02-28

- Legacy Cloud Run runtime images:
  - Before image persistence was moved to durable storage, images generated/uploaded at runtime on Cloud Run were written only to the instance-local filesystem.
  - Those already-created production images may remain missing if they were not included in the repository and are no longer present on any active instance.
  - Out of scope for the durability fix; affected rows may need manual re-generation or re-upload.

- App logout token revocation:
  - The new logout flow removes the browser-stored app session token and redirects to the feedback screen.
  - This is sufficient for normal same-browser use because subsequent requests no longer send the token, but there is still no server-side revocation list for already-issued app tokens.
  - Out of scope for this UI/logout task; if stricter invalidation is needed later, add token revocation state on the server.
