# win-lot web

Vite + React + TypeScript front end. Built output goes to `web/dist`, which the Worker serves
through the ASSETS binding (SPA fallback); `/api/*` is handled by the Worker.

```
npm install
npm run dev      # http://localhost:5173, proxies /api -> http://localhost:8787 (wrangler dev)
npm run build    # tsc -b && vite build -> web/dist
npm run preview
```

- Open any page with `?mock=1` to force the in-browser mock data (`src/mocks/data.ts`).
  The same mock data kicks in automatically (with a banner) when `/api` is unreachable.
- Charts are hand-built SVG/CSS (no chart library). Tokens live in `src/styles/tokens.css`.
- API types mirror `docs/ARCHITECTURE.md` (`src/api/types.ts`).
