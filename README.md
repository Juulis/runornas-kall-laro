# Runornas kall

Action-RPG i Diablo 2-stil.

- **Spela:** https://juulis.github.io/runornas-kall-laro/ – PixiJS 8 + Vite, källkod i `src/`. (`/next/` omdirigerar till roten.)

Utveckling: `npm ci && npm run dev` (öppna `/runornas-kall-laro/`). Kontroller: `npm run typecheck`, `npm run lint`, `npm run pages && npm run smoke`.

Struktur, ägarskap (U1 motor/logik, U2 ljud/sparning/meny/karta/i18n), EventBus/GameContext/GameAuthority/SaveBackend/Rng, koordinatsystem, CI och öppna punkter: se [ARCHITECTURE.md](ARCHITECTURE.md).
