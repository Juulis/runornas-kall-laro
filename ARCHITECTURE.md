# Arkitektur – Runornas kall (2D, TypeScript)

Huvudspåret är en isometrisk 2D-motor i **PixiJS v8**, byggd med **Vite + TypeScript (strict)**.
2D-motorn (Vite, `src/`) publiceras på **`/runornas-kall-laro/`** (`dist/`). `/next/` och `/legacy-3d/` omdirigerar till roten. Källan till det gamla 3D-spelet finns kvar i `legacy-3d/` i repot men deployas inte.
`scripts/assemble-pages.mjs` lägger 3D-filerna på roten av `dist/`; `scripts/smoke.mjs` (Playwright) kräver i CI och Pages att roten är spelbar och att `next/` laddar.

## Regler (permanenta)

- **Inga tvingande spärrar.** Fri rörelse mellan alla områden; inga krav på rensade zoner, dödade fiender eller hjältenivå.
  Svårigheten styrs enbart av monsternivå. Portalen öppnas bara av att alla runor är aktiva. `recommended_level` i data är ren information (tooltip).
- **Modulärt och objektorienterat:** en klass per ansvar. Logik känner inte till DOM/Pixi om den inte måste.
- **Inga globaler.** Allt nås via `Game` / `GameContext`. Kommunikation via den typade `EventBus<GameEvents>`
  (`src/core/EventBus.ts`, `src/core/events.ts`) – inte `window.__rpg`. Undantag: debug-hook `window.__game` i dev.
- **En namnform per event** (inga alias som `death`/`rune_activate`). Nya events läggs till i `GameEvents`.
- **Typad speldata** i `src/data/` (kopia av Speldesigns `/spel/design/`), interface i `src/data/types.ts`, åtkomst via `ctx.data`.
  Saknade id ger fel, inga tysta fallbacks (bossens skada kommer bara från data).
- **En sanning per tillstånd:** dödade monster (även bossar) finns bara i `session.killed`.
- **Sparformatet** är bakåtkompatibelt med legacy `js/save.js` (`rpg_heroes`, `rpg_hero_<id>`, `rpg_save`, `rpg_found`).
- **Assets** som vanliga filer i `public/assets/` (inget base64).
- Svenska UI-texter. Tangenter: Tab karta, H lorebok, M ljud, B/I inventory, Alt visa föremål, Z etiketter på/av.

## Moduler och GameContext

```ts
interface GameContext {
  bus: EventBus<GameEvents>;
  hero: Readonly<HeroState>;
  zone: Readonly<ZoneView>;
  session: Session;
  data: GameData;
  rng: Rng; // seedad slump, Math.random förbjudet
}
interface GameModule {
  init(ctx: GameContext): void;
  dispose(): void;
}
```

En modul skapas i `src/main.ts` och läggs i `modules`; `Game` anropar `init(ctx)` efter att renderaren startat och `dispose()` vid nedstängning.
Moduler läser tillstånd via `ctx` och kommunicerar enbart via `ctx.bus` (emit/on; `on` returnerar en avregistreringsfunktion att anropa i `dispose`).

### Laddning och sparning

Moduler skriver aldrig till `ctx.hero`. `Game.loadHero(save: HeroSave)` laddar hjälte + session (seed, killed, zon, position, runor, stad)
och emit:ar `hero_loaded`; `Game.getSnapshot(): HeroSave` ger en sparbar ögonblicksbild.
`zone_enter { name }` (`'forest' | 'village'`) skickas när zonen är färdigladdad efter `newGame()`, `loadHero()` och portalbyte, och då är `hero.playing = true`.
Fynd (lorebok) registreras per hjälte via `FoundRegistry.markFound` (del av `SaveBackend`, serialiserat); `SaveModule` kopplar in `SerializedSaveBackend(LocalStorageSaveBackend)` med `Game.setSaveBackend(b)`. Bylayouten fås typad via `villageLayout(ctx.data)`.

## Koordinatsystem

- **Världsenheter** = enheten i speldata (`spawnzoner.json`, `portal_by.json`, 3D-versionens meter). `hero.pos`, `zone.runes/portals/colliders`,
  `circle`, `rect`, `width/height` anges alla i världsenheter.
- **Axlar:** `x` österut, `y` söderut (3D-versionens `z`). **Origo** = zonens mitt (skogen: cirkel r = 45; byn: rektangel −31…31).
- **Riktning** `facing` i radianer; framåt = `(sin facing, cos facing)` i `(x, y)`.
- **Rutor:** en iso-ruta = **2 världsenheter** (`TILE_WORLD`, samma som byns `tile_size`; byn är 32 × 32 rutor). En ruta ritas som 128 × 64 px (2:1).
- **Skärm:** `Iso.worldToScreen(x, y)` → `sx = (x − y) / 2 · 64`, `sy = (x + y) / 2 · 32` px relativt världens origo (före kamerans zoom).
  +x går snett ned åt höger, +y snett ned åt vänster på skärmen. Djupsortering på `x + y`.

## Mappar och ägare

```
index.html            Vite-ingång (next/)
public/assets/        grafik/ljud som filer: 2d/ (tiles, dekor, sprites/monster|npc|hero, bakgrund, lorebok), ikoner/, effekter/, sfx/, ui/
src/
  main.ts             skapar Game, registrerar moduler (+ debug-hook window.__game bara i dev)
  core/               Game, EventBus, events (GameEvents), GameContext, GameAuthority, SaveBackend, NoOpFoundRegistry,
                      Rng, entropy (cryptoSeed), Session                                        – U1 (storage/keys/json/assets m.fl. – U2)
  logic/              ren spellogik utan DOM/Pixi: CombatRules, LocalAuthority, HeroModel, Inventory, loot/   – U1
  data/               *.json + types.ts + index.ts                                              – U1 (innehåll: Speldesign)
  render/             Renderer, Iso, Camera, Parallax, Assets (datadriven laddare), DirSprite   – U1
  world/              Zone, ZoneFactory (skog, by)                                              – U1
  entities/           Hero (HeroModel + figur), Monster, MonsterDefs, MonsterFactory           – U1
  systems/            World, SpawnSystem, CombatSystem, MonsterAI (+ boss), LootSystem, PortalSystem – U1
  input/              Input (klick, WASD, Alt/Z, högerklick blockerat)                          – U1
  ui/                 Hud, Tooltip, ItemText, MonsterBar, InventoryUI, LootLabels, ui.css       – U1
  text/               Text (t(key) + data(file,id,field)) och sv.ts – kopplas till U2:s i18n    – U1
  audio/ save/ map/ menu/   ljud, sparning/hjälteplatser, karta (Tab), startmeny                – U2
  lore/               Lorebook (H)                                                              – U2 (tom plats)
legacy-3d/            3D-spelet (kopieras oförändrat till roten av dist/)
scripts/              assemble-pages.mjs (Pages-artefakt + legacy-3d-omdirigering), smoke.mjs (röktest)
.github/workflows/    pages.yml, ci.yml
```

## CI, röktest och assets

- `ci.yml` (PR och grenar utom main): typecheck, lint, format, build, pages och `smoke`.
- `pages.yml` (main): 3D-roten publiceras alltid. `next/` publiceras bara om TS-bygget går igenom (`continue-on-error` + `--allow-missing-next`), och röktestet körs före deploy.
- `scripts/smoke.mjs` (Playwright, headless Chromium) kontrollerar:
  - att roten är spelbar 3D (`__rpg.newGame`);
  - att `next/` startar i skogen (`data-zone`, HUD);
  - att högerklick och Alt blockeras och att Z växlar etiketter;
  - att `/legacy-3d/` omdirigerar till roten.
- Binära assets går aldrig som text genom GitHub-connectorn. De läggs på en egen assets-gren (t.ex. `assets-monster-anims`), som pushas med git och mergas med merge-API:t som en separat PR. Kod-PR:er innehåller bara text.

## Flöde

`Game` skapar `Renderer` och systemen och initierar modulerna. Startmenyn (U2) väljer hjälte och session (seed + killed).
`SpawnSystem.roll(area, session)` ger deterministiska `SpawnSpec` med id `${area}:${spawnpunkt}:${monster}` (boss `${area}:boss`).
Gameplay emit:ar events (`kill`, `loot_drop`, `pickup` …) som ljud, sparning, karta och lorebok lyssnar på.

## Kommandon

`npm run dev` · `npm run build` (→ dist/next) · `npm run pages` (+ 3D på roten) · `npm run smoke` · `npm run typecheck` · `npm run lint` · `npm run format`

## Spellogik, auktoritet och slump (permanent princip)

- **Ren logik i `src/logic/`**: strid (`CombatRules`), loot-rull (`loot/Loot`), XP och progression (`HeroModel`), guld och inventarie (`Inventory`). Ingen DOM, Pixi eller canvas. Allt ska kunna köras på en server. ESLint förbjuder import av pixi/render/ui/input/entities/systems samt `document`/`window`/`localStorage` i `src/logic/**`.
- **`GameAuthority`** (`src/core/GameAuthority.ts`): klienten frågar alltid via detta interface om utfall (träff, skada, block, XP och droppar). Nu används `LocalAuthority` (`src/logic/LocalAuthority.ts`), som kör logiken lokalt. En serverimplementation kan senare läggas bakom samma interface. Ingen backend byggs nu.
- **`SaveBackend`** (`src/core/SaveBackend.ts`): bara ett interface (list/load/save/remove av `HeroSave`). Utvecklare 2 äger sparningen och implementerar det (localStorage nu). Motorn sparar inte själv; den ger `Game.getSnapshot()` och tar emot `Game.loadHero()`.
- **Seedad slump**: `Rng` (`src/core/Rng.ts`) delas ut som `ctx.rng` i GameContext. `Math.random` är förbjudet via ESLint (`no-restricted-properties`). Loot-rullar seedas från rng, och varje drop bär sitt seed för felsökning.
- **Klienten** (`systems/`, `entities/`, `render/`, `ui/`) sköter rörelse, AI-rörelser, effekter och visning, och anropar `GameAuthority` för alla utfall.

## Öppna punkter

- **markFound** är asynkron via core-`SaveBackend`; `SaveModule` registrerar backend med `Game.setSaveBackend()`.
- **U2:** #19 (ljud, sparning, meny, karta) är mergad. #22 (i18n: LocaleManager/DataLocalizer, `locale_changed`) är inte mergad. Autosparning är inte färdig i next/. `Text` får en provider från i18n när #22 är inne.
- **Quests, dialoger och NPC:er** är inte inbyggda: Speldesigns `quests.json`, `dialoger.json` och `npc.json`, UI:s 13 NPC-sprites och quest-legendarer.
- **Amazonens 5 kastspjut** (startutrustning) saknas: `kastspjut` har `subtype: kast` och hoppas över av startutrustningen (`HeroModel.startGear`), och skill 2 (kast) finns inte i 2D än.
- **Tagg `legacy-3d`** saknas (ska vara `git tag legacy-3d cba7d4d`).
- Grenen **`feat/d2-spawn-tooltips`** är inaktuell.
- **`next/` ersätter roten** först när 2D är komplett.
