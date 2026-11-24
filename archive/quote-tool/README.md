# Archived: instant-quote tool

Retired 2026-11-24. It belonged to an earlier, different business (data
cleanup priced on gigabytes, tables and sources) and doesn't fit Eldo.
Nothing here is deployed; wrangler uploads only `public/` and runs the
root `worker.js`.

- `worker.js`: the old Worker, with the `/api/quote` handler and the
  Resend email notification (`RESEND_API_KEY`).
- `pages-function-quote.js`: the earlier Cloudflare Pages Function
  version, including its last uncommitted edits.

The form that called it is in git history (index.html before commit 9e1351a).
