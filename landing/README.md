# Landing page

Static `index.html` (Sticker Pop, copy from the design artifact linked in `DESIGN.md`). No build.
Preview: `python3 -m http.server -d landing`. Deployed by `.github/workflows/landing.yml` to GitHub Pages.
It is independent of the Cloud Run services; `cloudbuild.yaml` does not touch it.

## One-time setup (owner)
1. GitHub repo > Settings > Pages > Source: **GitHub Actions**. Custom domain: `mixtape-party.com`
   (`CNAME` file here matches). Tick Enforce HTTPS once the cert issues.
2. GoDaddy DNS for `mixtape-party.com`: four `A` records on `@` -> `185.199.108.153`, `185.199.109.153`,
   `185.199.110.153`, `185.199.111.153`; `CNAME` `www` -> `jamiwardlow.github.io`.
3. **Conflict:** `mixtape-party.com` apex may currently point at the Cloud Run web app
   (`mixtape-party-web`). If so, move the app to `app.mixtape-party.com` first (Cloud Run domain
   mapping + `APP_BASE_URL`, OAuth redirect URIs), since the CTAs link there. If the app should stay
   on the apex, change the `https://app.mixtape-party.com/` links in `index.html` and host this elsewhere.
