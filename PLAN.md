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
- Featured-image `alt` text is sourced from the Contentful Asset's own `description` field, same pattern as gallery image captions — not a separate field on Blog Post.
- **Build resilience:** since the whole site is statically generated, one malformed entry (missing required field, rich-text render error) must not throw and fail the entire `npm run build`. Fetch helpers should catch per-entry errors, log them, and skip that entry rather than crashing the build for every page.

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
9. **Still open:** deploy-failure notifications (Cloudflare dashboard → Notifications) not yet configured — carry this into Phase 9 polish/handoff, since the wife needs to know if a publish doesn't go live.

## Contentful → Cloudflare Rebuild Trigger

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
6. **Deploy pipeline** — DONE. Live at `strona-ani.j-w-wisniewski.workers.dev` via Cloudflare's unified Workers Git-integration (see Deploy Pipeline section for actual mechanics vs. original plan). Deploy-failure notifications still outstanding — moved to Phase 9.
7. **Automation** — Contentful build-hook webhook; publish a test entry, confirm rebuild + live update. (Re-verify Build Hooks UI still applies under the Workers-based project type before following the written steps.)
8. **Custom domain** — add `blog.herdomain.com`, configure DNS, verify SSL.
9. **Polish/handoff** — sitemap, robots.txt, favicon, basic SEO meta, optional cookie-free Cloudflare Web Analytics, deploy-failure notifications (deferred from Phase 6), and a short "how to publish a post" guide (with screenshots) for the wife.
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
