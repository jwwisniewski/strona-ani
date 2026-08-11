# Plan: Wife's Blog (Contentful + Astro + Cloudflare Pages)

## Context

The user wants to build a personal blog for his wife. The project directory (`strona-ani`) is currently empty — this is a from-scratch build. A previous session had already settled on a headless stack (Contentful + Astro + Cloudflare Pages) so the wife can publish posts through a plain web UI with zero code/CLI involvement, and the site auto-deploys on every change.

Decisions made with the user for this round:
- **Stack:** confirmed — Contentful (CMS) + Astro (SSG) + Cloudflare Pages (hosting) + GitHub (repo/CI trigger).
- **Language:** Polish only for now, but the content model and Astro routing must be built so English can be added later without a rewrite (Contentful locales + Astro's native i18n system, not bolted on retroactively).
- **MVP features:** blog posts with categories/tags, a small photo gallery, a contact form. Comments and newsletter are explicitly out of scope. A shopping cart is a possible future addition — the architecture should not block it, but nothing cart-related gets built now.
- **Domain:** a subdomain of the wife's existing main domain (e.g. `blog.herdomain.com`). Confirmed: the domain's DNS will be on Cloudflare. iCloud stays as the email provider (root domain MX untouched) — contact form uses Web3Forms, not Cloudflare's own email sending.

## Project Scaffolding

Initialize with `npm create astro@latest .` (TypeScript strict, no UI framework — plain `.astro` components are sufficient).

```
strona-ani/
├── astro.config.mjs
├── .nvmrc                          # pin Node LTS
├── .env.example                    # CONTENTFUL_SPACE_ID, CONTENTFUL_DELIVERY_TOKEN, CONTENTFUL_ENVIRONMENT, PUBLIC_WEB3FORMS_ACCESS_KEY
├── src/
│   ├── components/                 # Header, Footer, PostCard, CategoryBadge, GalleryGrid, ContactForm
│   ├── layouts/                    # BaseLayout, PostLayout
│   ├── lib/
│   │   ├── contentful.ts           # SDK client singleton + typed fetch helpers (getAllPosts, getPostBySlug, getAllCategories, getGallery, getSiteSettings) — must defensively skip/log malformed entries rather than throwing, since a build-time exception fails the whole static build
│   │   ├── contentful-types.ts     # hand-written field interfaces
│   │   ├── contentful-image.ts     # Contentful Images API URL/srcset builder
│   │   └── i18n.ts                 # locale constant/helpers (future-facing, not wired to routing yet)
│   ├── pages/
│   │   ├── index.astro
│   │   ├── blog/index.astro, blog/[slug].astro
│   │   ├── kategoria/[slug].astro
│   │   ├── galeria/index.astro, galeria/[slug].astro
│   │   ├── kontakt.astro, dziekujemy.astro, 404.astro
│   └── styles/global.css
```

`astro.config.mjs`: `output: 'static'`, add `@astrojs/sitemap`.

**i18n-readiness without building it now:** every `contentful.ts` helper takes a `locale` param defaulting to `pl-PL`. Adding English later means: enabling Astro's `i18n` config block (`locales: ['pl-PL','en-US']`), wrapping `pages/` in `[locale]/` per Astro's built-in i18n routing, and passing `Astro.currentLocale` into the existing helpers — no fetch logic gets rewritten.

## Contentful Content Model

Create a new space. Settings → Locales: add `pl-PL` and set it as **default** (overriding Contentful's `en-US` default). Leave localization off for now (see note below) — turning it on per-field later, when `en-US` is actually added, is a config change, not a migration.

| Content Type | Key fields |
|---|---|
| **Blog Post** (`blogPost`) | `title`, `excerpt`, `body` (Rich text); `slug`; `featuredImage` (Media); `categories` (Reference, many); `tags` (Short text list, freeform); `publishDate`; optional `seoTitle`/`seoDescription` |
| **Category** (`category`) | `name`, `slug`, `description` (optional) |
| **Gallery** (`gallery`) | `title`, `slug`, `description`, `coverImage`, `images` (Media, many — captions come from each Asset's own title/description, no separate Photo type needed) |
| **Site Settings** (`siteSettings`, singleton) | `siteTitle`/`siteDescription`, `logo`, `facebookUrl`, `instagramUrl`, `contactEmail` |

Tags are a plain array field rather than a Reference content type — they're expected to be freeform/numerous and don't need their own listing pages for MVP; this can be upgraded later without breaking anything.

No `Author` content type: this is a single-author blog with no stated need for multiple authors, so the byline (name, short bio, avatar) is hardcoded as static content in `PostLayout`/`BaseLayout` rather than a Contentful-managed entry. If multi-author ever becomes a real need, add the content type and reference then.

**Locales stay `pl-PL`-only for now.** Do not enable "localization" on fields yet — Contentful lets you turn on localization for an existing field later without migrating data (the existing value simply becomes the default locale's value), so nothing is lost by waiting until `en-US` is actually being built (see Phase 10).

## Astro ↔ Contentful Integration

- Official `contentful` npm SDK, Content Delivery API, called only at **build time** (in frontmatter / `getStaticPaths()`) — no client-side API calls.
- Rich text rendered via `@contentful/rich-text-html-renderer`'s `documentToHtmlString()`.
- Images: use plain `<img>` with a manually built `srcset` against Contentful's Images API (`?w=...&fm=webp&q=80`) rather than Astro's own `<Image>`/`astro:assets` pipeline — Contentful's CDN already resizes/transcodes, so running it through Astro's image pipeline too would be redundant.

**Considered moving image hosting under Cloudflare (R2 / Cloudflare Images / a proxy Worker) — decided against it for now:**
- Images currently hotlink directly to `images.ctfassets.net` (Contentful's CDN, backed by Fastly — a legitimate, independent, fast CDN in its own right). Cloudflare has zero involvement in serving them, even after Phase 8's custom domain goes live, since the `<img src>` points to a different origin entirely; Cloudflare only proxies requests to *our* domain.
- Three ways it *could* be done: (1) **Cloudflare Images** — paid product, stores/transforms/serves images from Cloudflare's own storage; (2) **R2 + a build-time sync step** — download each Contentful asset, upload to an R2 bucket, serve from there; (3) **a lightweight proxy Worker** (`/img/*` fetches from Contentful, caches at Cloudflare's edge, serves under our own domain) — no explicit sync/tracking needed, cheapest to build of the three.
- **R2 cost is not the blocker** — it has a genuinely free tier (not a trial): 10 GB-month storage, 1M "Class A" ops/month (writes/lists), 10M "Class B" ops/month (reads), and **zero egress fees at any tier** (R2's whole differentiator vs. S3). A personal blog's photos would almost certainly never leave the free tier. Beyond it: $0.015/GB-month storage, $4.50/million writes, $0.36/million reads — still cheap.
- **The real cost is complexity, not money:** options 1 and 2 need an ongoing sync pipeline — tracking what's already uploaded, handling updates/deletions when a photo gets swapped in Contentful — real ongoing maintenance surface. Option 3 avoids that but still adds a Worker route and edge-cache behavior to reason about.
- **Decision: not worth it right now.** The benefit (marginally fewer DNS lookups/connections, one less external vendor dependency, unified Cloudflare analytics) is marginal against real added complexity, and there's no actual problem being solved (no reported slowness or Contentful outages). Revisit only if Contentful's CDN becomes an actual pain point — if so, the proxy-Worker approach (option 3) is the cheapest path back to this decision.
- Featured-image `alt` text is sourced from the Contentful Asset's own `description` field, same pattern as gallery image captions — not a separate field on Blog Post.
- **Build resilience:** since the whole site is statically generated, one malformed entry (missing required field, rich-text render error) must not throw and fail the entire `npm run build`. Fetch helpers should catch per-entry errors, log them, and skip that entry rather than crashing the build for every page.

## Content Preview — DONE

Added mid-build (not in the original scaffolding) once real editing started: the wife needs to see draft changes instantly while editing in Contentful, without waiting for a publish + rebuild.

- **Client-side, not SSR** — kept the site fully static. `src/pages/podglad.astro` is a static shell page whose client-side JS calls Contentful's **Preview API** (`preview.contentful.com`, using a separate Preview token that returns draft/unpublished content) directly from the browser. No Cloudflare adapter, no server-rendered routes.
- **Code reuse, not duplication** — `contentful.ts`'s pure mapping/rendering functions (`mapBlogPost`, `mapAsset`, `richTextOptions`, etc.) were extracted into `contentful-mappers.ts` (no client instantiation, no `import.meta.env` access), so the exact same logic used for the real Delivery-API build is reused by the browser-side Preview-API fetch.
- **Access control:** a shared secret (`PUBLIC_PREVIEW_SECRET`) is required as a query param, checked client-side, so the preview URL isn't publicly browsable. `/podglad` is `noindex`ed and excluded from the sitemap.
- **Contentful wiring:** a "Content preview" platform was created (via Management API) for `blogPost`, with the preview URL template `.../podglad?slug={entry.fields.slug}&type=blogPost&secret=...` — this makes a "Preview" button appear directly in Contentful's entry editor.
- New env vars, all `PUBLIC_` (used client-side, so not really secret regardless of prefix): `PUBLIC_CONTENTFUL_SPACE_ID`, `PUBLIC_CONTENTFUL_PREVIEW_TOKEN`, `PUBLIC_PREVIEW_SECRET`.
- Currently supports `blogPost` only — extend `podglad.astro` and add another Content preview configuration if gallery/category preview is ever needed.
- Verified end-to-end with a real unpublished draft edit: Preview API returned the new draft title while Delivery API still returned the old published one.

## Contact Form

**Web3Forms** — a static `<form>` POSTing to `https://api.web3forms.com/submit` with a hidden access key. No backend code, works without JS, free tier, built-in honeypot spam protection. Keeps the stack at three moving parts instead of four (avoids needing Cloudflare Pages Functions + a transactional email API for MVP). If more control is needed later, swap to a Pages Function (`functions/api/contact.ts`) + an email API — isolated change, nothing else in the architecture is affected.

(Considered Cloudflare's own Email Service as a native alternative since DNS will be on Cloudflare — ruled out for now: general sending requires the Workers Paid plan, and while sending to one pre-verified destination address is free, it still requires building a Pages Function + Turnstile rather than a plain static form. Not worth the added complexity for MVP; Web3Forms keeps the contact form a zero-backend static form like the rest of the site.)

## Deploy Pipeline — DONE (live at `strona-ani.j-w-wisniewski.workers.dev`)

**Actual mechanics differ from the original plan** — Cloudflare's dashboard now routes new "Connect to Git" projects through its unified Workers deployment system, not the classic Pages-specific build pipeline:

1. Pushed scaffolded repo to GitHub (`jwwisniewski/strona-ani`).
2. Cloudflare dashboard → Workers & Pages → Create → Connect to Git → select repo. The setup screen asks for a **build command** (`npm run build`) and a separate **deploy command** — pre-filled as `npx wrangler deploy` (non-production branches use `npx wrangler versions upload` for preview versions instead).
3. This means the repo needs its own `wrangler.jsonc` with an `assets.directory` pointing at `dist/` — added at repo root (minimal config, no Worker entry point needed since it's pure static serving, no dynamic routing). Verified locally first with `npx wrangler deploy --dry-run` before relying on the dashboard's Deploy button.
4. Env vars set via the project's "Variable name/value" fields (build-time): `CONTENTFUL_SPACE_ID`, `CONTENTFUL_DELIVERY_TOKEN` (Encrypt), `CONTENTFUL_ENVIRONMENT=master`, `PUBLIC_WEB3FORMS_ACCESS_KEY` (Encrypt).
5. Node version pinned via `.nvmrc`; Cloudflare auto-detected `nodejs@22.12.0` from it.
6. Every push to `main` deploys to production; other branches get preview versions (per step 2's non-production deploy command).
7. Cloudflare's default trailing-slash redirect behavior for static assets (e.g. `/blog` → `307` → `/blog/` → `200`) is expected, not a bug — confirmed during verification.
8. **Gotcha hit during first deploy:** `CONTENTFUL_ENVIRONMENT` was accidentally entered as `aster` (truncated `master`) in the dashboard, causing a Contentful 404 at build time. Fixed by correcting the variable value and retrying.
9. **Deploy-failure notifications — investigated in Phase 9, skipped for now.** There is no simple toggle for this. Classic Cloudflare "Notifications" (dashboard, top-level) does not cover Workers Builds at all — that's a different, newer mechanism called **Event Subscriptions**. To get notified on a failed build you actually need to:
   1. Create a Cloudflare **Queue** (`wrangler queues create builds-event-subscriptions`).
   2. Deploy a **second, separate Worker** that consumes that queue — Cloudflare provides a ready template: `npm create cloudflare@latest -- --template=cloudflare/templates/workers-builds-notifications-template` (repo: `cloudflare/templates`, dir `workers-builds-notifications-template`). Needs its own `wrangler deploy`.
   3. The template only sends to a **Slack or Discord webhook**, not email — for an actual email, its `src/index.ts` would need modifying to call an email API instead (Cloudflare Email Service to one verified destination address is free, per the Content Preview / Contact Form email-service research earlier in this doc — reuse that path rather than researching it again).
   4. Create a scoped Cloudflare API token (`Workers Builds Configuration: Read`, `Workers Scripts: Read`) and set it as a secret on the consumer Worker.
   5. Create the actual **event subscription** linking the queue to `build.failed`/`build.succeeded`/`build.cancelled` events (dashboard: Queues → your queue → Subscriptions tab → Subscribe to events → source "Workers Builds"; or `wrangler queues subscription create`).
   - **Decision:** not worth deploying a whole second Worker + Queue for a personal blog's failure alerts. Revisit only if a silently-failed deploy actually causes a real problem (i.e. the wife publishes, nothing goes live, and nobody notices for a while).

## Security Hardening — DONE (supply chain), PENDING (Aikido)

Triggered by a security review of the whole codebase plus a "what if a malicious package ends up in the dependency tree" question while looking at a real build log.

**Code fixes:** `contentful-mappers.ts`'s rich-text `renderNode` overrides (entry-hyperlink, embedded-entry) and `podglad.astro`'s featured-image markup interpolated `url`/`title`/image-src values into raw HTML strings without escaping. Contentful's `slug`/`title` fields have no format validation at the schema level, so nothing blocks HTML-significant characters being stored via the Content Management API. Exploitability requires trusted Contentful editor access (not public input) on this two-person CMS, so this stayed below the high-confidence bar in review, but escaping is cheap regardless — added `escapeHtml` (exported from `contentful-mappers.ts`, reused in `podglad.astro` instead of a duplicate copy).

**Supply-chain protections (`.npmrc`, committed):**
- `ignore-scripts=true` — blocks preinstall/install/postinstall scripts for every dependency, unconditionally. Verified the build still works: esbuild's native binary resolves via `optionalDependencies` (platform-specific packages), not its postinstall script. `package.json`'s `allowScripts` field documents the packages that legitimately need scripts if this is ever turned off (esbuild, fsevents, workerd — native-binary fetchers from trusted maintainers).
- `min-release-age=7` — refuses to resolve to a package version published less than 7 days ago. **Important nuance:** this only affects `npm install`/`npm update` (version resolution) — `npm ci`/`npm clean-install` always replays `package-lock.json`'s exact pinned versions regardless of age. So this protects the moment someone actually adds/bumps a dependency and regenerates the lockfile, not every build.
- **Gap:** Cloudflare's Workers Builds image runs **npm 10.9.2**, which predates both `ignore-scripts` enforcement-by-default semantics and `min-release-age` (both are recent npm 11.x features). Cloudflare's own `npm clean-install` step won't enforce either setting. This isn't a hole in practice, though — their build replays the already-reviewed, already-pinned lockfile exactly, so the actual risk window (a human running `npm install`/`update`) is wherever that command is actually run, which so far has been this local machine on npm 11.19.

**Aikido Security — investigated, not yet set up:** free tier confirmed usable (2 users, 10 repos, real SAST/SCA/Secrets/IaC scanning, free forever — not a trial), comfortably covers this single-repo project. Setup is dashboard-only (connect GitHub repo via Aikido's own onboarding) — no CLI/API path found for automating this. Next step if pursued: sign up at aikido.dev, connect `jwwisniewski/strona-ani`.

## Contentful → Cloudflare Rebuild Trigger — DONE

Under the unified Workers Git-integration flow this project actually uses (see Deploy Pipeline above), the equivalent feature is called **Deploy Hooks** (renamed from Pages' "Build hooks"), with built-in deduplication if the webhook fires multiple times in a burst:

1. Cloudflare dashboard → Workers & Pages → `strona-ani` → Settings → Builds → Deploy Hooks → create one (tied to the `main` branch) → copy the POST URL.
2. Contentful → Settings → Webhooks → add webhook pointing at that URL, triggered on Entry publish/unpublish/delete + Asset publish, scoped to the four content types above (avoids spurious rebuilds from unrelated changes).
3. Result: wife publishes in Contentful → webhook fires → Cloudflare rebuilds → live in ~1-2 min.

## Custom Subdomain + DNS

1. Cloudflare Pages project → Custom domains → Add `blog.herdomain.com`.
2. **If the main domain's DNS is already on Cloudflare:** Cloudflare auto-detects the zone and offers to create the record — confirm it.
3. **If DNS is hosted elsewhere:** Cloudflare shows the exact CNAME target (typically `<project-name>.pages.dev`). Log into wherever `herdomain.com`'s DNS is managed → add a record: Type `CNAME`, Host `blog`, Value = the shown `pages.dev` target, TTL default → save.
4. Wait for propagation; Cloudflare auto-issues a free SSL cert once DNS resolves. Verify `https://blog.herdomain.com` loads and shows Active in the Pages dashboard. This only touches the `blog` label — the root domain's existing DNS/hosting is untouched.

## Phasing / Milestones

0. **Setup** — GitHub repo, Contentful space + `pl-PL` default locale (no localization flags yet), scaffold Astro, confirm local dev renders.
1. **Content model** — create all content types/fields (no `Author` type; byline is static); add a few sample entries.
2. **Contentful integration** — `contentful.ts` client + helpers; verify rich text and image rendering locally against real data; confirm a deliberately malformed sample entry is skipped/logged rather than crashing the build.
3. **Core pages** — home, blog index (+ pagination), post detail, category page (+ same pagination pattern as blog index).
4. **Gallery** — content type wired up, index + detail pages, `srcset` images.
5. **Contact form** — DONE. Web3Forms integration + thank-you page; real submission confirmed delivered by email.
6. **Deploy pipeline** — DONE. Live at `strona-ani.j-w-wisniewski.workers.dev` via Cloudflare's unified Workers Git-integration (see Deploy Pipeline section for actual mechanics vs. original plan).
7. **Automation** — DONE. Deploy Hook created (Workers & Pages → Settings → Builds → Deploy Hooks), Contentful webhook created via Management API scoped to the four content types. Verified end-to-end: republished a test entry, webhook call logged `200` in Contentful, a new Cloudflare deployment landed ~40s later, site confirmed still live after.
8. **Custom domain** — add `blog.herdomain.com`, configure DNS, verify SSL.
9. **Polish/handoff** — IN PROGRESS. DONE: robots.txt, Open Graph/Twitter Card meta + canonical URL, Cloudflare Web Analytics beacon. Skipped: favicon (still Astro default, revisit once a logo exists), deploy-failure notifications (investigated — see Deploy Pipeline section; real cost is a whole second Worker+Queue, not worth it for now). Still open: sitemap (already done via `@astrojs/sitemap` since Phase 0, nothing further needed), and the "how to publish a post" guide (with screenshots) for the wife.
10. **Iterate** — real content, design refinement, revisit `en-US` activation when actually needed.

## Future Shopping-Cart Flags (not built now)

- Keep any future `product` content type fully separate from `blogPost`/`category` so neither is warped to accommodate the other.
- A static-friendly cart tool (Snipcart, Stripe Payment Links) overlays via a client-side widget and needs no changes to the Contentful/Astro/Cloudflare pipeline — just a new content type + route (e.g. `/sklep`) later.
- Drive primary site navigation from Site Settings/config rather than hardcoding it in markup, so adding a "Sklep" nav entry later is a content change, not a code change.

## Verification

- `npm run dev` locally renders home/blog/gallery/contact pages against real Contentful data before any deploy.
- After connecting Cloudflare Pages, confirm the first automatic deploy succeeds and the `*.pages.dev` URL is live.
- Publish a test entry in Contentful and confirm the webhook triggers a rebuild and the change appears live within ~1-2 minutes.
- Submit a real test message through the contact form and confirm delivery. (Done during Phase 5 — email delivery confirmed. The post-submit redirect to `/dziekujemy` couldn't be verified yet since it resolves against the placeholder `site` domain in `astro.config.mjs`; re-verify once Phase 8 sets the real domain.)
- Once DNS is configured, load `https://blog.herdomain.com` directly and confirm SSL is valid and the custom-domain status shows Active in Cloudflare.
