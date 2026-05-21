# Handoff: Sea Power data → `presets.json` parser

**Audience:** a fresh AI agent (or dev) building a *standalone* extractor.
**Author context:** written by the agent that built the Saturation Planner web
app, after exploring the game install + Steam Workshop mods. Everything you need
to know about the file formats is captured here so you don't have to re-derive it.

---

## 1. Why this exists

The Saturation Planner (`G:\Project\SeaPowerSaturationCalc`) currently makes the
user hand-type missile stats (speed, range) and *guess* a defender's
"intercepts per window". The game already contains the real numbers. We want a
parser that reads the game's `.ini` data and emits a single **`presets.json`**
the app bundles as a static asset (no backend — fully client-side).

**Keep it decoupled from the app.** The game is in early access and patches
often; mods change constantly. The parser must be **re-runnable** against an
updated install to regenerate `presets.json`. Treat it as its own tool/repo, not
app code. Its only contract with the app is the JSON schema in §6.

---

## 2. Data locations — **example only, DO NOT hardcode**

These are *this machine's* paths at time of writing. The user **will add mods**
and **may move the install to another drive**. Treat every path as discovered at
runtime (§2.1), never as a constant.

| What | Example path (illustrative) |
|---|---|
| Base game data | `D:\SteamLibrary\steamapps\common\Sea Power\Sea Power_Data\StreamingAssets\original` |
| User overrides | `…\StreamingAssets\user` |
| Workshop mods | `D:\SteamLibrary\steamapps\workshop\content\1286220\<modId>\` |

Snapshot at writing: **~125 mod folders** — `ammunition` 95 mods (~2225 `.ini`),
`systems` 89, `vessels` 48, `ships` 34 (~797 ship `.ini`). These counts **will
drift**; never assume a mod list or count.

`1286220` is Sea Power's **Steam AppID** — stable, and the reliable anchor for
both the game folder (`steamapps\common\Sea Power`) and workshop content
(`steamapps\workshop\content\1286220`).

### 2.1 Dynamic discovery & configuration (REQUIRED)

Resolve paths with this **precedence**, stopping at the first that validates:

1. **CLI flags** — `--game <dir>` / `--mods <dir>`.
2. **Config file** — `seapower-parser.config.json` next to the script
   (`{ "gamePath": "...", "modsPath": "..." }`). Write the resolved paths back
   here on a successful run so the next run is zero-config until something moves.
3. **Env vars** — `SEAPOWER_GAME` / `SEAPOWER_MODS`.
4. **Auto-discovery via Steam** (the default happy path):
   - Find Steam: Windows registry `HKCU\Software\Valve\Steam → SteamPath`
     (fallback `HKLM\SOFTWARE\WOW6432Node\Valve\Steam → InstallPath`).
   - Parse `Steam\steamapps\libraryfolders.vdf` to enumerate **all** library
     roots (the game can live on any drive).
   - In each, look for `steamapps\common\Sea Power` and
     `steamapps\workshop\content\1286220`. The library whose `appmanifest_1286220.acf`
     exists is authoritative for the game folder.

**Validate** a resolved root before trusting it: game = `Sea Power.exe` +
`Sea Power_Data\StreamingAssets\original\ammunition` exist; mods = the `1286220`
dir exists. If discovery fails, print the precedence list and exactly what was
checked — don't silently emit an empty `presets.json`.

### 2.2 Dynamic mod handling (REQUIRED)

- **Enumerate** every subfolder of the workshop dir at runtime; new
  subscriptions appear automatically, removed ones vanish. No hardcoded ids.
- Also scan `StreamingAssets\user` (local overrides) as a pseudo-"mod".
- Read each mod's `_info.ini` → name + `[DEPRECATED]` flag; skip/flag deprecated.
- **Load order / enabled set**: if you can locate the game's enabled-mods +
  order list (Open Question §8.2), honor it. Until then: include all
  non-deprecated mods, **last-writer-wins** by override key, and emit a
  `collisions` report. Always record `source` (`base` | `user` | `<modId>`) on
  every entity so the app can show provenance and the user can audit.
- Make a **re-run cheap and idempotent**: same inputs → byte-identical output
  (stable sort keys). Stamp the output with `generatedAt`, resolved paths, and
  the exact mod set used, so two runs are diffable when the user adds mods.

---

## 3. The four file types you parse

### 3a. Missiles — `ammunition/*.ini`
One file per weapon. Fields the app needs (names verbatim):

```
[General]   Type=Missile     TargetType=ASuW|AAW|ASW
[Guidance]  GuidanceType=3   (0 None,1 IR,2 SARH,3 ARH,4 ARM,5 Laser,6 TV,7/8/9 sonar)
            MaxVelocity=620          // knots  ← app "speedKnots"
            MaxLaunchRange=22.6      // nm     ← app "maxRangeNm"
            MinLaunchRange=2         // nm
            SeekerActiveRange / SeekerPassiveRange   // nm
            # flight profile (drives radar-horizon detection later):
            SeaSkimmingAlt=33        // ft
            FinalFlightPhaseDistToTarget / TerminalApproachDist / TerminalAlt
[SensorData] RCS=0.25                // detectability
[WarheadData] WarheadType / Power / ImpactSize / Penetration
            AntiCountermeasuresBonus / AntiJammerBonus   // ECCM (0..1)
```
Only `Type=Missile` matters to us; skip `Projectile`/`Torpedo` unless you want
ASW later. Anti-ship = `TargetType=ASuW`; SAMs = `AAW`.

### 3b. Launchers — `systems/weapons.ini`
One big file, ~302 sections. Section header = launcher id (e.g. `[MK13]`).
The **rate-of-fire data behind saturation**:
```
ReloadTime=4        // seconds until launcher ready again
FireRate=8          // rounds per minute
HorizontalDegreesPerSecond / VerticalDegreesPerSecond   // slew (re-engage cost)
ModuleType=SmallLauncher | CIWS | ...
```
CIWS sections carry **literal Pk**:
```
[AK630]
MissileInterceptChance=45   // % to kill a missile (the Pk we wanted!)
AircraftInterceptChance=70
FireRate=4000  RoundsLoaded=2000  ReloadTime=1800
```

### 3c. Sensors / fire-control — `systems/sensors.ini`
The **illuminators/directors are the real saturation limit.** Targeting radars:
```
[SPG-62]   #Aegis illuminator (Ticonderoga)
Type=Targeting   Mode=Illuminate
TargetChannels=1     // simultaneous targets tracked
WeaponChannels=1     // simultaneous missiles guided  ← THE saturation cap
MaxRange=305.6       // km  (note: km here, missiles use nm — watch units)
```
A semi-active SAM needs an illuminator locked during terminal homing. A ship
with 4× SPG-62 (each `WeaponChannels=1`) can only terminally guide ~4 SM-2s at
once — *that* is why a synchronized swarm saturates. This replaces the app's
hand-waved "interceptsPerWindow" with `Σ illuminator channels` over the window.

### 3d. Vessels (the unit stat files) — `vessels/*.ini`  **and** some `ships/*.ini`
⚠️ **Both folder names are used.** `vessels/` holds stat files; `ships/` usually
holds meshes/materials (`*_mat.ini`, `*deck*`, `*parts*`) — but some mods put
stats under `ships/`. Filter out `*_mat.ini` / material/collider files by
content (`[General]` + `[WeaponSystems]` present), not by folder name alone.

Structure (real example, Burke `usn_ddg_burke_f1_1996.ini`):
```
[WeaponSystems]
NumberOfWeaponSystems=24
AvailableLoadouts=051,051BF,052,...        // named fits
[WeaponSystem1]   # MK41 1
Type=Missile
SystemName=eu_mk41                          // → launcher in weapons.ini
ExternalGuidingSystems=SPG-62,SPG-51D,eu_AEGIS_BL9,...   // → sensors.ini (channels!)
NumberOfContainers=5                        // VLS cells in this group
ContainerN_HatchN=...                       // per-cell (mostly cosmetic)
…
[General] AvailableLoadouts=Default,Late
AssociatedMagazine=WeaponMagazineMK26_1     // ⚠ repeated key, one per system
[WeaponMagazineMK26_1] ModuleType=MediumMagazine
```
The **per-loadout missile fill** (which ammo, how many, in which magazine) is
keyed by loadout name. The exact key format wasn't fully nailed down — see Open
Questions §8. `templates/` in `original/` may hold loadout templates; inspect it.

---

## 4. The dependency graph to reconstruct per ship

```
Vessel.ini
 ├─ [WeaponSystemN].SystemName ───────► weapons.ini[launcher]  → ReloadTime, FireRate
 ├─ [WeaponSystemN].ExternalGuidingSystems ─► sensors.ini[radar] → Weapon/TargetChannels, MaxRange
 └─ AvailableLoadouts + magazines ────► ammo ids → ammunition/<id>.ini → speed, range, RCS
```
For the planner we ultimately want, per ship:
- **Offensive**: list of (missile, max count) it can carry (anti-ship loadouts).
- **Defensive**: ordered SAM/CIWS layers with `{ interceptorMissile, illuminatorChannels, reloadCycleS, maxRangeNm, pk? }` — the inputs to a channel-based saturation model.

---

## 5. Gotchas (these will bite)

1. **INI quirks**: comments are both `//` (inline) and `#`/`############` (line).
   Section headers contain spaces/dashes (`[ ---- CIWS ---- ]` are *dividers*, not
   real sections). **Duplicate keys** are legal and meaningful (`AssociatedMagazine`
   appears many times) — your INI reader must collect repeats into arrays, not
   overwrite.
2. **Units mix**: missiles in **nm/knots/feet**, sensors in **km/meters**. Normalize.
3. **`ships/` vs `vessels/`** naming (see §3d). Detect stat files by content.
4. **Deprecated / broken mods**: `_info.ini` `Name=[DEPRECATED] …`. Skip or flag.
5. **Year variants**: one ship → many files (`…_1996`, `_2003`, `_2025`). These are
   distinct presets, not dupes — key by filename, carry a display name + year.
6. **Mod override / load order**: mods override base files by matching id/filename.
   The game has an enabled-mods list + order (find it; likely under `user/` or a
   Steam/BepInEx config). For a first pass, **last-writer-wins by mod folder** with
   a manifest of collisions is acceptable — but record provenance (which mod each
   preset came from) so the user can tell base vs mod vs which mod.
7. **Cross-file refs can dangle** (a mod ship referencing a base launcher, or a
   missing illuminator). Resolve against the merged base+mods set; emit warnings,
   don't crash.
8. **Scale**: 2200+ ammo files, 800+ ships. Parse incrementally; cache.

---

## 6. Output schema (the app's contract — keep stable)

The app's entities live in `src/types.ts` (Missile, FriendlyShip, TargetShip,
DefenseLayer). Match those field names where they overlap. Proposed
`presets.json`:

```jsonc
{
  "generatedAt": "ISO-8601",
  "gameVersion": "from changelog.txt if detectable",
  "sources": [{ "modId": "3390330875", "name": "…", "deprecated": false }],
  "missiles": [{
    "id": "usn_rim-66c", "name": "RIM-66C (SM-2MR)",
    "role": "AAW|ASuW", "speedKnots": 720, "maxRangeNm": 90, "minRangeNm": 2,
    "guidance": "SARH|ARH|IR|…", "seaSkimming": true, "rcs": 0.1,
    "source": "base|<modId>"
  }],
  "launchers": [{ "id": "MK13", "reloadTimeS": 4, "fireRatePerMin": 8, "kind": "SmallLauncher|CIWS", "missileInterceptChance": null }],
  "illuminators": [{ "id": "SPG-62", "weaponChannels": 1, "targetChannels": 1, "maxRangeNm": 165 }],
  "ships": [{
    "id": "usn_ddg_burke_f1_2003", "name": "Arleigh Burke (Flight I, 2003)",
    "source": "3390330875",
    "loadouts": [{ "name": "052", "missiles": [{ "missileId": "usn_rim-66g", "count": 74 }, …] }],
    "defense": [{ "interceptorMissileId": "…", "launcherId": "eu_mk41", "illuminatorIds": ["SPG-62"], "channels": 4, "maxRangeNm": 90 }]
  }]
}
```
Confirm exact field names against `src/types.ts` before finalizing so the app can
consume it with minimal adapter code.

---

## 7. Suggested approach

- **Standalone TS/Node script** (its own folder/repo), CLI:
  `parse-seapower [--game <root>] [--mods <dir>] [--out presets.json]` — all
  paths optional, falling back to config → env → Steam auto-discovery (§2.1).
  Add `--print-config` (show resolved paths + mod set, parse nothing) so the user
  can sanity-check after moving the install or adding mods.
- Pure functions + a tiny INI tokenizer that handles `//`/`#` comments and
  repeated keys. **Unit-test the tokenizer** against the tricky samples in §3/§5.
- Pipeline: (1) index all files across base+mods, (2) resolve override order,
  (3) parse ammo→launchers→sensors→vessels, (4) cross-link, (5) emit JSON +
  a `warnings.log` (dangling refs, skipped deprecated mods, collisions).
- Validate output with a JSON schema; snapshot-test a few known ships
  (Ticonderoga, Burke Flight I) so game patches that break the format are caught.

---

## 8. Open questions to resolve while parsing

1. **Per-loadout ammo fill format** — how `AvailableLoadouts=051,052` maps to
   actual `{ammoId, count}` per cell/magazine. Read more vessel files +
   `original/templates/`. This is the one piece not fully decoded here.
2. **Enabled-mods list & load order** — where the game stores it; needed for
   correct override resolution (interim: last-writer-wins + collision report).
3. **SAM Pk** — CIWS expose `MissileInterceptChance`; do SAMs? If not, Pk may be
   derived from guidance/ECCM or left as a user-tunable default per layer.
4. **Channels per ship** — count illuminators referenced by a ship's
   `ExternalGuidingSystems` / sensor mounts to get the real simultaneous-guidance
   cap (the saturation number).

---

## 9. What the app will do with this (so you know the "why")

Next app phases (separate work, not yours): swap the hand-typed missile library
for these presets; replace flat "interceptsPerWindow" with a channel-based
defense model (`Σ illuminator channels × engagements/window`, optional Pk → a
*leak probability* instead of a binary verdict); then add an **inverse solver**
("minimum simultaneous arrivals to saturate this ship"). Your JSON is the
foundation for all three — accuracy and stable field names matter more than
covering every exotic mod on day one.
