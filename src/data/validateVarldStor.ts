import type { BigWorldBiome, BigWorldDataFile } from './bigWorldTypes';
import type { MonsterDef } from './types';
import { filterSubtypesByBand, regionSpawnLevelBand } from '../world/bigWorld/spawnRules';

export interface VarldStorValidateCtx {
  monsterIds: Set<string>;
  monsterById: Map<string, MonsterDef>;
  familyIds: Set<string>;
}

/** Känd platshållare tills design #107 synkas (fjall_bergsulvar). */
export function filterKnownVarldStorDataDebt(issues: string[]): string[] {
  return issues.filter((i) => !(i.includes('egna_monster fjall_bergsulvar') && i.includes('gruvspindel') && i.includes('insekter')));
}

function isNonEmptyTileList(ids: unknown): ids is readonly string[] {
  return Array.isArray(ids) && ids.every((id) => typeof id === 'string' && id.trim() !== '');
}

/** Markset är valfritt. Finns det ska bas ha minst en tile och varje id vara en icke-tom sträng. */
function validateBiomeMarkset(bid: string, biome: BigWorldBiome, issues: string[]): void {
  const markset = biome.markset;
  if (!markset) return;
  if (!isNonEmptyTileList(markset.bas) || markset.bas.length < 1) {
    issues.push(`varld_stor biom ${bid}: markset.bas saknar tile`);
  }
  for (const role of ['flack_a', 'flack_b', 'sallsynt'] as const) {
    const ids = markset[role];
    if (ids == null) continue;
    if (!isNonEmptyTileList(ids)) issues.push(`varld_stor biom ${bid}: markset.${role} har tomt tile-id`);
  }
}

export function validateVarldStor(bw: BigWorldDataFile, ctx: VarldStorValidateCtx): string[] {
  const issues: string[] = [];
  const regionIds = new Set<string>();
  const biomIds = new Set(Object.keys(bw.biomer));
  const ringNums = new Set((bw.meta.zonmodell?.ringar ?? []).map((r) => r.ring));

  for (const r of bw.regioner) {
    if (regionIds.has(r.id)) issues.push(`varld_stor: dubblerat region-id ${r.id}`);
    regionIds.add(r.id);
    if (!biomIds.has(r.biom)) issues.push(`varld_stor region ${r.id}: okänt biom ${r.biom}`);
    if (r['radie'] < 0) issues.push(`varld_stor region ${r.id}: radie ${r['radie']} < 0`);
    if (r.ringzon != null && !ringNums.has(r.ringzon)) {
      issues.push(`varld_stor region ${r.id}: okänd ringzon ${r.ringzon}`);
    }
    if (r.monsterfamilj && !ctx.familyIds.has(r.monsterfamilj)) {
      issues.push(`varld_stor region ${r.id}: okänd monsterfamilj ${r.monsterfamilj}`);
    }
    for (const id of r.undertyper ?? []) {
      const def = ctx.monsterById.get(id);
      if (!def) issues.push(`varld_stor region ${r.id}: okänd undertyp ${id}`);
      else if (r.monsterfamilj && def.family !== r.monsterfamilj) {
        issues.push(`varld_stor region ${r.id}: undertyp ${id} tillhör ${def.family}, inte ${r.monsterfamilj}`);
      }
    }
    for (const g of r.grannar ?? []) {
      if (!bw.regioner.some((x) => x.id === g)) issues.push(`varld_stor region ${r.id}: okänd granne ${g}`);
    }
  }

  const startRegion = bw.meta.startpunkt.region;
  if (!regionIds.has(startRegion)) {
    issues.push(`varld_stor startpunkt.region okänd: ${startRegion}`);
  }

  for (const road of bw.vagar) {
    for (const id of road.strackning) {
      if (!regionIds.has(id)) issues.push(`varld_stor väg ${road.id}: okänd region ${id}`);
    }
  }
  for (const poi of bw.pois) {
    if (!regionIds.has(poi.region)) issues.push(`varld_stor poi ${poi.id}: okänd region ${poi.region}`);
  }

  for (const [bid, biome] of Object.entries(bw.biomer)) {
    validateBiomeMarkset(bid, biome, issues);
    for (const slot of biome.egna_monster ?? []) {
      for (const id of slot.undertyper_nu) {
        if (!ctx.monsterIds.has(id)) issues.push(`varld_stor biom ${bid} egna_monster: okänd undertyp ${id}`);
        else {
          const def = ctx.monsterById.get(id);
          if (def && def.family !== slot.familj) {
            issues.push(`varld_stor biom ${bid} egna_monster ${slot.id}: undertyp ${id} tillhör ${def.family}, inte ${slot.familj}`);
          }
        }
      }
    }
    for (const [fam, ids] of Object.entries(biome.monsterfamiljer ?? {})) {
      if (!ctx.familyIds.has(fam)) issues.push(`varld_stor biom ${bid}: okänd familj ${fam}`);
      for (const id of ids) {
        if (!ctx.monsterIds.has(id)) issues.push(`varld_stor biom ${bid} monsterfamiljer: okänd undertyp ${id}`);
      }
    }
  }

  const ringar = [...(bw.meta.zonmodell?.ringar ?? [])].sort((a, b) => a.ring - b.ring);
  for (let i = 1; i < ringar.length; i++) {
    const prev = ringar[i - 1];
    const cur = ringar[i];
    if (prev?.till != null && cur && cur.fran !== prev.till) {
      issues.push(`varld_stor zonmodell: hål mellan ring ${prev.ring} till ${prev.till} och ring ${cur.ring} från ${cur.fran}`);
    }
  }

  for (const r of bw.regioner) {
    if (!r.genererad_spawn) continue;
    const regionBand = regionSpawnLevelBand(bw, r);
    if (filterSubtypesByBand(r.undertyper ?? [], regionBand).length === 0) {
      issues.push(`varld_stor region ${r.id}: genererad_spawn tom i regionband ${regionBand.join('-')}`);
    }
  }

  return issues;
}
