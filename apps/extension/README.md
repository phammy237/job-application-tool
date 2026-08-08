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
npm run dev --workspace=@career-os/extension     # Vite dev server with HMR
npm run build --workspace=@career-os/extension   # production build to dist/
```

Load `apps/extension/dist` as an unpacked extension via `chrome://extensions` (enable Developer
mode first) to test locally. The manifest pins a dev-only public key (see `manifest.config.ts`)
so the extension ID stays stable across rebuilds — it must match
`NEXT_PUBLIC_EXTENSION_ID` in `apps/web/.env.local` for the `/extension-connect` handoff to
reach the right extension.

`src/lib/api-client.ts` defaults to `https://apply.mypham.space`; override with
`VITE_CAREER_OS_API_URL` (e.g. in `apps/extension/.env.local`) to point at a local dev server
instead.
