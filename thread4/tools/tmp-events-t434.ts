import { appendEvent } from '../../src/lib/t4/events'

appendEvent(
  'spec.imported',
  'РАСЫ v2.2.1: R41 Cyclops-kin → Witch-kin (приказ автора 2026-10-17: «поменяй циклопов на что-нибудь другое, циклопы отстой»); ведьма — человекоподобный регистр (красивое лицо/сладкие ножки, вердикт T4-33 в силе), ember-wisp = тёплый свет + проводник взгляда (закон №3), anti-shield NEG: green skin/warts/crooked hooked nose/halloween costume — хагов-дрейф закрыт; фонд 45 без изменений, ID R41 закреплён навсегда',
  { kind: 'races-swap', id: 'R41', from: 'Cyclops-kin', to: 'Witch-kin' }
)

appendEvent(
  'note',
  'АУДИТ-НАХОДКА №6 (сдача T4-34, строгий формат): kin-щит эмитил assert-токены «no X», scribe срезал префикс («no horns» → «horns»), и NEG запрещал фичи САМОЙ расе — NEG суккуба гасил рога/хвост, медузы — змеи-волосы, эльфа — ВСЕ уши; renders спасал только перевес POS. Фикс: FAMILY_SHIELD + shieldFromFeatures переведены в NEG-ЯЗЫК (дрейф-гварды: multiple tails, large demon wings, black wings…), срез в scribe оставлен как защита архивных контрактов; T4-34 починен на сдаче (11 слотов), будущие контракты чисты от самострелов',
  { kind: 'audit-finding', finding: 6, file: 'thread4/tools/kin-block.ts', batch: 'T4-34' }
)
console.log('2 события записаны')
