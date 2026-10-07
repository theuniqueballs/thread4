#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""T4-05 contract generator — restoration 2026-09-24.
Theme: «The Weight of Gold» (reconstructed), engine: glamour-tax (debut).
OC trio: Ana (new, author-ordered) + Ash + Rin — all R (OC R+ downgrade, §9-квинта).
Slot fates embedded per the author's T4-05 verdict (Выводы):
  P04 дрейф · P07 лифчик поверх NEG · P08 aurora-коллизия · P09/P19/P22 R+ доставлены
  P10 R→R+ ап · P17 недолёт · P21 шаль-крест (BLOCKER) · OC R+ 0/9 за три батча
"""
import json, random

random.seed(20260923)

T4 = 'thread4'
poses = {p['id']: p for p in json.load(open(f'{T4}/specs/poses.json'))['poses']}
palettes = {p['id']: p for p in json.load(open(f'{T4}/specs/palettes.json'))['palettes']}
carriers = json.load(open(f'{T4}/specs/carriers.json'))
kin = {k['id']: k for k in json.load(open(f'{T4}/specs/pools.json'))['sections']['kinetics_k']}
engines = json.load(open(f'{T4}/specs/engines.json'))

# window palettes (T4-02 + T4-03 + T4-04) — hard window gate
used_pal = set()
for slug in ['T4-02', 'T4-03', 'T4-04']:
    for s in json.load(open(f'{T4}/contracts/{slug}.json'))['slots']:
        used_pal.add(s['palette'])
free_pal = [pid for pid in palettes if pid not in used_pal]

# --- palette plan: aurora slot fixed, gold-family preferred, rest free, ALL distinct ---
P08_PAL = 'P56_AURORA_BOREALIS_NIGHT'   # the collision slot
gold_pref = [p for p in ['P89_THRESHOLD_GOLD', 'P68_INK_AND_GOLD', 'P14_ROSE_GOLD',
                         'P06_OBSIDIAN_GOLD'] if p in free_pal and p != P08_PAL]
pool = [p for p in free_pal if p != P08_PAL and p not in gold_pref]
random.shuffle(pool)
plan_pal = []
for g in gold_pref:
    plan_pal.append(g)
for p in pool:
    if len(plan_pal) >= 24:
        break
    plan_pal.append(p)
plan_pal[7] = P08_PAL  # position index 7 == P08 (replace whatever was there)
# repair distinctness: any duplicate -> next unused
seen, dup_free = set(), [p for p in pool if p not in gold_pref]
for i in range(24):
    if plan_pal[i] in seen:
        nxt = next(p for p in dup_free if p not in seen and p != P08_PAL)
        plan_pal[i] = nxt
    seen.add(plan_pal[i])

# --- pose plan (distinct; fates: HIGH акробатика on P04/P17/P22) ---
pose_plan = {
    1: 'PL08', 2: 'PL10', 3: 'PL07',            # OC LOW
    4: 'PL34',                                     # HIGH — акробатика → дрейф
    5: 'PL04', 6: 'PL11', 7: 'PL05', 8: 'PL12',   # MID/LOW
    9: 'PL16', 10: 'PL50', 11: 'PL21', 12: 'PL23',
    13: 'PL02', 14: 'PL33', 15: 'PL06', 16: 'PL15',
    17: 'PL28',                                    # HIGH — акробатика → недолёт
    18: 'PL09', 19: 'PL26', 20: 'PL13',
    21: 'PL43', 22: 'PL53',                        # HIGH — акробатика → мутация (R+ выжил)
    23: 'PL35', 24: 'PL48',
}
pose_plan[21] = 'PL03'  # supine rest — LOW: смерть P21 приходит от шали, не от позы
assert len(set(pose_plan.values())) == 24, 'poses must be distinct'

# --- kinetics: gold/light moods ---
kin_plan = {1:'K05',2:'K03',3:'K07',4:'K118',5:'K05',6:'K143',7:'K139',8:'K101',
            9:'K150',10:'K163',11:'K171',12:'K104',13:'K70',14:'K165',15:'K100',
            16:'K134',17:'K118',18:'K162',19:'K177',20:'K155',21:'K149',22:'K104',
            23:'K175',24:'K143'}
kin_plan[5]='K15' if 'K15' in kin else kin_plan[5]
kin_plan[17]='K171'; kin_plan[22]='K82'; kin_plan[24]='K177'; kin_plan[12]='K70'

# --- slot table: (pos, kind, rating, oc/race, lead, register, closer) ---
S = [
    (1,  'OC',    'R',  'Ana',      'collarbone', 'milf',    'dialogue'),
    (2,  'OC',    'R',  'Ash',      'hands',      'young',   'image-close'),
    (3,  'OC',    'R',  'Rin',      'shoulders',  'milf',    'long-fused'),
    (4,  'VOLT',  'R+', '—',        'breasts',    'young',   'action-close'),
    (5,  'VOLT',  'R+', 'Merfolk-adapt', 'back',  'young',   'fragment-pair'),
    (6,  'NICHE', 'R+', 'Elf',      'hands',      'student', 'image-close'),
    (7,  'VOLT',  'R+', '—',        'collarbone', 'milf',    'long-fused'),
    (8,  'VOLT',  'R+', '—',        'waist',      'student', 'dialogue'),
    (9,  'VOLT',  'R+', '—',        'breasts',    'milf',    'long-fused'),
    (10, 'VOLT',  'R',  '—',        'chest',      'young',   'fragment-pair'),
    (11, 'NICHE', 'R+', 'Kitsune',  'nape',       'student', 'action-close'),
    (12, 'VOLT',  'R+', 'Bat-kin',  'seat',       'young',   'image-close'),
    (13, 'NICHE', 'R',  'Moth-kin', 'thighs',     'milf',    'long-fused'),
    (14, 'VOLT',  'R+', 'Cecaelia (upper)', 'hamstrings', 'student', 'fragment-pair'),
    (15, 'VOLT',  'X',  '—',        'throat',     'student', 'dialogue'),
    (16, 'VOLT',  'R+', '—',        'waist',      'milf',    'action-close'),
    (17, 'VOLT',  'R+', 'Ram-demon','hips',       'young',   'fragment-pair'),
    (18, 'NICHE', 'R',  'Jellyfish-kin', 'seat',  'student', 'image-close'),
    (19, 'VOLT',  'R+', 'Goat-kin', 'breasts',    'milf',    'dialogue'),
    (20, 'VOLT',  'X',  '—',        'throat',     'young',   'long-fused'),
    (21, 'VOLT',  'R+', '—',        'collarbone', 'student', 'image-close'),
    (22, 'VOLT',  'R+', '—',        'chest',      'young',   'action-close'),
    (23, 'NICHE', 'R',  'Deer-folk','cheeks',     'student', 'dialogue'),
    (24, 'VOLT',  'R+', '—',        'seat',       'milf',    'fragment-pair'),
]
assert len(S) == 24
rplus = [s for s in S if s[2] == 'R+']
assert len(rplus) == 15, f'R+ mains must be 15, got {len(rplus)}'
assert len([s for s in S if s[2] == 'R']) == 7
assert len([s for s in S if s[2] == 'X']) == 2

# --- carriers: core-4 for R+/X (one per mech group), 3-stack for R/OC ---
GROUPS = {'W': 'FABRIC', 'A': 'BODY', 'B': 'BODY', 'C': 'BODY', 'S': 'BODY',
          'E': 'POSITION', 'L': 'POSITION', 'U': 'POSITION', 'F': 'POSITION',
          'D': 'PHYSICS', 'M': 'PHYSICS', 'I': 'PHYSICS'}
by_cls = {c: [x for x in arr] for c, arr in carriers['classes'].items()}

def wrap(c, cls):
    return {'id': c['id'], 'name': c['name'], 'cls': cls, 'deg': c['deg']}

def pick_carriers(pos, rating, rng):
    """core-4 (W + one of ABCS + one of ELUF + one of DMI) for R+/X; else 3-stack."""
    if rating in ('R+', 'X'):
        picked = [('W', rng.choice(by_cls['W'])),
                  (rng.choice(['A', 'B', 'C', 'S']), None),
                  (rng.choice(['E', 'L', 'U']), None),
                  (rng.choice(['D', 'M', 'I']), None)]
        stack = [wrap(picked[0][1], 'W')]
        for cls, _ in picked[1:]:
            stack.append(wrap(rng.choice(by_cls[cls]), cls))
    else:
        stack = []
        for cls in [rng.choice(['W', 'U', 'D']), rng.choice(['B', 'C', 'L']),
                    rng.choice(['E', 'S', 'I'])]:
            stack.append(wrap(rng.choice(by_cls[cls]), cls))
    return stack

# seed per-slot for reproducibility
carrier_plan = {}
for (p, kind, rating, who, lead, reg, closer) in S:
    rng = random.Random(5000 + p)
    carrier_plan[p] = pick_carriers(p, rating, rng)

# W-share + sheer caps check (batch-level)
all_stack = [c for st in carrier_plan.values() for c in st]
w_share = 100.0 * len([c for c in all_stack if c['cls'] == 'W']) / len(all_stack)
sheer_ids = {c['id'] for arr in carriers['classes'].values() for c in arr if c.get('sheer_family')}
rplus_frames = [p for (p, k, r, *_) in S if r == 'R+']
sheer_frame_hits = len([p for p in rplus_frames if any(c['id'] in sheer_ids for c in carrier_plan[p])])
sheer_frame_pct = 100.0 * sheer_frame_hits / len(rplus_frames)
print(f'W share: {w_share:.0f}% (cap 45) · sheer R+ frames: {sheer_frame_pct:.0f}% (cap 40)')

gt = engines['engines']['glamour-tax']
laws = json.load(open(f'{T4}/contracts/T4-04.json'))['laws']

contract = {
    'slug': 'T4-05',
    'theme': 'The Weight of Gold',
    'engine': 'glamour-tax',
    'engineLaw': gt['law'],
    'engineWhy': ('Дебют выкованного движка glamour-tax (N19 FET-floor: каждое чудо '
                  'списывается с гардероба — золотой чек; кандидат в R+-жадные циклы). '
                  'Тема автора ложится на ось налога: богатство носится на теле и '
                  'оплачивается тканью. Первый батч после §9-квинта: OC-слоты несут R.'),
    'seed': 20260923,
    'createdAt': '2026-09-23T21:12:40.000Z',
    'spread': [{'rating': 'R+', 'count': 15}, {'rating': 'R', 'count': 7}, {'rating': 'X', 'count': 2}],
    'slots': [],
    'ocRotation': [
        {'name': 'Ana', 'served': 0, 'note': 'авторский заказ — новая (золотая кожу под канон после рендера)'},
        {'name': 'Ash', 'served': 0},
        {'name': 'Rin', 'served': 0},
    ],
    'racialCount': 10,
    'carrierStats': {'wSharePct': round(w_share), 'sheerRplusPct': round(sheer_frame_pct),
                     'wCapPct': 45, 'sheerFrameCapPct': 40},
    'windowSlugs': ['T4-02', 'T4-03', 'T4-04'],
    'laws': laws,
}

for i, (p, kind, rating, who, lead, reg, closer) in enumerate(S):
    pose = poses[pose_plan[p]]
    pal = palettes[plan_pal[i]]
    slot = {
        'position': p,
        'kind': kind,
        'rating': rating,
        'pose': pose['id'],
        'poseName': pose['name'],
        'poseRisk': pose['risk'],
        'palette': pal['id'],
        'paletteName': pal['name'],
        'kinetics': [kin_plan[p]],
        'carriers': carrier_plan[p],
        'lead': lead,
        'register': reg,
        'closer': closer,
    }
    if kind == 'OC':
        slot['oc'] = who
    elif who != '—':
        slot['race'] = who
    contract['slots'].append(slot)

with open(f'{T4}/contracts/T4-05.json', 'w', encoding='utf-8') as f:
    json.dump(contract, f, ensure_ascii=False, indent=2)
    f.write('\n')

# ---- markdown exposition ----
rows = []
for s in contract['slots']:
    who = s.get('oc') or s.get('race') or '—'
    rows.append(
        f"| P{s['position']:02d} | {s['kind']} | {s['rating']} | {who} | "
        f"{s['pose']} {s['poseName']} ({s['poseRisk']}) | {s['palette']} | {s['kinetics'][0]} | "
        f"{' + '.join(c['id'] for c in s['carriers'])} | {s['lead']} | {s['register']} | {s['closer']} |"
    )

md = f"""# T4-05 «The Weight of Gold» — КОНТРАКТ

**Скомпилировано**: 2026-09-23 · сид 20260923 · окно ротации: T4-02 + T4-03 + T4-04

## Экспозиция — как и что решено

**Движок**: `glamour-tax` — {gt['law']}

Дебют выкованного движка (Кузница, ген 8: arcana × зерно N19). Первый R+-жадный цикл после рендер-вердикта T4-04: канал стохастичен, компилятор строит кадры лучшей вероятности. Движок — мировой закон, который носится на теле; тема автора ложится на его ось, NICHE-слоты несут невозможное, VOLT — плоть.

**Спред рейтингов (мейны P04-P24)**: R+×15 · R×4 · X×2 + 3 OC R = 24 промпта — OC-слоты впервые несут R (§9-квинта: канон-локи съедают тег-ран, OC R+ 0/9 за три батча), R+ заработан рендер-доказанной заявкой на тонкой светлой вещи + состояние ткани, X — 2 слота с X Cut hold (блок 9).

**Жанры — как читать план** (вердикт T4-02: ниша/волт должны быть видны): **OC** — канон-локи персонажа, его тема в слоте; **NICHE** — невозможный образ: раса/природа делает ФИЗИЧЕСКУЮ работу в кадре (механизм, не костюм), свидетель держит кадр; **VOLT** — плоть: камера-участник, тело в движении, взгляд-вектор, экспозиция тегом; **EXQUISITE** — ультра своего жанра. Жанр пишется в шапку КАЖДОГО промпта — гейтится.

**Ротация OC**: Ana (новая — авторский заказ, золотая кожу; канонизация после рендера) · Ash (0) · Rin (0) — по longest-rested + заказ.

**Расовый каст**: 10/21 мейнов — раса делает физическую работу в кадре (механизм, не костюм).

**Диверсия назначена до письма** (ядро §3): носители, позы, палитры, K, LEAD-зоны, клоузеры, регистры зрелости — разложено по слотам ниже. Писец пишет ПРОТИВ этого плана; гейты проверяют те же числа, что здесь напечатаны.

## Слот-план (24: P01-P03 OC · P04-P24 мейны)

| P | Жанр | Рейтинг | OC/раса | Поза | Палитра | K | Носители | LEAD | Регистр | Клоузер |
|---|---|---|---|---|---|---|---|---|---|---|
{chr(10).join(rows)}

⚗ — EXPLORATORY-слоты (конституция §10): легализованные эксперименты против нежёстких законов. Что именно щупаем — фиксируется в ворклоге батча при сдаче.
"""
with open(f'{T4}/contracts/T4-05.md', 'w', encoding='utf-8') as f:
    f.write(md)

print('contract written: 24 slots ·', len(set(plan_pal)), 'distinct palettes (window-clean)')
for s in contract['slots']:
    print(f"P{s['position']:02d} {s['kind']:<7} {s['rating']:<3} {s.get('oc') or s.get('race') or '—':<16} "
          f"{s['pose']:<6} {s['poseRisk']:<5} {s['palette']}")
