/**
 * Samlar alla unika texter som spelet läser upp och skriver en JSON-lista.
 * Kör: npx tsx scripts/collect-voice-texts.mts [utfil]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { collectBankSpeakParts } from '../src/learn/voiceTexts';

const out = resolve(process.argv[2] ?? 'scripts/voice-texts.json');
const parts = await collectBankSpeakParts();
const byLang = new Map<string, number>();
let chars = 0;
for (const part of parts) {
  byLang.set(part.lang, (byLang.get(part.lang) ?? 0) + 1);
  chars += part.text.length;
}
await mkdir(dirname(out), { recursive: true });
await writeFile(out, `${JSON.stringify({ count: parts.length, chars, byLang: Object.fromEntries(byLang), parts }, null, 2)}\n`);
console.log(`skrev ${parts.length} unika stycken (${chars} tecken) till ${out}`);
console.log(Object.fromEntries(byLang));
