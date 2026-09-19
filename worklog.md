# Shared Worklog

---
Task ID: 1
Agent: Super Z (main)
Task: Thread 4 discovery — deep study of CHEMODAN THREAD 3.2-EXP-V21 (uploaded
tar.gz), clinical diagnosis of the current system, open-source/theory research,
clarifying questions to the author before building Thread 4.

Work Log:
- Extracted /home/z/my-project/upload/CHEMODAN_THREAD_3.2-EXP_V21.tar.gz to
  /home/z/my-project/chemodan/CHEMODAN_THREAD_3.2-EXP_V21/ (83 files, ~4MB)
- Read: MANIFEST.md, README_MIGRATION.md, scripts/README.md, full live
  worklog.md (Tasks 31-39 + STATE), RULES_HISTORY.md, ENGINES.yaml (all 7
  engines + open seeds), OC_CANON.yaml head, RULES.md section map (§1-§62),
  V17-V21 changelog entries, BATCH_N29 head (the OC-merge format), spine.py +
  pipeline.py headers
- NOTE: the author mentioned "Файл 2" (Claude's Thread 4 attempt) — NOT in
  /home/z/my-project/upload/ (only the tar.gz arrived). Must ask for re-upload.
- Ran 17 web searches: promptfoo, Vale/proselint, Design by Contract, Oulipo,
  mutation testing (Stryker), event sourcing, SRE postmortems, TTR/MTLD/PATTR
  lexical diversity, GAN/LLM mode collapse, Verbalized Sampling (arXiv),
  danbooru tag tooling, sd-parsers/sd-prompt-reader, Langfuse/LangSmith,
  rule of least power, ComfyUI prompt libraries
- Delivered to author: clinical diagnosis of 3.2 (10 structural findings),
  research digest (12 mapped findings), 19 grouped clarifying questions,
  proposed Thread 4 architecture direction (Constitution + Compiler + Contract
  + Gates + Event-sourced ledgers + Feedback loop)

Stage Summary:
- System understood end-to-end: 21-prompt batch pipeline (3 OC + 18 mains),
  PixAI/Tsubaki2 → Yadayo, PH-proof doctrine, 62 §-laws, 7 engine generations,
  5 gates + spine compiler + house_lint core, ledgers (TRACKER/MOTIF/SUCCESS/
  LINT_RECEIPTS), §62 FIRST-PASS LAW (V21) = contract-first writing
- Key insight for Thread 4: the §62 writer_contract (built from organ
  constants) is the seed of the whole architecture — generalize "lint ==
  contract by construction" to the entire system; state should be DERIVED
  from append-only events (event sourcing), not hand-maintained pseudo-YAML;
  diversity should be assigned at spine-compile time (Verbalized Sampling
  insight), not caught post-hoc by freq/rhythm lints
- Awaiting: author's answers to 19 questions + re-upload of Claude's file "2"
  before writing the Thread 4 document itself

---
Task ID: 2-a
Agent: pool-parser (Task Agent 2-a, general-purpose)
Task: Convert legacy THREAD 3.2 system pools (pseudo-YAML, messy) into clean
typed JSON specs for THREAD 4. Author's order: pools are "всё пиздец как
полезно" — preserve everything useful, flag near-duplicates and anomalies,
lighten where possible, never delete content.

Work Log:
- Read worklog (Task 1 context), then all 7 source files in
  chemodan/CHEMODAN_THREAD_3.2-EXP_V21/system/ (CARRIER_LIBRARY, POSE_LIBRARY,
  PALETTE_LIBRARY, POOLS_V8, ENGINES, OC_CANON, ONTOLOGY — ~4.6k lines total,
  read-only, untouched)
- Wrote /home/z/my-project/thread4/specs/parse_pools.py (~1000 lines,
  regex-only parser — PyYAML avoided since sources are pseudo-YAML: unbalanced
  braces, stray quotes, bare tokens, YAML-ish fragments). Kept as the import
  tool; rerunnable, self-validating (round-trips every JSON it writes).
- Produced 7 typed JSON specs (UTF-8, 2-space, all json.load-verified):
  * carriers.json — 280 carriers / 14 classes / 4+1 mech groups, all counts
    match the source's own ledger exactly (W30 A14 B30 C16 S20 E32 L18 U20
    F14 D28 M16 I18 G12 H12); mat affinities extracted from notes (A:14 B:9
    C:33, rest null); sheer_family flagged (7, all W-class, judgment calls
    documented); core4_law + doctrine notes embedded
  * poses.json — 240 poses + all 240 §33 pose-camera pairs merged in +
    family labels + usage doctrine v3.0 + cam reference table
  * palettes.json — 105 palettes (P01-P20 legacy 3-slot + P21-P105 6-slot),
    family labels, saturation doctrine (five locks), usage rules C066-C072
  * pools.json — full pool inventory: K kinetics 107 (102 numbered + 4
    comment-defined OC-exempt + K182 oc-exempt flag), FET 50, H 26, GAR 40 +
    GAR-F 24 (failure states incl. antigrav physics-undresses family), BRE 24,
    BK 16, B 22, HS 50, CAM 18, LQ 15, races 22 + collision table, NR 69,
    emotion 28, ENG 8, FAM-A/B/C breast families + rules, misc_axes (env/skin/
    material donor dicts, BDM, BPT, light verbs, gear pool, etc.), policies
    (K ledger, K-freeform, K-return law, ENV/OAS law, mint ledgers)
  * engines.json — all 7 engines (bespoke→apocrypha) with law/on_body/
    strong_pairs/failure_modes/status + 5 open seeds + lineage note
  * oc-canon.json — 16 active OCs, full lock state (hair/eyes/skin/body/
    signature_marks/anti_shield/neg_additions/presentation_modes/scenario
    exceptions), canon v1.7.1, 12 changelog notes, Rae+Iya inactive reserve,
    tarot/element/zodiac registries (registry-only policy preserved)
  * races.json — 22 races from 3.2 + Thread-4 directives applied: R17
    jellyfish-kin + R20 harpy-kin = gold (author-confirmed); dwarves/goblins/
    trolls/orcs = banned (BAN-01..04, new directive entries)
- Similarity analysis (Jaccard on normalized word sets, threshold 0.75):
  carriers 0 pairs flagged (closest: CR-W24~CR-C16 0.615, CR-B05~CR-S05
  0.615, CR-B06~CR-S06 0.600 — cross-class motif echoes, kept); poses 0
  flagged (max 0.400 — the ×4 "без повторок" order was honored; the source's
  own 4 documented near-neighbor pairs measure 0.107-0.314)
- Found + flagged anomalies (report §3): CAM axis split-brain (ONTOLOGY vs
  POSE_LIBRARY disagree on CAM02/04/05/06/07 — the big one for Thread 4),
  K numbering holes (K09-60, K94-97, K102, K105-108, K109-114 freeform,
  K123-125 skipped despite ledger promise, K136-138, K156-157), FET26-45
  retired hole, duplicate kinetic_extension_v5 key, broken braces in
  env/skin/material dicts, bare OC-exempt token (K182), comment-defined codes
  (K155/K172-174), K185-188/K192-195 referenced-but-in-batch-files,
  light-verb 'fire' subset has 3 verbs outside the 21-verb master pool
- Typos: the known P22 'idnight-indigo' is ALREADY FIXED in the V21 source
  (verified — no palette typos found); auto-repaired 4 stray-quote scene
  values in-memory (NRM08/NRM09/NRW02/NRW11 — missing opening quote), sources
  untouched
- Wrote /home/z/my-project/thread4/specs/PARSE_REPORT.md (full report:
  counts, typos, 14 anomalies, judgment calls, near-dup analysis, section
  inventory, 5 recommended next actions)

Stage Summary:
- Thread 4 now has complete, typed, machine-readable copies of every 3.2
  pool: 280 carriers, 240 poses (+pairs), 105 palettes, 107 K-codes, 50 FET,
  26 H, 64 GAR (40 garments + 24 failure states), 62 technique codes
  (BRE24+BK16+B22), 50 HS, 18 CAM, 15 LQ, 22 races (+gold/banned directives),
  69 NR, 7 engines + 5 seeds, 16 OCs with full locks — every entry and ID
  preserved, nothing deleted, all anomalies flagged not fixed
- Key finding for the compiler team: the camera axis MUST be renumbered to
  one scheme (POSE_LIBRARY suffix-named codes recommended); K-numbering
  should go sequential-or-names; sheer-family = 7 flagged W-carriers under
  the §4G caps
- parse_pools.py is rerunnable and self-validating; sources in chemodan/ were
  never modified (read-only parse)

---
Task ID: 2-b (completed by Super Z main — subagent timed out mid-build; its components were kept)
Agent: Super Z (main)
Task: THREAD 4 dashboard (single-page SPA at /).

Work Log:
- Subagent 2-b created src/components/t4/{api.ts, bits.tsx, markdown.tsx, spec-renderers.tsx}
  (quality work — defensive API layer, design-system bits, GFM markdown viewer,
  9 spec renderers) but hit the context deadline before page.tsx
- Main finished: rewrote src/app/page.tsx — 8 tabs (Состояние/Документы/Спеки/
  Сборка/Батчи/События/Вердикты/Архив 3.2), dark atelier (zinc+amber, no blue),
  sticky footer with safe-area, mobile-first, loading/error/empty states
- Installed react-markdown + remark-gfm (tables render — constitution has them)

Stage Summary:
- Dashboard complete and browser-verified; API contract implemented 1:1 (see Task 4)

---
Task ID: 3-7 (core build, by Super Z main)
Agent: Super Z (main)
Task: THREAD 4 core: rating recipes, event store, compiler, gates, API routes,
integration, verification.

Work Log:
- Wrote thread4/specs/rating-recipes.json (the author's 2026-09-19 tier table →
  full per-tier recipes: signals/signal_min/carrier_classes/counter-NEG/prose
  floor/opener ladder; eternal floors: genital lock, anti-loli, leak guard,
  candle guard, face guard; XXX never; default spread R7/R+12/X2) + bans.json
- Core TS lib (src/lib/t4/): fsutil.ts (paths), events.ts (append-only JSONL +
  fold: batches/window/OC rotation/debts), specs.ts (typed loaders + cache +
  inventory), compiler.ts (seeded deterministic RNG, LRU rotation pools, slot
  planner 21+3: OC longest-rested, 7 NICHE R / 9 R+ mains incl. EXQ / 2 X,
  core-4 carrier assignment per mech group with recipe preference, batch-level
  sheer budget ≤40% R+ frames + ≤2/prompt, W ≤45% by construction, 21 distinct
  poses/palettes, 10 racial, register thirds ≤50%, LEAD/closer/witness
  rotation, EXPLORATORY slots legalized; emits contracts/T4-NN.json + .md
  exposition; dryRun mode for selftests), gates.ts (11 gates: structure/floors/
  rating-recipe/canon/diversity/window HARD; budget/cadence/simcheck WARN;
  freq-report/usage ADVISORY; receipt + sha10 + first-run-clean verdict,
  gate.run events, dryRun mode)
- Fixed during selftest: bun parser vs type-literal generic (named interface);
  mains count arithmetic (9 R+ mains); closer missing from main slot push;
  tierOf regex («\b after '+' never fires» — explicit-order tier matching);
  sheer batch budget; dryRun to keep selftests out of the live ledger
- API routes (13): state, docs/[name], specs, specs/[id], compile, contracts,
  contracts/[slug], batches, batches/[slug], gates, events (GET+POST, typed),
  archive, archive/[name], feedback (VLM render analysis → render.verdict
  event, z-ai-web-dev-sdk backend-only)
- thread4/cli.ts: seed/compile/gates/state/selftest (bun); seeded era events
  (era.born, spec.imported, law.ratified, taste.datum)
- VERIFICATION: selftest 18/18 PASS (determinism, 21 slots, spread R7/R+12/X2,
  core-4 groups, racial 10, registers ≤50%, sheer/W caps, parseBatch);
  synthetic broken batch T4-98 → all 6 hard gates FAIL correctly with named
  findings; lint clean (0 errors 0 warnings); agent-browser e2e: all 8 tabs
  render, compile from UI (T4-02 created, contract rendered), archive N12
  readable, verdict form → render.verdict event recorded, mobile 390px OK,
  footer sticky, console clean, VLM screenshot review: «layout is NOT broken»

Stage Summary:
- THREAD 4 v1.0.0 shipped: constitution + taste + renderer facts + 9 typed
  specs (280 carriers/240 poses/105 palettes/107 K/7 engines/16 OC/26 races/
  5 tier recipes/bans) + deterministic compiler + 11 gates + 13 API routes +
  VLM feedback loop + dashboard — all browser-verified
- Standing demo: T4-01 «Город, где усталость носят как меха» contract compiled
  (engine bespoke, OC Ash/Zia/Lua, sheer 33%, W 25%); author blesses it or
  names his own theme (ledger reset = one command)
- Open for the author: theme order for the first real batch; render verdicts;
  VLM loop first live test
