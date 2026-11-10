import { EventBus } from './EventBus';
import type { GameEvents } from './events';
import type { GameContext, GameModule, HeroSave, HeroState, Vec2, ZoneView } from './GameContext';
import { createSession } from './Session';
import { BIG_WORLD_COORD_EPOCH } from '../world/bigWorld/saveCoordMigrate';
import { Rng } from './Rng';
import type { GameAuthority } from './GameAuthority';
import type { FoundRegistry, SaveBackend } from './SaveBackend';
import { NoOpFoundRegistry } from './NoOpFoundRegistry';
import { CombatRules } from '../logic/CombatRules';
import { heroWorldSpeed, moveWithCollision } from '../logic/heroMovement';
import { LocalAuthority } from '../logic/LocalAuthority';
import { DATA, validateData } from '../data';
import { Hero } from '../entities/Hero';
import type { NpcEntity } from '../entities/NpcEntity';
import type { Monster } from '../entities/Monster';
import { MonsterFactory } from '../entities/MonsterFactory';
import { syncProximitySpawns } from '../systems/SpawnProximity';
import { ForestGroundChunks } from '../world/ForestGroundChunks';
import type { BigWorldStreamGround } from '../world/bigWorld/BigWorldStreamGround';
import { BIG_WORLD_GROUND_VIEW_MARGIN } from '../world/bigWorld/bigWorldConfig';
import { syncBigWorldChunkMonsters, resetBigWorldMonsterSync } from '../world/bigWorld/syncBigWorldChunkMonsters';
import { loadBigWorldRuntime, peekBigWorldRuntime } from '../world/bigWorld/runtime';
import { armRespawnsForKilled, resetMonsterRespawns, tickMonsterRespawns } from '../world/monsterRespawn';
import { smokeMetricsEnabled, smokeQueryEnabled } from '../dev/smokeGate';
import { worldToChunk } from '../world/bigWorld/bigWorldCoords';
import { Input } from '../input/Input';
import { Loot } from '../logic/loot/Loot';
import type { Item } from '../logic/loot/types';
import { AssetStore, dirIndex } from '../render/Assets';
import { Camera } from '../render/Camera';
import { DirSprite } from '../render/DirSprite';
import { buildHeroEquipmentView } from '../render/heroEquipmentView';
import { scaleKForWorldHeightM, shadowRadiusForWorldHeightM, worldHeightMForHeroOrNpc } from '../render/figureWorldHeights';
import type { StripAnimSprite } from '../render/StripAnimSprite';
import { Iso } from '../render/Iso';
import { Parallax } from '../render/Parallax';
import { Renderer } from '../render/Renderer';
import { CombatSystem } from '../systems/CombatSystem';
import { LootSystem } from '../systems/LootSystem';
import { MonsterAI } from '../systems/MonsterAI';
import { PortalSystem } from '../systems/PortalSystem';
import { SpawnSystem } from '../systems/SpawnSystem';
import type { GroundDrop, World } from '../systems/World';
import { Text } from '../text/Text';
import { Hud } from '../ui/Hud';
import { setLoadingProgress } from '../ui/loadingScreen';
import { InventoryUI } from '../ui/InventoryUI';
import { ItemText } from '../ui/ItemText';
import { LootLabels } from '../ui/LootLabels';
import { MonsterBar } from '../ui/MonsterBar';
import { resolveDialogText } from '../npc/dialogResolve';
import { npcHasNewRumor, pickRumorForNpc } from '../rumor/pickRumor';
import { formatRumorText } from '../rumor/rumorText';
import type { ConsequenceRuntime } from '../consequences/types';
import { QuestEngine, type QuestEngineHooks } from '../quest/questEngine';
import { QuestAnchorSystem } from '../systems/QuestAnchorSystem';
import { QuestEncounterSystem } from '../systems/QuestEncounterSystem';
import { applyFactionGreetingTone } from '../npc/factionGreeting';
import { readQuestProgress } from '../quest/questProgress';
import { choiceText, stepText, setQuestLocale } from '../quest/questText';
import { closeLoreBook, isLoreBookOpen } from '../lore/LoreBookGate';
import { isQuestItemProtected, inventoryHasItemId } from '../quest/questItems';
import { QuestLog } from '../ui/QuestLog';
import { NpcBark } from '../ui/NpcBark';
import { NpcDialog } from '../ui/NpcDialog';
import { NpcLabels } from '../ui/NpcLabels';
import { NpcSystem } from '../systems/NpcSystem';
import { WorldAmbientSystem } from '../systems/WorldAmbientSystem';
import { WorldFighterSystem } from '../systems/WorldFighterSystem';
import { merchantInTradeHours } from '../npc/resolveRoutine';
import { merchantNightGreeting } from '../npc/routineText';
import { getNpcLocale } from '../npc/npcText';
import { routineForNpc } from '../npc/npcRoutineCatalog';
import { Tooltip } from '../ui/Tooltip';
import type { TextKey } from '../text/Text';
import { DevCheatsView } from '../dev/DevCheatsView';
import { formatClockTime, GameClock } from '../world/GameClock';
import { DayNightPresenter } from '../world/DayNightPresenter';
import { setSetLocale } from '../data/setText';
import { clockPeriodLabel, setClockLocale } from '../world/clockText';
import { WorldStateService } from '../world/WorldStateService';
import { hydrateWorldStateFromLegacy, parseWorldState } from '../world/worldStateTypes';
import { locomotionPlaybackRate } from '../render/locomotionPlayback';
import { bigWorldCityPortalWorld } from '../world/bigWorld/bigWorldPortals';
import { FOREST_CITY_PORTALS } from '../world/forestConstants';
import { cityPortEntry, cityAreaId, isPlayableCityZone, parseSavedZone, PLAYABLE_CITIES } from '../world/cityZones';
import { ZoneFactory } from '../world/ZoneFactory';
import type { Zone, ZoneName } from '../world/Zone';
import type { LearnEncounter } from '../learn/LearnEncounter';
import { readLearnSettings, writeLearnSettings, parseLearnSettings } from '../learn/settings';
import type { LearnSettings } from '../learn/types';
import { trackChunkLoad } from '../ui/chunkLoad';
import { LocalStore } from './storage';

const CLASS_TINT: Record<string, number> = { riddare: 0xffffff, barbar: 0xffd2b8, amazonkrigare: 0xffe6c8 };

/**
 * Toppnivå: äger bussen, renderaren, systemen och UI. Inga globaler; allt nås via Game-instansen.
 * Moduler (AudioManager, SaveManager, MapUI, StartMenu, Lorebook – Utvecklare 2) får GameContext via init().
 * zone_enter { name } skickas när en zon är färdigladdad: vid newGame, loadHero och portalbyte.
 */
export class Game {
  readonly bus = new EventBus<GameEvents>();
  readonly renderer = new Renderer();
  readonly spawn = new SpawnSystem();
  readonly text = new Text();
  readonly assets = new AssetStore();
  readonly rng = new Rng(Rng.newSeed());
  readonly loot = new Loot(this.text, this.rng);
  readonly authority: GameAuthority = new LocalAuthority(this.loot, new CombatRules(this.loot, this.rng));
  readonly worldState = new WorldStateService();
  private readonly heroState: HeroState = {
    id: null,
    name: '',
    cls: 'riddare',
    level: 1,
    xp: 0,
    gold: 0,
    hp: 1,
    maxHp: 1,
    pos: { x: 0, y: 0 },
    inv: [],
    equip: {},
    stage: 0,
    runes: 0,
    city: 'besatt',
    zone: 'forest',
    facing: Math.PI,
    playing: false,
    resumePos: null,
    fresh: true,
  };
  private readonly zoneView: ZoneView = {
    name: 'forest',
    areaId: 'startskogen',
    width: 90,
    height: 90,
    circle: 45,
    colliders: [],
    runes: [],
    portals: [],
    cleared: {},
  };
  readonly ctx: GameContext;
  private foundRegistry: FoundRegistry = new NoOpFoundRegistry();

  private world: World | null = null;
  private camera!: Camera;
  private parallax!: Parallax;
  private input!: Input;
  private zones!: ZoneFactory;
  private factory!: MonsterFactory;
  private lootSys!: LootSystem;
  private combat!: CombatSystem;
  private ai!: MonsterAI;
  private portals!: PortalSystem;
  private hud!: Hud;
  private tip!: Tooltip;
  private invUI!: InventoryUI;
  private labels!: LootLabels;
  private monBar!: MonsterBar;
  private npcSys!: NpcSystem;
  private worldAmbientSys!: WorldAmbientSystem;
  private worldFighterSys!: WorldFighterSystem;
  private npcDialog!: NpcDialog;
  private npcBark!: NpcBark;
  private npcLabels!: NpcLabels;
  private questLog!: QuestLog;
  private readonly questEngine = new QuestEngine(this.worldState);
  private readonly questAnchors = new QuestAnchorSystem(this.bus, this.questEngine, () => this.questHooks());
  private questEncounters!: QuestEncounterSystem;
  private readonly gameClock = new GameClock(this.bus);
  private dayNight: DayNightPresenter | null = null;
  private switching = false;
  private targetMonster: Monster | null = null;
  private targetDrop: GroundDrop | null = null;
  private dead = false;
  private menuOpen = false;
  private learn: LearnEncounter | null = null;
  private learnSettings: LearnSettings = readLearnSettings(new LocalStore());
  /** Sant när lär-modulen och rätt frågebank finns. Innan dess pausas monster om spelaren är igång. */
  private questionsReady = false;
  private learnWanted = false;
  private learnPrep: Promise<void> | null = null;
  private booting = false;
  private booted = false;
  private decorAnims: StripAnimSprite[] = [];
  private forestGround: ForestGroundChunks | BigWorldStreamGround | null = null;
  private streamMetricsCx = NaN;
  private streamMetricsCy = NaN;

  constructor(private readonly modules: GameModule[] = []) {
    this.ctx = {
      bus: this.bus,
      hero: this.heroState,
      zone: this.zoneView,
      session: createSession(),
      data: DATA,
      rng: this.rng,
      worldState: this.worldState,
      clock: this.gameClock.view,
    };
  }

  /** Capture/smoke: mark- och GPU-statistik i stor skog. */
  captureBigWorldMetrics(): {
    groundReady: boolean;
    displayObjects: number;
    renderTextures: number;
    groundPixel: boolean;
    heroWx: number;
    heroWy: number;
  } | null {
    const w = this.world;
    const fg = this.forestGround;
    if (!w || !this.isStreamGround(fg) || !w.zone.bigWorldStreaming) return null;
    const foot = this.camera.toScreen(w.hero.pos.x, w.hero.pos.y);
    return {
      groundReady: fg.isGroundReady(),
      displayObjects: fg.countGroundDisplayObjects(),
      renderTextures: fg.countRenderTextures(),
      groundPixel: fg.probeGroundPixel(this.renderer.app.renderer, foot.x, foot.y + 28),
      heroWx: w.hero.pos.x,
      heroWy: w.hero.pos.y,
    };
  }

  get session() {
    return this.ctx.session;
  }
  /** Aktuell värld (för tester/debug). */
  get state(): World | null {
    return this.world;
  }

  /** Efter teleport i stor skog: tvinga mark/chunk-sync (röktest + dev). */
  bumpBigWorldHeroPosition(): void {
    const w = this.world;
    const fg = this.forestGround;
    if (!w || !this.isStreamGround(fg) || !w.zone.bigWorldStreaming) return;
    resetBigWorldMonsterSync();
    fg.bumpHeroPosition(w.hero.pos);
    const view = this.camera.viewWorldAabb(BIG_WORLD_GROUND_VIEW_MARGIN);
    fg.sync(w.hero.pos, w.session.worldSeed, w.session.seed, { objects: w.objects, zone: w.zone }, this.renderer.app.renderer, view);
  }

  async start(host: HTMLElement): Promise<void> {
    if (this.booted || this.booting) return;
    this.booting = true;
    await trackChunkLoad('Laddar världen…', async (onProgress) => {
      onProgress(0.2);
      await loadBigWorldRuntime();
      onProgress(1);
    });
    if (this.booted) return;
    this.booted = true;
    const issues = validateData();
    if (issues.length) console.warn('Datavarningar:', issues);
    await this.renderer.init(host);
    await this.assets.load((ratio) => {
      const el = document.getElementById('rk-loading');
      if (el) setLoadingProgress(el, ratio);
    });
    const r = this.renderer;
    this.camera = new Camera(r.world);
    this.parallax = new Parallax(r.background);
    this.zones = new ZoneFactory(this.assets);
    this.factory = new MonsterFactory(this.assets, this.spawn);
    const w = (): World => this.mustWorld();
    this.lootSys = new LootSystem(w, this.assets, () => this.foundRegistry);
    this.questEncounters = new QuestEncounterSystem(this.bus, this.worldState, this.factory, this.lootSys, () => this.world);
    this.combat = new CombatSystem(w, this.lootSys);
    this.worldFighterSys = new WorldFighterSystem(this.assets, this.combat);
    this.ai = new MonsterAI(w, this.combat, this.factory);
    this.portals = new PortalSystem(w, this.assets);
    this.hud = new Hud(this.text);
    this.dayNight = new DayNightPresenter(r.app.stage, r.effects, this.bus, this.gameClock, this.rng);
    this.tip = new Tooltip();
    const itemText = new ItemText(this.loot, this.text);
    this.invUI = new InventoryUI(
      this.loot,
      this.text,
      itemText,
      this.tip,
      this.assets,
      this.bus,
      (t) => this.hud.flash(t),
      (it) => this.dropItemFromInventory(it),
    );
    this.labels = new LootLabels(this.lootSys);
    this.monBar = new MonsterBar(this.text);
    this.npcSys = new NpcSystem(this.assets, this.worldState);
    this.worldAmbientSys = new WorldAmbientSystem(this.assets);
    this.npcDialog = new NpcDialog(this.text, this.bus);
    this.npcBark = new NpcBark();
    this.npcLabels = new NpcLabels(this.text);
    this.questLog = new QuestLog(this.text, this.bus);
    this.labels.onClick = (d) => this.goPickup(d);
    this.portals.onEnter = (z) => this.travel(z);
    this.combat.onBossDefeated = (m) => this.bossDefeated(m);
    this.combat.onHeroDied = () => this.heroDied();
    this.combat.onPatrolAidKill = () => this.patrolAidReward();
    this.ai.onBossStart = (m) => this.bossStart(m);
    this.ai.onBossPhase = (m, ph) => {
      const name = m.def.phases?.[ph]?.name ?? '';
      this.hud.flash(name);
      this.bus.emit('boss_phase', { phase: ph });
    };
    // Kartan (U2, MapView) täcker skärmen med rubrik överst och legend nederst: dölj HUD-delar som annars krockar.
    this.bus.on('map_toggle', ({ open }) => document.body.classList.toggle('map-open', open));
    this.bus.on('ui_open', ({ panel }) => {
      if (panel !== 'menu') return;
      this.menuOpen = true;
      this.learn?.cancel();
      this.learnWanted = true;
      void this.prepareLearn();
    });
    this.bus.on('ui_close', ({ panel }) => {
      if (panel === 'menu') this.menuOpen = false;
    });
    this.bus.on('locale_changed', ({ locale }) => {
      setClockLocale(locale);
      setSetLocale(locale);
      setQuestLocale(locale);
      this.hud.relabel();
      this.invUI.relabel();
    });
    this.bus.on('pickup', ({ itemId }) => {
      const h = this.questHooks();
      if (h) this.questEngine.onPickup(itemId, h);
    });
    this.bus.on('boss_killed', ({ id }) => {
      const h = this.questHooks();
      if (h) this.questEngine.onBossKilled(id, h);
    });
    this.bus.on('zone_enter', ({ areaId }) => {
      this.questAnchors.reset();
      this.questEncounters.reset();
      const h = this.questHooks();
      if (h) this.questEngine.onEnterRegion(areaId, undefined, h);
    });
    this.bus.on('save_failed', () => {
      this.hud.flash(this.text.t('msg.save_failed'));
    });
    this.bindInput(r.app.canvas);
    DevCheatsView.tryCreate(this.input);
    const resize = (): void => {
      this.camera.resize(r.width, r.height);
      this.parallax.resize(r.width, r.height);
      this.dayNight?.resize(r.width, r.height);
    };
    resize();
    r.app.renderer.on('resize', resize);
    r.app.ticker.add((t) => this.tick(Math.min(0.05, t.deltaMS / 1000)));
    for (const m of this.modules) m.init(this.ctx);
    // Utan startmeny (U2) startas en standardhjälte direkt: ?cls=riddare|barbar|amazonkrigare.
    if (!this.world) {
      const cls = new URLSearchParams(location.search).get('cls');
      if (cls && DATA.classes.classes.some((c) => c.id === cls)) this.heroState.cls = cls;
      this.newGame();
    }
  }

  /**
   * Laddar en hjälte (från SaveManager/StartMenu) och startar spelet i sparad zon. Enda sättet för moduler att ändra hjältens tillstånd.
   * Med save.game sätts sessionen (seed + killed) och återupptagningsposition; utan game startas en ny session.
   */
  loadHero(save: HeroSave): void {
    const h = this.heroState;
    Object.assign(h, structuredClone(save.hero));
    const g = save.game;
    const legacyGame = g
      ? {
          seed: g.seed,
          killed: g.killed,
          zone: g.zone,
          pos: g.pos ? ([g.pos.x, g.pos.y] as [number, number]) : null,
          stage: g.stage,
          runes: g.runes,
          city: g.city,
        }
      : null;
    const ws = (save.worldState && parseWorldState(save.worldState)) || hydrateWorldStateFromLegacy(legacyGame, save.foundItems);
    this.worldState.replace(ws);
    h.stage = g?.stage ?? 0;
    h.runes = g?.runes ?? 0;
    h.city = g?.city ?? 'besatt';
    h.zone = g?.zone ?? 'forest';
    h.resumePos = g?.pos ? { ...g.pos } : null;
    h.playing = false;
    const s = g ? createSession(g.seed, g.killed, g.worldSeed ?? g.seed, g.bwCoordEpoch ?? BIG_WORLD_COORD_EPOCH) : createSession();
    this.ctx.session.seed = s.seed;
    this.ctx.session.worldSeed = s.worldSeed;
    this.ctx.session.bwCoordEpoch = s.bwCoordEpoch;
    this.ctx.session.killed.clear();
    for (const id of s.killed) this.ctx.session.killed.add(id);
    resetMonsterRespawns();
    if (h.id) this.bus.emit('hero_loaded', { heroId: h.id });
    this.gameClock.load(g?.worldTime);
    this.applyLearn(save.learn, false);
    if (this.camera) {
      this.enterZone(parseSavedZone(h.zone), h.resumePos ?? undefined);
    }
  }

  /** U2:s SaveBackend (#19) registreras här; motorn använder den för fyndregistret (loreboken). */
  setSaveBackend(b: SaveBackend): void {
    this.foundRegistry = b;
  }

  /** Sparbar ögonblicksbild (för SaveManager). */
  getSnapshot(): HeroSave {
    const h = this.heroState;
    return {
      hero: {
        id: h.id,
        name: h.name,
        cls: h.cls,
        level: h.level,
        xp: h.xp,
        gold: h.gold,
        inv: structuredClone(h.inv),
        equip: structuredClone(h.equip),
        fresh: h.fresh,
      },
      game: {
        seed: this.ctx.session.seed,
        worldSeed: this.ctx.session.worldSeed,
        killed: [...this.ctx.session.killed],
        zone: h.zone,
        pos: { ...h.pos },
        stage: h.stage,
        runes: h.runes,
        city: h.city,
        worldTime: this.gameClock.timeSeconds,
        bwCoordEpoch: this.ctx.session.bwCoordEpoch ?? BIG_WORLD_COORD_EPOCH,
      },
      worldState: this.worldState.snapshot(),
      learn: this.learnSettings,
    };
  }

  /** Sparar nivå och ämne. Pågående fråga byts inte. */
  setLearnSettings(settings: LearnSettings): void {
    this.applyLearn(settings, true);
  }

  private applyLearn(raw: LearnSettings | undefined, emit: boolean): void {
    const parsed = raw ? parseLearnSettings(raw) : null;
    if (!parsed) return;
    const same =
      parsed.grade === this.learnSettings.grade &&
      parsed.subject === this.learnSettings.subject &&
      parsed.readAloud === this.learnSettings.readAloud;
    this.learnSettings = parsed;
    writeLearnSettings(new LocalStore(), parsed);
    this.learn?.setSettings(parsed);
    if (emit) this.bus.emit('learn_settings', parsed);
    if (!same || !this.questionsReady) {
      this.questionsReady = false;
      this.learnWanted = true;
      void this.prepareLearn();
    }
  }

  /** Laddar lär-modul och frågebank innan första frågan. Pågående laddning delas. */
  private prepareLearn(): Promise<void> {
    if (this.questionsReady) return Promise.resolve();
    if (this.learnPrep) return this.learnPrep;
    const settings = this.learnSettings;
    this.learnPrep = this.finishLearn(settings).finally(() => {
      this.learnPrep = null;
      if (!this.questionsReady && this.learnWanted) void this.prepareLearn();
    });
    return this.learnPrep;
  }

  private async finishLearn(settings: LearnSettings): Promise<void> {
    const { preloadLearnForPlay } = await import('../learn/preloadLearn');
    await preloadLearnForPlay(settings);
    if (this.learnSettings.subject !== settings.subject || this.learnSettings.grade !== settings.grade) return;
    if (!this.learn) {
      const { LearnEncounter } = await import('../learn/LearnEncounter');
      const enc = new LearnEncounter(
        () => this.mustWorld(),
        this.combat,
        this.ai,
        this.learnSettings,
        () => this.learnBlocked(),
        () => this.heroDied(),
      );
      enc.overlaySettings.onSettings = (s) => this.setLearnSettings(s);
      this.learn = enc;
    } else this.learn.setSettings(this.learnSettings);
    this.questionsReady = true;
  }

  private isStreamGround(g: unknown): g is BigWorldStreamGround {
    const Ctor = peekBigWorldRuntime()?.BigWorldStreamGround;
    return !!Ctor && g instanceof Ctor;
  }

  private learnBlocked(): boolean {
    return (
      this.menuOpen ||
      this.dead ||
      this.switching ||
      this.npcDialog.isOpen ||
      this.invUI.isOpen() ||
      this.questLog.isOpen ||
      isLoreBookOpen()
    );
  }

  /** Nytt game (D2): ny seed, tomma killed, runor nollställs, start i skogen. Hjälte och utrustning behålls. */
  newGame(): void {
    const worldSeed = this.ctx.session.worldSeed;
    this.ctx.session.seed = Rng.newSeed();
    this.ctx.session.worldSeed = worldSeed;
    this.ctx.session.killed.clear();
    resetMonsterRespawns();
    const h = this.heroState;
    h.runes = 0;
    h.stage = 0;
    h.city = 'besatt';
    h.resumePos = null;
    this.worldState.resetForNewRun();
    this.worldState.setRunesActive(0);
    for (const z of PLAYABLE_CITIES) this.worldState.setCityState(cityAreaId(z), 'besatt');
    this.gameClock.resetForNewHero();
    this.bus.emit('new_game', { seed: this.ctx.session.seed });
    this.enterZone('forest');
  }

  dispose(): void {
    this.learn?.dispose();
    for (const m of this.modules) m.dispose();
    this.input.dispose();
    this.hud.dispose();
    this.tip.dispose();
    this.invUI.dispose();
    this.labels.dispose();
    this.monBar.dispose();
    this.npcDialog.dispose();
    this.npcBark.dispose();
    this.npcLabels.dispose();
    this.npcSys.dispose();
    this.dayNight?.destroy();
    this.bus.clear();
    this.renderer.destroy();
  }

  // ---------- zoner ----------
  private mustWorld(): World {
    if (!this.world) throw new Error('Ingen zon laddad');
    return this.world;
  }

  private travel(target: ZoneName): void {
    if (this.switching) return;
    this.switching = true;
    const from = this.heroState.zone as ZoneName;
    const fade = document.getElementById('fade');
    fade?.classList.add('on');
    setTimeout(() => {
      this.enterZone(target, this.portalSpawn(target, from));
      fade?.classList.remove('on');
      setTimeout(() => (this.switching = false), 800);
    }, 380);
  }

  private portalSpawn(target: ZoneName, from: ZoneName): Vec2 | undefined {
    const bigWorld = this.world?.zone.bigWorldStreaming === true;
    if (target === 'forest') {
      if (from === 'village') return { x: 0, y: 4 };
      if (isPlayableCityZone(from)) {
        const p = bigWorld ? bigWorldCityPortalWorld(from) : FOREST_CITY_PORTALS[from];
        return {
          x: p.x + (p.x === 0 ? 0 : p.x > 0 ? -4 : 4),
          y: p.y + (p.y === 0 ? 0 : p.y > 0 ? -4 : 4),
        };
      }
    }
    if (from === 'forest' && isPlayableCityZone(target)) return cityPortEntry(target).entry;
    return undefined;
  }

  /** Bygger zonen, placerar hjälten, befolkar monster och skickar zone_enter när allt är klart. */
  enterZone(name: ZoneName, spawn?: Vec2): void {
    this.learn?.cancel();
    const r = this.renderer;
    r.ground.removeChildren().forEach((c) => c.destroy({ children: true }));
    r.objects.removeChildren().forEach((c) => c.destroy({ children: true }));
    const torchLayer = this.dayNight?.torchLayer;
    for (const c of [...r.effects.children]) {
      if (c === torchLayer) continue;
      r.effects.removeChild(c);
      c.destroy({ children: true });
    }
    this.dayNight?.attachWorldEffects(r.effects);
    const built = this.zones.build(name);
    r.ground.addChild(built.ground);
    this.forestGround = built.ground instanceof ForestGroundChunks || this.isStreamGround(built.ground) ? built.ground : null;
    for (const d of built.decor) r.objects.addChild(d);
    this.decorAnims = built.decorAnims;
    const hs = this.heroState;
    const heroSet = this.assets.heroes.setFor(hs.cls);
    const heroHm = worldHeightMForHeroOrNpc();
    const heroView = new DirSprite(heroSet, scaleKForWorldHeightM(heroSet, heroHm), shadowRadiusForWorldHeightM(heroHm));
    heroView.sprite.tint = this.assets.heroes.hasDedicated(hs.cls) ? 0xffffff : (CLASS_TINT[hs.cls] ?? 0xffffff);
    r.objects.addChild(heroView);
    const hero =
      this.world && this.world.hero.inv.bag === hs.inv && this.world.hero.cls.id === hs.cls
        ? this.rebindHero(this.world.hero, heroView)
        : new Hero(hs, this.loot, heroView);
    this.syncHeroEquipmentView(hero);
    hero.inv.onChange = () => {
      hero.recalc();
      this.syncHeroEquipmentView(hero);
      if (this.invUI.isOpen()) this.invUI.render();
    };
    const zone: Zone = built.zone;
    this.world = {
      bus: this.bus,
      session: this.session,
      L: this.loot,
      rng: this.rng,
      authority: this.authority,
      text: this.text,
      hero,
      zone,
      monsters: [],
      worldFighters: [],
      spawnQueue: [],
      drops: [],
      projectiles: [],
      objects: r.objects,
      effects: r.effects,
      fb: { flash: (t, c) => this.hud.flash(t, c), float: (p, t, k, l) => this.hud.float(p, t, k, l) },
      time: 0,
    };
    const p = spawn ?? zone.entry;
    hs.pos.x = p.x;
    hs.pos.y = p.y;
    zone.collide(hs.pos, 0.5);
    hs.zone = name;
    if (name === 'village' && hs.stage < 2) hs.stage = 2;
    hero.clearAttack();
    hero.view.playbackRate = 1;
    hero.moveTarget = null;
    this.targetMonster = null;
    this.targetDrop = null;
    const areaId = zone.areaId;
    const citySpawn = this.worldState.get().city_states[areaId] ?? (areaId === 'gamla_byn' ? hs.city : 'besatt');
    this.factory.populate(this.world, citySpawn);
    armRespawnsForKilled(this.world.session.killed);
    if (zone.bigWorldStreaming && this.isStreamGround(this.forestGround)) {
      resetBigWorldMonsterSync();
      const view = this.camera.viewWorldAabb(BIG_WORLD_GROUND_VIEW_MARGIN);
      this.forestGround.sync(
        hs.pos,
        this.session.worldSeed,
        this.session.seed,
        { objects: r.objects, zone },
        this.renderer.app.renderer,
        view,
      );
      syncBigWorldChunkMonsters(this.world, this.forestGround.chunkCache, this.factory, this.session.worldSeed, this.session.seed, hs.pos);
      syncProximitySpawns(this.world, this.factory, hs.pos, citySpawn);
    } else {
      syncProximitySpawns(this.world, this.factory, hs.pos, citySpawn);
    }
    this.portals.attach(built.runeSprites);
    this.parallax.set(
      this.assets.backgrounds.get('himmel'),
      this.assets.backgrounds.get(name === 'village' ? 'fjarran_portalby' : 'fjarran_skog'),
    );
    this.camera.snap(hs.pos);
    this.hud.boss(null);
    this.invUI.setHero(hero);
    this.syncZoneView(zone);
    this.dead = false;
    hs.playing = true;
    this.npcSys.setWorldTime(this.gameClock.timeSeconds);
    this.npcSys.sync(this.world);
    this.worldAmbientSys.sync(this.world, this.ctx.session.seed);
    this.worldFighterSys.sync(this.world, this.ctx.session.seed);
    const zoneMsgKey: TextKey =
      name === 'village'
        ? 'msg.zone_village'
        : name === 'forest'
          ? 'msg.zone_forest'
          : name === 'wolfstead'
            ? 'msg.zone_wolfstead'
            : name === 'dimmerstrand'
              ? 'msg.zone_dimmerstrand'
              : name === 'kopparberg'
                ? 'msg.zone_kopparberg'
                : name === 'askeborg'
                  ? 'msg.zone_askeborg'
                  : 'msg.zone_forest';
    this.hud.flash(this.text.t(zoneMsgKey));
    // DOM-signal för röktestet (ingen global): zon laddad och spelbar.
    document.documentElement.dataset.zone = name;
    if (zone.bigWorldStreaming) document.documentElement.dataset.bigWorld = '1';
    else delete document.documentElement.dataset.bigWorld;
    document.documentElement.dataset.runes = String(zone.runes.length);
    this.bus.emit('zone_enter', { name, areaId: zone.areaId });
  }

  private rebindHero(h: Hero, view: DirSprite): Hero {
    h.view = view;
    return h;
  }

  private syncHeroEquipmentView(hero: Hero): void {
    const view = buildHeroEquipmentView(hero.cls.id, this.assets.heroes.knightEquipment, hero.inv.equip, this.loot);
    hero.view.setEquipmentView(view);
  }

  private syncZoneView(z: Zone): void {
    const v = this.zoneView as ZoneView & Record<string, unknown>;
    delete v.circle;
    delete v.rect;
    Object.assign(v, {
      name: z.name,
      areaId: z.areaId,
      width: z.width,
      height: z.height,
      colliders: z.colliders,
      runes: z.runes,
      portals: z.portals,
      cleared: z.cleared,
      arena: z.arena,
      bigWorldStreaming: z.bigWorldStreaming,
    });
    if (z.circle) v.circle = z.circle;
    if (z.rect) v.rect = z.rect;
  }

  // ---------- boss / död ----------
  private bossName(m: Monster): string {
    return this.text.data('monsterfamiljer', m.id, 'name', m.def.name);
  }
  private bossStart(m: Monster): void {
    this.heroState.stage = 3;
    this.hud.flash(this.text.t('msg.boss_wakes', { name: this.bossName(m) }), '#ff5566');
    this.bus.emit('boss_start', undefined);
    this.bus.emit('boss_phase', { phase: 0 });
  }
  private bossDefeated(m: Monster): void {
    this.heroState.stage = 4;
    this.heroState.city = 'rensad';
    this.bus.emit('boss_killed', { id: m.id });
    this.bus.emit('city_state_changed', { city: 'gamla_byn', state: 'rensad' });
    this.hud.boss(null);
    this.hud.flash(this.text.t('msg.boss_dead', { name: this.bossName(m) }), '#c7a35a');
  }
  private heroDied(): void {
    this.learn?.cancel();
    this.learn?.closeSettings();
    const w = this.world;
    w?.hero.clearAttack();
    this.dead = true;
    this.hud.flash(this.text.t('msg.died'), '#ff6060');
  }
  private patrolAidReward(): void {
    const w = this.world;
    if (!w) return;
    const gold = 6 + Math.floor(w.rng.float(0, 5));
    w.hero.s.gold += gold;
    const ws = this.worldState.snapshot();
    ws.faction_rep.de_kvarvarande = (ws.faction_rep.de_kvarvarande ?? 0) + 2;
    ws.flags.helped_forest_patrol = true;
    this.worldState.replace(ws);
    w.fb.flash(this.text.t('msg.patrol_aid'));
    w.fb.float(w.hero.pos, w.text.t('msg.gold', { amount: gold }), 'gold', 90);
  }
  private respawn(): void {
    const h = this.mustWorld().hero;
    h.s.hp = h.stats.maxHp;
    this.enterZone('forest');
  }

  // ---------- input ----------
  private bindInput(canvas: HTMLCanvasElement): void {
    const i = (this.input = new Input(canvas));
    const toggleInv = (): void => this.invUI.toggle();
    i.bind('KeyB', () => {
      if (this.learn?.blocksInput()) return;
      toggleInv();
    });
    i.bind('KeyI', () => {
      if (this.learn?.blocksInput()) return;
      toggleInv();
    });
    i.bind('Escape', () => {
      if (this.learn?.busy()) return;
      if (this.npcDialog.isOpen) {
        this.npcDialog.close();
        this.bus.emit('ui_close', { panel: 'npc' });
        return;
      }
      if (this.questLog.isOpen) {
        this.questLog.close();
        this.bus.emit('ui_close', { panel: 'quests' });
        return;
      }
      if (isLoreBookOpen()) {
        closeLoreBook();
        this.bus.emit('ui_close', { panel: 'lore' });
        return;
      }
      if (this.invUI.isOpen()) {
        this.invUI.close();
        return;
      }
      this.learn?.toggleSettings();
    });
    i.bind('KeyJ', () => {
      if (this.learn?.blocksInput() || this.npcDialog.isOpen) return;
      this.questLog.toggle();
      this.bus.emit(this.questLog.isOpen ? 'ui_open' : 'ui_close', { panel: 'quests' });
    });
    i.bind('KeyF', () => {
      if (this.learn?.blocksInput()) return;
      this.tryTalkNpc();
    });
    for (let n = 1; n <= 4; n++) {
      const slot = n - 1;
      i.bind(`Digit${n}`, () => {
        if (this.learn?.isQuestion()) {
          this.learn.answer(slot);
          return;
        }
        if (this.learn?.blocksInput()) return;
        if (this.input.altHeld && (n === 3 || n === 4)) {
          this.quaff(n === 3 ? 'hp' : 'st');
          return;
        }
        this.combat.useBarSkill(slot, true);
      });
      i.bind(`up:Digit${n}`, () => {
        if (this.learn?.blocksInput()) return;
        this.combat.useBarSkill(slot, false);
      });
    }
    i.bind('KeyE', () => {
      if (this.learn?.blocksInput()) return;
      const n = this.portals.nearRune();
      if (n >= 0) this.portals.activate(n, false);
    });
    const tryDodge = (): void => this.tryDodge();
    i.bind('Space', tryDodge);
    const shiftDodge = (): void => {
      const k = this.input;
      if (k.isDown('KeyW') || k.isDown('KeyA') || k.isDown('KeyS') || k.isDown('KeyD')) return;
      tryDodge();
    };
    i.bind('ShiftLeft', shiftDodge);
    i.bind('ShiftRight', shiftDodge);
    i.bind('KeyQ', () => {
      if (this.learn?.blocksInput()) return;
      this.combat.skill(true);
    });
    i.bind('up:KeyQ', () => this.combat.skill(false));
    i.bind('reset', () => this.combat.skill(false));
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.world) return;
      if (this.learn?.blocksInput()) return;
      if (this.dead) return this.respawn();
      if (e.button === 2) return this.combat.skill(true);
      if (e.button === 0) this.worldClick();
    });
    canvas.addEventListener('pointerup', (e) => {
      if (e.button === 2) this.combat.skill(false);
    });
  }

  private quaff(kind: 'hp' | 'st'): void {
    const h = this.world?.hero;
    if (!h) return;
    const it = h.inv.findConsumable(kind);
    if (it) h.use(it);
    else this.hud.flash(this.text.t('msg.no_proviant'));
  }

  private monsterAt(sx: number, sy: number): Monster | null {
    const w = this.world;
    if (!w) return null;
    let best: Monster | null = null;
    let bd = Infinity;
    for (const m of w.monsters) {
      if (m.dead) continue;
      const foot = this.camera.toScreen(m.pos.x, m.pos.y);
      const hgt = m.view.height2 * this.camera.zoom;
      const halfW = Math.max(26, hgt * 0.35);
      if (sx < foot.x - halfW || sx > foot.x + halfW || sy > foot.y + 12 || sy < foot.y - hgt) continue;
      const d = Math.abs(sx - foot.x) + Math.abs(sy - (foot.y - hgt / 2));
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  }
  private dropItemFromInventory(it: Item): void {
    const w = this.mustWorld();
    if (isQuestItemProtected(it)) {
      this.hud.flash(this.text.t('inv.quest_no_drop'));
      return;
    }
    const inv = w.hero.inv;
    if (inv.bag.includes(it) || inv.slotOfItem(it)) inv.detach(it);
    this.lootSys.dropFromHero(it);
    this.invUI.itemDropped(it);
  }

  private dropAt(sx: number, sy: number): GroundDrop | null {
    const w = this.world;
    if (!w) return null;
    for (const d of w.drops) {
      const p = this.camera.toScreen(d.pos.x, d.pos.y, 8);
      if (Math.abs(p.x - sx) < 22 && Math.abs(p.y - sy) < 18) return d;
    }
    return null;
  }

  private consequenceRuntime(): ConsequenceRuntime {
    return {
      grantItem: (itemId) => this.grantConsequenceItem(itemId),
      grantXp: (amount) => {
        const w = this.world;
        if (!w) return;
        const ups = w.hero.gainXp(amount);
        if (ups) {
          this.hud.flash(this.text.t('msg.level_up', { level: w.hero.level }));
          this.bus.emit('level_up', { level: w.hero.level });
        }
      },
      notify: (message) => this.hud.flash(message),
    };
  }

  private grantConsequenceItem(itemId: string): boolean {
    const w = this.world;
    if (!w) return false;
    const it = w.L.makeItem(itemId, { ilvl: Math.max(1, w.hero.s.level) });
    if (!w.hero.inv.add(it)) return false;
    const b = w.L.base(it);
    const name = w.text.data('loot_bases', b.id, 'name', b.name);
    w.fb.flash(w.text.t('msg.found', { name }));
    return true;
  }

  private flushPendingItemGrants(): void {
    const ws = this.worldState.snapshot();
    let changed = false;
    for (const key of Object.keys(ws.flags)) {
      if (!key.startsWith('item_grant_pending:') || !ws.flags[key]) continue;
      const itemId = key.slice('item_grant_pending:'.length);
      if (this.grantConsequenceItem(itemId)) {
        ws.flags[key] = false;
        changed = true;
      }
    }
    if (changed) this.worldState.replace(ws);
  }

  private questHooks(): QuestEngineHooks | null {
    const w = this.world;
    if (!w) return null;
    const inv = w.hero.inv;
    return {
      worldTime: this.gameClock.timeSeconds,
      region: w.zone.areaId,
      hasItem: (id) => inventoryHasItemId(inv, id),
    };
  }

  private refreshQuestLog(): void {
    const { active, done } = this.questEngine.activeAndCompleted();
    this.questLog.update(this.worldState.get(), active, done);
  }

  private npcRumorSparks(_w: World): Set<string> {
    const day = this.gameClock.day;
    const ctx = { world: this.worldState.get(), day };
    const out = new Set<string>();
    for (const n of this.npcSys.entities()) {
      const id = n.resolved.def.id;
      if (npcHasNewRumor(id, ctx, this.worldState.lastRumorForNpc(id))) out.add(id);
    }
    return out;
  }

  private openNpcDialog(ent: NpcEntity): void {
    const w = this.world;
    if (!w) return;
    const d = Math.hypot(ent.resolved.pos.x - w.hero.pos.x, ent.resolved.pos.y - w.hero.pos.y);
    if (d > 3.2) {
      w.fb.flash(w.text.t('msg.too_far'));
      return;
    }
    w.hero.moveTarget = null;
    this.targetMonster = null;
    this.targetDrop = null;
    const hooks = this.questHooks();
    if (hooks) {
      this.questEngine.onNpcTalk(ent.resolved.def.id, hooks);
      this.refreshQuestLog();
      const pending = this.questEngine.pendingChoices(ent.resolved.def.id, hooks);
      const block = pending[0];
      if (block) {
        const prog = readQuestProgress(this.worldState.get(), block.quest.id);
        const step = block.quest.steg.find((s) => s.id === prog.steg);
        const body = step ? stepText(block.quest, step) : block.quest.beskrivning;
        const options = block.choices.map((c) => ({ id: c.id, label: choiceText(block.quest, c) }));
        this.npcDialog.showChoices(ent.resolved, this.assets.npcPortraitUrl(ent.resolved.sprite), body, options, (choiceId) => {
          this.questEngine.applyChoice(block.quest.id, choiceId, hooks, this.consequenceRuntime());
          this.refreshQuestLog();
        });
        this.bus.emit('ui_open', { panel: 'npc' });
        return;
      }
    }
    const day = this.gameClock.day;
    this.worldState.setGameDay(day);
    const ctx = { world: this.worldState.get(), day };
    const npcId = ent.resolved.def.id;
    const last = this.worldState.lastRumorForNpc(npcId);
    const rumor = pickRumorForNpc(npcId, ctx, last);
    let greeting = applyFactionGreetingTone(npcId, ctx.world, resolveDialogText(ent.resolved.def, 'halsning', ctx, w.text));
    const routine = routineForNpc(npcId);
    if (routine?.roll === 'handlare' && !merchantInTradeHours(npcId, this.gameClock.timeSeconds)) {
      greeting = `${merchantNightGreeting(npcId, getNpcLocale())}\n\n${greeting}`;
    }
    const heroName = this.heroState.name.trim() || 'Hjälten';
    const body = rumor ? formatRumorText(rumor, { heroName, text: w.text, world: ctx.world }) : greeting;
    if (rumor) this.worldState.recordRumorSpoken(npcId, rumor.id);
    this.npcDialog.show(ent.resolved, this.assets.npcPortraitUrl(ent.resolved.sprite), body);
    this.bus.emit('ui_open', { panel: 'npc' });
  }

  private tryDodge(): void {
    const w = this.world;
    if (!w || this.dead || this.learn?.blocksInput() || this.npcDialog.isOpen || this.invUI.isOpen() || isLoreBookOpen()) return;
    const h = w.hero;
    if (!this.input.overCanvas()) return;
    const mouse = this.camera.toWorld(this.input.mouse.x, this.input.mouse.y);
    const dod = h.view.getAnim('dod');
    const animDur = dod?.frames[0]?.length && dod.fps ? dod.frames[0].length / dod.fps : 0;
    if (!h.tryDodge(mouse.x - h.pos.x, mouse.y - h.pos.y, animDur)) return;
    h.view.play('dod', true);
    this.bus.emit('dodge', { classId: h.cls.id });
  }

  private tryTalkNpc(): void {
    const w = this.world;
    if (!w || this.npcDialog.isOpen) return;
    const n = this.npcSys.nearest(w);
    if (n) this.openNpcDialog(n);
  }

  private worldClick(): void {
    if (this.learn?.blocksInput() || this.invUI.holding || this.npcDialog.isOpen || isLoreBookOpen()) return;
    const { x, y } = this.input.mouse;
    const w = this.world;
    if (w) {
      const npc = this.npcSys.pickAt(x, y, this.camera);
      if (npc) return this.openNpcDialog(npc);
    }
    const d = this.dropAt(x, y);
    if (d && !d.data.gold) return this.goPickup(d);
    const m = this.monsterAt(x, y);
    this.targetDrop = null;
    if (m) {
      this.targetMonster = m;
      return;
    }
    this.targetMonster = null;
    this.mustWorld().hero.moveTarget = this.camera.toWorld(x, y);
  }

  private goPickup(d: GroundDrop): void {
    this.targetDrop = d;
    this.targetMonster = null;
    this.mustWorld().hero.moveTarget = { ...d.pos };
  }

  // ---------- spelloop ----------
  private tick(dt: number): void {
    const w = this.world;
    if (!w) return;
    w.time += dt;
    tickMonsterRespawns(w, dt);
    this.gameClock.advance(dt);
    this.worldState.setGameDay(this.gameClock.day);
    this.worldState.tickPending(this.gameClock.day, this.consequenceRuntime());
    this.dayNight?.update(dt, w.zone.name);
    this.flushPendingItemGrants();
    this.questAnchors.update(w);
    const qh = this.questHooks();
    if (qh) this.questEncounters.update(w, qh);
    const h = w.hero;
    if (h.s.playing) this.heroUpdate(dt);
    if (h.s.playing) this.camera.follow(h.pos, dt);
    if (this.isStreamGround(this.forestGround)) {
      const view = this.camera.viewWorldAabb(BIG_WORLD_GROUND_VIEW_MARGIN);
      this.forestGround.sync(
        h.pos,
        w.session.worldSeed,
        w.session.seed,
        { objects: w.objects, zone: w.zone },
        this.renderer.app.renderer,
        view,
      );
      syncBigWorldChunkMonsters(w, this.forestGround.chunkCache, this.factory, w.session.worldSeed, w.session.seed, h.pos);
      const citySpawn = this.worldState.get().city_states[w.zone.areaId] ?? (w.zone.areaId === 'gamla_byn' ? h.s.city : 'besatt');
      syncProximitySpawns(w, this.factory, h.pos, citySpawn);
      const hc = worldToChunk(h.pos.x, h.pos.y);
      const fg = this.forestGround;
      if (smokeMetricsEnabled()) {
        document.documentElement.dataset.heroWx = h.pos.x.toFixed(1);
        document.documentElement.dataset.heroWy = h.pos.y.toFixed(1);
        if (hc.cx !== this.streamMetricsCx || hc.cy !== this.streamMetricsCy) {
          this.streamMetricsCx = hc.cx;
          this.streamMetricsCy = hc.cy;
          const foot = this.camera.toScreen(h.pos.x, h.pos.y);
          document.documentElement.dataset.heroChunk = `${hc.cx},${hc.cy}`;
          document.documentElement.dataset.groundObjects = String(fg.countGroundDisplayObjects());
          document.documentElement.dataset.renderTextures = String(fg.countRenderTextures());
          document.documentElement.dataset.groundReady = fg.isGroundReady() ? '1' : '0';
          if (fg.isGroundReady()) {
            document.documentElement.dataset.groundPixel = fg.probeGroundPixel(this.renderer.app.renderer, foot.x, foot.y + 28) ? '1' : '0';
          }
        } else if (fg.isGroundReady() && document.documentElement.dataset.groundReady !== '1') {
          document.documentElement.dataset.groundReady = '1';
          const foot = this.camera.toScreen(h.pos.x, h.pos.y);
          document.documentElement.dataset.groundPixel = fg.probeGroundPixel(this.renderer.app.renderer, foot.x, foot.y + 28) ? '1' : '0';
        }
      }
    } else {
      this.forestGround?.sync(h.pos);
      const citySpawn = this.worldState.get().city_states[w.zone.areaId] ?? (w.zone.areaId === 'gamla_byn' ? h.s.city : 'besatt');
      syncProximitySpawns(w, this.factory, h.pos, citySpawn);
    }
    // Frågorna får inte hoppas över medan banken laddas. Menyn startar laddningen; innan dess står monster stilla.
    const holdLearn = w.hero.s.playing && !this.questionsReady;
    // I röktest ska hjälten kunna gå ut ur lägerflocken så chunk-streamingen kan verifieras.
    const freezeAi = holdLearn || smokeQueryEnabled();
    if (freezeAi) {
      this.ai.paused = true;
      if (holdLearn && this.learnWanted) void this.prepareLearn();
    }
    this.ai.update(dt);
    this.learn?.tick(dt);
    if (freezeAi) this.ai.paused = true;
    this.combat.update(dt);
    this.lootSys.update(dt);
    this.portals.update(dt);
    if (!this.isStreamGround(this.forestGround)) this.camera.follow(h.pos, dt);
    this.parallax.update(this.camera.pos);
    this.hud.update(dt, h, this.camera, {
      period: clockPeriodLabel(this.gameClock.view.isNight),
      time: formatClockTime(this.gameClock.timeSeconds),
    });
    this.labels.update(w.drops, this.input.altHeld || this.input.labelsToggled, this.camera);
    this.npcLabels.update(this.npcSys.entities(), this.camera, this.npcRumorSparks(w));
    this.npcSys.setWorldTime(this.gameClock.timeSeconds);
    this.npcSys.update(dt, w);
    this.worldAmbientSys.update(dt, w);
    this.worldFighterSys.update(dt, w);
    this.npcSys.updateBarks(w, w.text, this.npcDialog.isOpen, (line, x, y) => this.npcBark.show(line, x, y));
    this.npcBark.update(dt, this.camera);
    this.refreshQuestLog();
    for (const a of this.decorAnims) a.update(dt);
    this.hoverUpdate();
    const boss = w.monsters.find((m) => m.boss && m.active && !m.dead);
    if (boss)
      this.hud.boss(
        this.bossName(boss),
        boss.hp / boss.max,
        this.text.t('monster.phase', { n: boss.phase + 1, name: boss.def.phases?.[boss.phase]?.name ?? '' }),
      );
  }

  private heroUpdate(dt: number): void {
    const w = this.mustWorld();
    const h = w.hero;
    if (this.npcDialog.isOpen || isLoreBookOpen()) {
      h.regen(dt);
      h.moveTarget = null;
      return;
    }
    const s = h.s;
    h.regen(dt);
    const learnFreeze = this.learn?.blocksMovement() === true;
    if (learnFreeze) {
      h.moveTarget = null;
      this.targetMonster = null;
      this.targetDrop = null;
      h.moving = false;
    }
    let sprinting = false;
    if (!learnFreeze && h.dodging()) {
      h.pos.x += h.dodgeVx * dt;
      h.pos.y += h.dodgeVy * dt;
      w.zone.collide(h.pos, 0.5);
      h.moveTarget = null;
      h.moving = false;
      this.targetMonster = null;
      this.targetDrop = null;
    } else if (!learnFreeze) {
      // fortsatt klick-och-håll styr mot muspekaren (D2)
      if (this.input.leftDown && !this.targetMonster && !this.targetDrop && !this.invUI.holding && this.input.overCanvas())
        h.moveTarget = this.camera.toWorld(this.input.mouse.x, this.input.mouse.y);
      let vx = 0;
      let vy = 0;
      const k = this.input;
      const sx = (k.isDown('KeyD') ? 1 : 0) - (k.isDown('KeyA') ? 1 : 0);
      const sy = (k.isDown('KeyS') ? 1 : 0) - (k.isDown('KeyW') ? 1 : 0);
      if (sx || sy) {
        // skärmriktning → värld (iso): skärm-x = x − y, skärm-y = (x + y)/2
        vx = sx / 2 + sy;
        vy = -sx / 2 + sy;
        h.moveTarget = null;
        this.targetMonster = null;
        this.targetDrop = null;
      }
      const tm = this.targetMonster;
      if (tm && (tm.dead || !w.monsters.includes(tm))) this.targetMonster = null;
      if (this.targetMonster) {
        const m = this.targetMonster;
        const d = Math.hypot(m.pos.x - h.pos.x, m.pos.y - h.pos.y);
        s.facing = Math.atan2(m.pos.x - h.pos.x, m.pos.y - h.pos.y);
        if (d <= h.stats.reach + (m.boss ? 0.6 : 0.2)) {
          h.moveTarget = null;
          if (!this.input.leftDown) this.targetMonster = null;
        } else h.moveTarget = { ...m.pos };
      }
      const td = this.targetDrop;
      if (td) {
        if (!w.drops.includes(td)) this.targetDrop = null;
        else if (Math.hypot(td.pos.x - h.pos.x, td.pos.y - h.pos.y) < 1.3) {
          void this.lootSys.pickup(td);
          this.targetDrop = null;
          h.moveTarget = null;
        }
      }
      if (h.moveTarget && !vx && !vy) {
        const dx = h.moveTarget.x - h.pos.x;
        const dy = h.moveTarget.y - h.pos.y;
        const d = Math.hypot(dx, dy);
        if (d < 0.15) h.moveTarget = null;
        else {
          vx = dx;
          vy = dy;
        }
      }
      const len = Math.hypot(vx, vy);
      h.moving = len > 0 && h.atkT <= 0;
      const sprintCfg = DATA.classes.meta.sprint;
      const wantSprint =
        !h.dodging() && h.dodgeT <= 0 && (k.isDown('ShiftLeft') || k.isDown('ShiftRight')) && h.moving && !h.blocking && !!sprintCfg;
      if (wantSprint) sprinting = true;
      if (h.moving) {
        const runMult = sprinting && sprintCfg ? sprintCfg.speed_mult : 1;
        const sp = heroWorldSpeed({
          baseSpeed: h.stats.speed,
          moveSpeedMult: h.moveSpeedMult(),
          runMult,
          blocking: h.blocking,
          cursed: h.curse > 0,
        });
        const step = Math.min(
          sp * dt,
          h.moveTarget && !this.targetMonster ? Math.hypot(h.moveTarget.x - h.pos.x, h.moveTarget.y - h.pos.y) : Infinity,
        );
        const move = moveWithCollision(h.pos, vx, vy, step, 0.5, (p, r) => w.zone.collide(p, r));
        s.facing = Math.atan2(vx, vy);
        if (h.moveTarget && move.pushedHard) h.moveTarget = null;
        // står hjälten i praktiken still (fast mot hinder eller framme) ska gånganimationen inte spelas
        if (move.stalled) {
          h.moving = false;
          if (!this.targetMonster) h.moveTarget = null;
        }
        if (Math.floor(w.time * 3) !== Math.floor((w.time - dt) * 3)) this.bus.emit('step', undefined);
      }
    }
    if (h.atkPendingHit && h.atkHitT <= 0) this.combat.resolveAttackHit();
    const v = h.view;
    v.dir = dirIndex(Math.sin(s.facing), Math.cos(s.facing));
    if (h.dodgeT > 0 && v.hasAnim('dod')) v.play('dod');
    else if (h.atkT > 0 && v.hasAnim('attack')) v.play('attack');
    else if (h.moving) v.play(sprinting && v.hasAnim('run') ? 'run' : 'gang');
    else v.play('idle');
    v.bobY = h.atkT > 0 && !v.hasAnim('attack') ? -Math.sin((h.atkT / 0.3) * Math.PI) * 6 : 0;
    if (h.atkT <= 0) {
      if (h.moving) {
        const sprintMeta = DATA.classes.meta.sprint;
        const runMult = sprinting && sprintMeta ? sprintMeta.speed_mult : 1;
        const moveSp = heroWorldSpeed({
          baseSpeed: h.stats.speed,
          moveSpeedMult: h.moveSpeedMult(),
          runMult,
          blocking: h.blocking,
          cursed: h.curse > 0,
        });
        const locomote = sprinting && v.hasAnim('run') ? 'run' : 'gang';
        v.playbackRate = locomotionPlaybackRate(v.getAnim(locomote), moveSp);
      } else v.playbackRate = 1;
    }
    v.update(dt);
    v.applyTint(h.blocking || h.shieldDodge ? 0xa0c8ff : (CLASS_TINT[s.cls] ?? 0xffffff));
    const sp = Iso.worldToScreen(h.pos.x, h.pos.y);
    v.position.set(sp.x, sp.y);
    v.zIndex = h.pos.x + h.pos.y;
  }

  private hoverUpdate(): void {
    const w = this.mustWorld();
    if (this.invUI.isOpen() && !this.input.overCanvas()) return;
    const { x, y } = this.input.mouse;
    const over = this.input.overCanvas();
    const m = over ? this.monsterAt(x, y) : null;
    const recent = w.monsters.find((q) => !q.dead && w.time - q.lastHit < 3 && q.lastHit > 0) ?? null;
    this.monBar.show(m ?? this.targetMonster ?? recent);
    if (!over) return;
    const t = this.text;
    if (m) {
      const hc = this.loot.hitChance(w.hero.stats.AR, 15 + 8 * m.lvl + m.defense * 2, w.hero.level, m.lvl);
      this.tip.show(
        `<div class="tn">${this.monBar.name(m)}</div><div class="tb">${t.t('tooltip.level', { level: m.lvl })}</div><div class="tb">${t.t('tooltip.hit_chance', { pct: Math.round(hc * 100) + ' %' })}</div>`,
        x,
        y,
      );
      return;
    }
    const pw = this.camera.toWorld(x, y);
    const rune = w.zone.runes.find((r) => Math.hypot(r.x - pw.x, r.y - pw.y) < 1.6);
    if (rune) {
      this.tip.show(
        `<div class="tn">${t.t('tooltip.rune')}</div><div class="tb">${t.t(rune.active ? 'tooltip.rune_active' : 'tooltip.rune_inactive')}</div>`,
        x,
        y,
      );
      return;
    }
    const portal = w.zone.portals.find((p) => Math.hypot(p.x - pw.x, p.y - pw.y) < 2);
    if (portal) {
      this.tip.show(
        `<div class="tn">${t.t('tooltip.portal')}</div><div class="tb">${t.t(
          (
            {
              village: 'tooltip.portal_to_village',
              wolfstead: 'tooltip.portal_to_wolfstead',
              dimmerstrand: 'tooltip.portal_to_dimmerstrand',
              kopparberg: 'tooltip.portal_to_kopparberg',
              askeborg: 'tooltip.portal_to_askeborg',
            } as const
          )[portal.target as 'wolfstead'] ?? 'tooltip.portal_to_forest',
        )}</div>`,
        x,
        y,
      );
      return;
    }
    const d = this.dropAt(x, y);
    if (d?.data.item) {
      this.tip.show(
        `<div class="tn" style="color:${this.lootSys.color(d.data)}">${this.lootSys.label(d.data)}</div>`,
        x,
        y,
        d.data.item.quality,
      );
      return;
    }
    this.tip.hide();
  }
}
