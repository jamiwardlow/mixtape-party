## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (uses the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Working in this repo

### Layout

`api/` — Express + Postgres, deployed to Render. `mobile/` — Expo / React Native (Expo Router),
which is also what serves the web client. Product intent lives in `PRODUCT.md`.

### Shipping

Solo project, one agent working one issue at a time. **No branches, no pull requests** — commit
straight to `main`. Render auto-deploys `main`, so a push *is* a production deploy. Put the issue
number in the commit subject (`Add the thing (#55)`) and close the issue after pushing. Rollback
is `git revert` plus a push.

Don't open a PR unless asked. `main` has no branch protection and nothing runs on PR or push, so
a PR here reviews nothing and only leaves the local clone stale after merging.

Pause and ask before pushing when the change is a schema migration against real data, or an auth
change that could lock the owner out of the app.

### The gate

`.githooks/pre-push` runs typecheck + unit tests in both `api` and `mobile` on every content
push; delete-only pushes skip it. This hook is the *only* thing standing between a bad commit and
production — treat a red hook as a blocked deploy, not a nuisance.

`core.hooksPath` is local git config that no fresh clone inherits, so `api`'s `prepare` script
re-points it on every `npm install`.

### Commands

| What | Where | Command |
| --- | --- | --- |
| Unit tests | `api`, `mobile` | `npm test` |
| Integration tests | `api` | `npm run test:integration` |
| Typecheck | `api`, `mobile` | `npm run typecheck` |
| Dev server | `api` | `npm run dev` |
| Run migrations | `api` | `npm run migrate` |

Two runners, on purpose: `api` on vitest, `mobile` on jest-expo — only Expo's preset gets a test
through React Native's untranspiled source.

`api`'s unit tests need no local database — each file boots a throwaway embedded Postgres
(`api/src/__tests__/embeddedPg.ts`). Integration tests call real third-party APIs; most need real
credentials. The YouTube Music and Bandcamp contract tests run in CI, daily, via
`.github/workflows/music-service-contract.yml` (one matrix leg per service). Apple Music's is
excluded — it needs a Music User Token no environment holds.

`embeddedPg.ts` owns port selection and the timeouts around cluster start/stop — read its comment
before touching it. Getting that wrong surfaces as an entire unrelated test file failing at
startup, not as an obvious bug in that file.

### Config and secrets

`api/.env.example` documents every environment variable and where to obtain it — it is the source
of truth for local setup. Production values are set by hand in the Render dashboard (they are
`sync: false` in `render.yaml`).
