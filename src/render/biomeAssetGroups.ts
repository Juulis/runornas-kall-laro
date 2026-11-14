/**
 * Alla markplattor och dekor, grupperade så start bara laddar skogen
 * och resten hämtas när ett biom (eller byn) behövs.
 * Id är filnamn utan .png.
 */

export const EDGE_SUFFIXES = ['horn_h', 'horn_n', 'horn_o', 'horn_v', 'nh', 'nh_nv', 'nv', 'nv_ov', 'oh', 'oh_nh', 'ov', 'ov_oh'] as const;

function edgeTiles(prefix: string): readonly string[] {
  return EDGE_SUFFIXES.map((suffix) => `${prefix}_${suffix}`);
}

function unique(lists: readonly (readonly string[])[]): readonly string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const id of list) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Samma 39 plattor som laddades vid start innan lazy-biom. */
export const STARTUP_TILES = [
  'gras_1',
  'gras_2',
  'gras_3',
  'gras_4',
  'gras_blommor_1',
  'gras_blommor_2',
  'gras_till_kullersten',
  'gras_till_kullersten_2',
  'gras_till_kullersten_ov',
  'gras_till_lera',
  'gras_till_lera_ov',
  'gras_till_lera_oh',
  'gras_till_lera_oh_2',
  'gras_till_lera_nh',
  'gras_till_lera_nv',
  'gras_till_skogsbotten',
  'lera_1',
  'lera_2',
  'lera_3',
  'kullersten',
  'kullersten_mossig',
  'mossa_1',
  'mossa_2',
  'aska',
  'ruin_grus',
  'skogsbotten_lov',
  'skogsbotten_ormbunke',
  'skogsbotten_barr_1',
  'skogsbotten_barr_2',
  'skogsbotten_till_kullersten',
  'skogsbotten_till_kullersten_2',
  'skogsbotten_till_kullersten_ov',
  'skogsbotten_till_kullersten_ov_2',
  'skogsbotten_till_kullersten_oh',
  'skogsbotten_till_kullersten_nh',
  'skogsbotten_till_kullersten_nv',
  'skogsbotten_till_lera',
  'stengolv_sprucket_1',
  'stengolv_sprucket_2',
] as const;

/** Träskets egna plattor, inklusive blandningar. */
export const TRASK_TILES = [
  'myr_1',
  'myr_2',
  'myr_3',
  'myr_4',
  'myr_gol_1',
  'myr_gol_2',
  'torv_1',
  'torv_2',
  'vassmark_1',
  'vassmark_2',
  'spang_1',
  'spang_1_j',
  'spang_2',
  'spang_2_j',
  'myr_aska_blandning',
  'myr_mossa_blandning',
  'myr_torv_blandning',
  'myr_vass_blandning',
] as const;

/**
 * Vägytor. Kullersten ligger redan i STARTUP_TILES.
 * Grus och bergsväg hör till fjäll, spång till träsk — skogschunkar med stig
 * måste ändå kunna begära dem. STARTUP_TILES ändras inte.
 */
export const ROAD_TILES = [
  'kullersten',
  'kullersten_mossig',
  'grus_1',
  'grus_2',
  'spang_1',
  'spang_2',
  'bergsvag_1',
  'bergsvag_2',
] as const;

/** Fjällets egna plattor, inklusive blandningar. */
export const FJALL_TILES = [
  'berghall_1',
  'berghall_2',
  'bergsvag_1',
  'bergsvag_2',
  'grus_1',
  'grus_2',
  'ljung_1',
  'ljung_2',
  'ljung_3',
  'ljung_4',
  'snoflack_1',
  'snoflack_2',
  'ljung_berghall_blandning',
  'ljung_grus_blandning',
  'ljung_mossa_blandning',
] as const;

/**
 * Kustens markplattor som inte redan ligger i startup.
 * lera, gras_4 och kullersten laddas med starten. Sand kommer senare.
 */
export const KUST_TILES = ['grus_2'] as const;

export interface TileTransitionGroup {
  id: string;
  /** Biom som behöver gruppen. Ljung mot bergsväg hör bara till fjäll (båda sidor). */
  biomes: readonly string[];
  tiles: readonly string[];
}

/** Övergångar som inte redan ligger i startup. Laddas med båda inblandade biom. */
export const TILE_TRANSITIONS: readonly TileTransitionGroup[] = [
  { id: 'ljung_till_bergsvag', biomes: ['fjall'], tiles: edgeTiles('ljung_till_bergsvag') },
  { id: 'ljung_till_mossa', biomes: ['fjall', 'skog'], tiles: edgeTiles('ljung_till_mossa') },
  { id: 'ljung_till_myr', biomes: ['fjall', 'trask'], tiles: edgeTiles('ljung_till_myr') },
  { id: 'myr_till_aska', biomes: ['trask', 'ask'], tiles: edgeTiles('myr_till_aska') },
  { id: 'myr_till_mossa', biomes: ['trask', 'skog'], tiles: edgeTiles('myr_till_mossa') },
];

const TRANSITION_TILES = unique(TILE_TRANSITIONS.map((group) => group.tiles));

/** Komplett lista: varje png i public/assets/2d/tiles/. */
export const TILES: readonly string[] = unique([STARTUP_TILES, TRASK_TILES, FJALL_TILES, KUST_TILES, TRANSITION_TILES]);

/**
 * Grupper per biom. skog/startup är de 39 som laddas direkt
 * (mossa, blomstergräs och mossig kullersten ingår redan där).
 * Övergångarna ligger för sig och kopplas på vid laddning.
 */
export const TILE_GROUPS = {
  startup: STARTUP_TILES,
  skog: STARTUP_TILES,
  trask: TRASK_TILES,
  fjall: FJALL_TILES,
  overgangar: TRANSITION_TILES,
} as const;

/** Samma 24 dekor som laddades vid start. Anim-filer hör inte hit. */
export const STARTUP_DECOR = [
  'dod_ek',
  'gran',
  'gran_ung',
  'stubbe',
  'ormbunkar',
  'runsten',
  'stenhog',
  'ruinmur',
  'ruinmur_horn',
  'ruinmur_rasad',
  'rod_portal',
  'vindfalle',
  'buske',
  'bjork',
  'gras_tuva',
  'pelare',
  'pelare_liggande',
  'talt',
  'vedtrave',
  'sittstock',
  'gravkors_bjork',
  'anslagstavla',
  'barnsang',
  'eldstad_kall',
] as const;

/** Skogsdekor utöver startup. vägrös är vagros_blommor, kolmila är torvstack. */
export const SKOG_DECOR = [
  'vagros_blommor',
  'torvstack',
  'rotvalta',
  'vargspar_runsten',
  'grav_uppgravd',
  'grav_uppgravd_2',
  'stenkors',
  'kapellbankar_vanda',
  'kapellruin_horn',
  'orange_portal',
] as const;

export const TRASK_DECOR = [
  'dod_tall',
  'dod_tall_knackt',
  'kaveldun',
  'myrkors',
  'myrull',
  'natstang',
  'sjunken_bat',
  'sjunken_klocka',
  'spanglykta',
  'stolprad_rutten',
  'stubbe_vatten',
  'vasstuva',
] as const;

export const FJALL_DECOR = [
  'fjallbjork',
  'gruvoppning',
  'gruvvagn',
  'gruvvagn_valt',
  'hard_glod',
  'hard_kall',
  'kristaller',
  'ljungtuva',
  'rals_bit',
  'renskalle',
  'silkesnat',
  'stenblock',
  'stenblock_lav',
  'vindtall',
  'vindtall_krokig',
] as const;

/** Kustens pool, även sprites som träsk eller fjäll redan listar. Annars syns de inte vid stranden. */
export const KUST_DECOR = [
  'sjunken_bat',
  'stenblock',
  'gruvvagn_valt',
  'stubbe_vatten',
  'stolprad_rutten',
  'rals_bit',
  'kaveldun',
  'kapellruin_horn',
] as const;

/** Askfältets pool. Härdar och ruiner, inte skogens gräs. */
export const ASK_DECOR = [
  'dod_tall_knackt',
  'pelare',
  'ruinmur_rasad',
  'stenkors',
  'hard_glod',
  'hard_kall',
  'natstang',
  'pelare_liggande',
] as const;

/**
 * Byggnader och inredning. Inte med i startladdningen.
 * ensureDecorGroup('by' | 'interiör') hämtar dem senare.
 */
export const BY_DECOR = [
  'hus_lagat_tak',
  'hus_skorsten',
  'kolarkoja',
  'marknadsstand',
  'smedja_slackt',
  'tavernskylt',
  'tvattbalja',
  'tvattlina',
  'hink_kvast',
  'hovdingastol',
  'hund_ruiner',
  'barnsandal',
  'karta_overstruken',
  'rose',
  'rose_kors',
  'dimma_besatt',
  'dimma_rensad',
  'blackgol',
  'hons',
  'benlek',
  'brunn',
  'fackelkorg',
  'fackelkorg_tom',
  'fackla_slackt',
  'fackla_stolpe',
  'huggkubbe',
  'lerkrukor',
  'ortstork',
] as const;

/**
 * Skyltar, lyktor och välkomststenar. Inte en startvikt: anslagstavla finns redan i
 * STARTUP_DECOR, resten hämtas med ensureDecor när vägen streamas.
 */
export const WAYMARK_DECOR = ['anslagstavla', 'orange_portal', 'fackla_stolpe'] as const;

/** Vägrös hör till skogens pool och laddas även med de andra biomen. */
const SHARED_EXPLORE_DECOR = ['vagros_blommor'] as const;

/** Komplett dekorlista: varje png utom lista_saknade och *_anim. */
export const DECOR = [...STARTUP_DECOR, ...SKOG_DECOR, ...TRASK_DECOR, ...FJALL_DECOR, ...BY_DECOR] as const;
export type DecorId = (typeof DECOR)[number];

export const DECOR_GROUPS = {
  startup: STARTUP_DECOR,
  skog: SKOG_DECOR,
  trask: TRASK_DECOR,
  fjall: FJALL_DECOR,
  kust: KUST_DECOR,
  ask: ASK_DECOR,
  by: BY_DECOR,
  interiör: BY_DECOR,
} as const;

/** Plattor som ska hämtas för biomet. Startup-plattorna ingår inte — de är redan laddade. */
export function tilesForBiome(biomeId: string): readonly string[] {
  const id = canonicalBiomeId(biomeId);
  const own = id === 'trask' ? TRASK_TILES : id === 'fjall' ? FJALL_TILES : id === 'kust' ? KUST_TILES : [];
  const edges = TILE_TRANSITIONS.filter((group) => group.biomes.includes(id)).map((group) => group.tiles);
  return unique([own, ...edges]);
}

/** Dekor som ska hämtas för biomet, utöver startup-dekoren. */
export function decorForBiome(biomeId: string): readonly string[] {
  const id = canonicalBiomeId(biomeId);
  const own =
    id === 'skog'
      ? SKOG_DECOR
      : id === 'trask'
        ? TRASK_DECOR
        : id === 'fjall'
          ? FJALL_DECOR
          : id === 'kust'
            ? KUST_DECOR
            : id === 'ask'
              ? ASK_DECOR
              : [];
  if (own.length === 0 && id !== 'ask' && id !== 'skog' && id !== 'trask' && id !== 'fjall' && id !== 'kust') return [];
  return unique([SHARED_EXPLORE_DECOR, own]);
}

/** Vilka plattor ett biom använder, inklusive startskogens plattor och övergångar. */
export const TILES_BY_BIOME: Record<string, readonly string[]> = {
  startup: STARTUP_TILES,
  skog: unique([STARTUP_TILES, tilesForBiome('skog')]),
  trask: tilesForBiome('trask'),
  fjall: tilesForBiome('fjall'),
  kust: tilesForBiome('kust'),
  ask: tilesForBiome('ask'),
};

export function canonicalBiomeId(biomeId: string): string {
  const key = biomeId.trim().toLowerCase();
  if (key === 'träsk' || key === 'trask') return 'trask';
  if (key === 'fjäll' || key === 'fjall') return 'fjall';
  if (key === 'aska' || key === 'ask' || key === 'askfält' || key === 'askfalt') return 'ask';
  if (key === 'kust') return 'kust';
  if (key === 'skog') return 'skog';
  return key;
}

export function canonicalDecorGroup(groupId: string): string {
  const key = groupId.trim().toLowerCase();
  if (key === 'interior' || key === 'interiör' || key === 'inredning') return 'by';
  return key;
}

export function decorForGroup(groupId: string): readonly string[] {
  const id = canonicalDecorGroup(groupId);
  if (id === 'by') return BY_DECOR;
  if (id === 'startup') return STARTUP_DECOR;
  if (id === 'skog') return SKOG_DECOR;
  if (id === 'trask') return TRASK_DECOR;
  if (id === 'fjall') return FJALL_DECOR;
  if (id === 'kust') return KUST_DECOR;
  if (id === 'ask') return ASK_DECOR;
  return [];
}

/** Kort barnvänlig text medan biomets bilder hämtas. */
export function biomeLoadLabel(biomeId: string): string {
  switch (canonicalBiomeId(biomeId)) {
    case 'skog':
      return 'Laddar skogen…';
    case 'trask':
      return 'Laddar träsket…';
    case 'fjall':
      return 'Laddar fjället…';
    case 'kust':
      return 'Laddar kusten…';
    case 'ask':
      return 'Laddar askfältet…';
    default:
      return 'Laddar marken…';
  }
}
