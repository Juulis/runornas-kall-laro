import assert from 'node:assert/strict';
import { LocaleManager } from '../src/i18n/LocaleManager';

const backend = {
  settings: new Map<string, string>(),
  async getSetting(key: string) {
    return backend.settings.get(key) ?? null;
  },
  async setSetting(key: string, value: string) {
    backend.settings.set(key, value);
  },
};

async function run(): Promise<void> {
  const i18n = new LocaleManager({ dev: false });
  await i18n.bindSettings(backend as never);
  assert.equal(i18n.locale, 'sv');
  assert.equal(i18n.t('menu.continue'), 'Fortsätt');
  assert.equal(i18n.t('msg.zone_wolfstead'), 'Vargaby');
  assert.equal(i18n.t('hud.proviant', { count: 2 }), '2 st');
  assert.equal(i18n.t('quest.log_title'), 'Uppdrag');
  assert.equal(i18n.t('map.regions.startlagret'), 'Lägret vid skogsbrynet');
  assert.equal(i18n.t('map.milestone', { place: 'Vargaby', hundreds: 4 }), 'Vargaby 4');

  await i18n.setLocale('en');
  assert.equal(i18n.locale, 'en');
  assert.equal(i18n.t('quest.log_title'), 'Quest log');
  assert.equal(i18n.t('menu.continue'), 'Continue');
  assert.equal(i18n.t('msg.zone_wolfstead'), 'Wolfstead');
  assert.equal(i18n.t('msg.no_proviant'), 'No provisions left');
  assert.equal(i18n.t('map.regions.vargaby'), 'Wolfstead');
  assert.equal(i18n.t('map.regions.gamla_byn'), 'The Old Village');
  assert.equal(i18n.t('map.milestone', { place: 'Wolfstead', hundreds: 4 }), 'Wolfstead 4');
  assert.equal(i18n.t('map.goal_nearest_town', { place: 'Dimshore' }), 'Next goal: Dimshore');
  assert.equal(backend.settings.get(LocaleManager.STORAGE_KEY), 'en');

  const missing = i18n.t('menu.this_key_does_not_exist' as 'menu.continue');
  assert.ok(missing.includes('menu.this_key_does_not_exist') || missing === 'menu.this_key_does_not_exist');

  console.log('i18n.test.mts: ok');
}

await run();
