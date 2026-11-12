import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MONSTER_8DIR_STEMS } from '../src/render/sheet8dir';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MONSTER = path.join(ROOT, 'public/assets/2d/sprites/monster');

type Index = {
  eightDir?: string[];
  eightDirAnims?: Record<string, string[]>;
};

const index = JSON.parse(fs.readFileSync(path.join(MONSTER, 'index.json'), 'utf8')) as Index;

function stemsOnDisk(id: string): string[] {
  const dir = path.join(MONSTER, id);
  if (!fs.existsSync(dir)) return [];
  const files = new Set(fs.readdirSync(dir));
  return MONSTER_8DIR_STEMS.filter((stem) => files.has(`${id}_${stem}_8dir.json`));
}

for (const id of index.eightDir ?? []) {
  const declared = index.eightDirAnims?.[id] ?? [...MONSTER_8DIR_STEMS];
  const actual = stemsOnDisk(id);
  assert.deepEqual(
    [...declared].sort(),
    [...actual].sort(),
    `${id}: eightDirAnims måste stämma med filerna på disk (annars 404 i röktestet)`,
  );
}

console.log('monster-8dir-anims.test.mts: ok');
