# apps/extension

Chrome Manifest V3 extension (React + Vite) — job-page analysis, form-field detection, and
approved-field autofill. Authenticates against the Career OS web API; holds no database
credentials or AI keys of its own.

**Status:** Phase 2 complete — authenticates via the extension-connect handoff, analyzes a job
page with `GenericHtmlAdapter`, detects and classifies form fields, and displays the results in
the popup. No AI suggestions and no autofill yet; that's Phase 3/4.

See `docs/EXTENSION_DESIGN.md` for the permission model, adapter architecture, and popup UI
spec.

## Development

```
npm run dev --workspace=@career-os/extension       # Vite dev server with HMR
npm run build --workspace=@career-os/extension     # PRODUCTION build to dist/ — always
                                                    # points at https://apply.mypham.space,
                                                    # regardless of any local .env file (see
                                                    # scripts/verify-production-build.mjs)
npm run build:dev --workspace=@career-os/extension # DEVELOPMENT build to dist/ — loads
                                                    # .env.development.local, so it points at
                                                    # VITE_CAREER_OS_API_URL instead
```

Load `apps/extension/dist` as an unpacked extension via `chrome://extensions` (enable Developer
mode first) to test locally. The manifest pins a dev-only public key (see `manifest.config.ts`)
so the extension ID stays stable across rebuilds — it must match
`NEXT_PUBLIC_EXTENSION_ID` in `apps/web/.env.local` for the `/extension-connect` handoff to
reach the right extension.

`src/lib/api-client.ts` defaults to `https://apply.mypham.space`; `.env.development.local` (not
`.env.local` — Vite loads `.env.local` in *every* mode, including a plain `vite build`, which is
exactly the bug `scripts/verify-production-build.mjs` exists to catch) sets
`VITE_CAREER_OS_API_URL=http://localhost:3003` for local testing against `apps/web`'s dev server
(`next dev -p 3003`).

**Plain `npm run build` always ignores `.env.development.local`** — `vite build` defaults to
`mode: production`, which never loads a `.env.development.local` file. If you're testing against
your local `apps/web` dev server, use `npm run build:dev` instead (or `npm run dev` for HMR); if
`dist/` was built with plain `npm run build`, the extension is silently talking to production,
which reliably manifests as `Analyze Job` failing with a generic error even though the code path
is correct — check by grepping `dist/assets/*.js` for `apply.mypham.space` vs `localhost`.
