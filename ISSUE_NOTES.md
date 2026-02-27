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
