---

# Claude Code Handoff — Sea Power Saturation Planner

## Your Role
You are building a fire control planning web app for the game Sea Power. This is a complete spec. Implement exactly what is described. Do not add features not listed. Do not simplify described features.

---

## Tech Stack
- Vite + React + TypeScript
- Tailwind CSS
- No external state management library — `useReducer` + Context
- No drag libraries — plain pointer events for timeline
- Persistence: `localStorage`
- No backend, no auth, purely client-side

---

## Data Model

Define all of these in `src/types.ts`. This is the single source of truth.

```ts
type Platform = 'submarine' | 'surface_ship' | 'aircraft';

type Missile = {
  id: string;
  name: string;
  speedKnots: number;
  maxRangeNm: number;
  platform: Platform;
};

type Salvo = {
  id: string;
  missileId: string;
  count: number;
  rangeToTargetNm: number;
  bearingToTargetDeg: number;
  targetId: string;
};

type FriendlyShip = {
  id: string;
  name: string;
  speedKnots: number;
  magazineSize: number;
  salvos: Salvo[];
  notes?: string;
};

type TargetShip = {
  id: string;
  name: string;
  speedKnots: number;
  headingDeg: number;
  defenseLayers: DefenseLayer[];
};

type DefenseLayer = {
  id: string;
  name: string;
  interceptsPerWindow: number;
  windowS: number;
  minRangeNm?: number;
  maxRangeNm?: number;
};

type Scenario = {
  id: string;
  name: string;
  notes?: string;
  simultaneityToleranceS: number;
  repositionWarningThresholdS: number;
  friendlyShips: FriendlyShip[];
  targetShips: TargetShip[];
};

type AppState = {
  scenarios: Scenario[];
  activeScenarioId: string | null;
  missileLibrary: Missile[];
};
```

---

## File Structure

Build exactly this structure. No deviations.

```
src/
  types.ts
  App.tsx
  main.tsx
  hooks/
    useScenario.ts       # useReducer + all actions + localStorage sync
  lib/
    calc.ts              # all pure solver functions
    storage.ts           # localStorage read/write, export, import
    geo.ts               # projectPosition, bearingTo, distance helpers
  components/
    Header.tsx           # scenario tabs, new, duplicate, export, import
    LeftPanel.tsx        # friendly ships + target ships builder
    RightPanel.tsx       # timeline + results
    Timeline.tsx         # read-only swimlane renderer
    ResultsPanel.tsx     # per-target solution blocks + saturation
    MissileLibrary.tsx   # modal for managing missile library
    CompassInput.tsx     # bearing number input + live SVG compass rose
    DefenseLayerEditor.tsx
```

---

## Stage Instructions

**Build in exactly 6 stages. Complete each stage fully before starting the next. At the end of each stage, the app must run without errors.**

---

### Stage 1 — Foundation

**What to build:**
- Vite + React + TS + Tailwind scaffold
- `src/types.ts` with all types above
- `src/lib/geo.ts` — implement these three functions:

```ts
// Project a position given start bearing and distance
function projectPosition(
  startRangeNm: number,
  startBearingDeg: number,
  travelDistanceNm: number,
  travelHeadingDeg: number
): { rangeNm: number; bearingDeg: number }

// Bearing from position A to position B (both in range/bearing from shared origin)
function bearingTo(
  aRangeNm: number, aBearingDeg: number,
  bRangeNm: number, bBearingDeg: number
): number

// Distance between two positions (range/bearing from shared origin)
function distance(
  aRangeNm: number, aBearingDeg: number,
  bRangeNm: number, bBearingDeg: number
): number
```

- `src/lib/calc.ts` — implement all solver functions (details in Solver section below). Export them all. Write no UI yet.
- `src/lib/storage.ts` — `loadState()`, `saveState()`, `exportScenario(scenario)`, `importScenarios(json, existingLibrary)` with rename-on-collision for missile names
- `src/hooks/useScenario.ts` — `useReducer` with these actions:
  - `ADD_SCENARIO`, `DUPLICATE_SCENARIO`, `DELETE_SCENARIO`, `RENAME_SCENARIO`, `SET_ACTIVE_SCENARIO`
  - `ADD_FRIENDLY_SHIP`, `UPDATE_FRIENDLY_SHIP`, `DELETE_FRIENDLY_SHIP`
  - `ADD_SALVO`, `UPDATE_SALVO`, `DELETE_SALVO`
  - `ADD_TARGET_SHIP`, `UPDATE_TARGET_SHIP`, `DELETE_TARGET_SHIP`
  - `ADD_DEFENSE_LAYER`, `UPDATE_DEFENSE_LAYER`, `DELETE_DEFENSE_LAYER`
  - `ADD_MISSILE`, `UPDATE_MISSILE`, `DELETE_MISSILE`
  - `UNDO`, `REDO`
  - Auto-saves to localStorage on every dispatch except `UNDO`/`REDO`
  - History stack: keep last 50 states
- `src/App.tsx` — renders Header, LeftPanel, RightPanel as empty shells with placeholder text
- `src/components/MissileLibrary.tsx` — modal triggered from Header. Lists missiles. Add/edit/delete. Fields: name, speed (kts), max range (nm), platform (dropdown). Fully functional against `useScenario` actions.

**Deliverable:** App loads, missile library modal works, state persists on refresh, undo/redo works on missile library edits.

---

### Stage 2 — Left Panel

**What to build:** `src/components/LeftPanel.tsx` split into two sections.

**Section 1 — Friendly Ships:**
- List of friendly ships with add button
- Per ship: name (inline edit), speed (kts), magazine size
- Magazine warning badge: if `sum(salvo.count) > magazineSize` show yellow badge `"X/Y — over limit"`
- Per ship: list of salvos with add button
- Per salvo:
  - Missile: dropdown from missile library
  - Count: number input
  - Range to target: number input (nm)
  - Bearing to target: `CompassInput` component (see below)
  - Target: dropdown from target ships in scenario
  - Delete button

**Section 2 — Target Ships:**
- List of target ships with add button
- Per target: name (inline edit), speed (kts), heading (`CompassInput`)
- Per target: list of defense layers via `DefenseLayerEditor`
- Defense layer fields: name, intercepts per window, window (seconds), min range (nm, optional), max range (nm, optional)
- Drag handle to reorder defense layers (pointer events, no library) — order = engagement priority outermost first

**CompassInput component (`src/components/CompassInput.tsx`):**
- Number input field (0–360)
- SVG compass rose next to it: circle with N/S/E/W labels, rotating arrow indicator that updates live as number changes
- Arrow points in the entered direction

**Deliverable:** Full ship and target configuration works. Magazine warning appears correctly. Compass input renders and updates live.

---

### Stage 3 — Solver (`calc.ts`)

**This is the most critical stage. Build and test all pure functions before any UI consumes them.**

Implement in `src/lib/calc.ts`:

```ts
// 1. Iterative intercept solver for one ship vs one target
export function solveIntercept(
  ship: FriendlyShip,
  salvo: Salvo,
  missile: Missile,
  target: TargetShip
): InterceptResult

type InterceptResult = {
  shipId: string;
  salvoId: string;
  targetId: string;
  converged: boolean;
  iterations: number;
  repositionTimeS: number;      // 0 if already in range
  optimalHeadingDeg: number;    // heading to steam during reposition
  waitTimeS: number;            // set during group sync, 0 from this function
  fireTimeS: number;            // = repositionTimeS
  flightTimeS: number;
  arrivalTimeS: number;         // = fireTimeS + flightTimeS
  firingRangeNm: number;        // range at moment of firing
  repositionWarning: boolean;   // repositionTimeS > scenario.repositionWarningThresholdS
};

// Algorithm (max 20 iterations):
// estimatedArrivalTime = (salvo.rangeToTargetNm / missile.speedKnots) * 3600
// loop:
//   targetPos = projectPosition(salvo.range, salvo.bearing,
//               (target.speedKnots * estimatedArrivalTime / 3600), target.headingDeg)
//   closingDist = max(0, distance(ship at origin, targetPos) - missile.maxRangeNm)
//   repositionTimeS = (closingDist / ship.speedKnots) * 3600
//   optimalHeading = bearingTo(origin, targetPos)
//   shipFiringPos = projectPosition(0, 0, ship.speedKnots * repositionTimeS / 3600, optimalHeading)
//   newRange = distance(shipFiringPos, targetPos)
//   flightTimeS = (newRange / missile.speedKnots) * 3600
//   newArrivalTime = repositionTimeS + flightTimeS
//   if abs(newArrivalTime - estimatedArrivalTime) < 1 → converged
//   estimatedArrivalTime = newArrivalTime

// 2. Group sync — solve all ships for one target, slip to latest arrival
export function solveGroup(
  ships: FriendlyShip[],
  salvos: Salvo[],           // only salvos targeting this target
  missiles: Missile[],
  target: TargetShip,
  scenario: Scenario
): GroupResult

type GroupResult = {
  targetId: string;
  synchronizedArrivalTimeS: number;
  shipResults: InterceptResult[];  // with waitTimeS filled in
  repositionWarnings: string[];    // ship names with reposition > threshold
  nonConvergedWarnings: string[];  // ship names where solver didn't converge
};

// 3. Saturation analysis
export function computeSaturation(
  groupResult: GroupResult,
  target: TargetShip,
  missiles: Missile[]
): SaturationResult

type SaturationResult = {
  totalIncoming: number;
  bearingClusters: BearingCluster[];
  layerResults: LayerResult[];
  hullImpacts: number;
  saturated: boolean;
};

type LayerResult = {
  layerName: string;
  incoming: number;
  intercepted: number;
  leakers: number;
};

type BearingCluster = {
  centerDeg: number;
  count: number;
};

// 4. Bearing clustering — 30° buckets, wrap-around safe
export function clusterBearings(bearings: number[]): BearingCluster[]

// 5. Layer-by-layer breakdown
// - Layers ordered outermost first (as stored)
// - Each layer: respect minRangeNm/maxRangeNm if set (skip layer if salvo range outside envelope)
// - intercepted = min(incoming_in_window, interceptsPerWindow) per windowS
// - leakers pass to next layer
export function computeLayerBreakdown(
  salvos: Salvo[],
  arrivalTimes: number[],
  layers: DefenseLayer[],
  missiles: Missile[]
): LayerResult[]
```

**Write unit tests for every function covering these cases exactly:**
- TC-01 through TC-17 from the test suite (basic flight time, repositioning, moving target, convergence)
- TC-21 through TC-27 (saturation and bearing clustering)
- TC-35 (near-zero range, no crash)
- TC-36 (very long flight time)

Use Vitest. Tests live in `src/lib/__tests__/calc.test.ts`.

**Deliverable:** All tests pass. No UI changes.

---

### Stage 4 — Results Panel

**What to build:** `src/components/ResultsPanel.tsx`

One section per target ship. Each section contains:

**Per-ship solution block:**
```
Ship A — Harpoon Block II
Status: In range
Wait: 2778s | Fire at: T+2778s (14:46:18) | Flight: 814s | Arrives: T+3592s (14:59:52)
Delta from group: 0s ✓
```

```
Ship B — Exocet MM40
Status: Repositioning required
Head: 047° for 53min | Fire at: T+3180s (14:53:00) | Flight: 412s | Arrives: T+3592s
Delta from group: 0s ✓
⚠️ Repositioning exceeds 1 hour
```

```
Ship C — Harpoon Block II
Status: ⚠️ Non-converged solution
Best estimate: Fire at T+4100s | Arrives: T+4850s
Delta from group: +1258s ✗
```

**Arrival table** (compact, below solution blocks):
| Ship | Missile | Count | Wait | Fire at | Arrives | Delta |
- Delta column: green "0s ✓" if within tolerance, red "+Xs ✗" or "−Xs ✗" if outside
- Time displayed as both T+Xs and clock time if H-hour is set in scenario

**Saturation section (collapsible, closed by default):**
- Bearing diversity: mini SVG compass rose (120px) showing approach vectors, one line per salvo colored by ship
- Missiles per arrival window bar chart (simple HTML/CSS bars, no chart library)
- Layer-by-layer table: Layer name | Incoming | Intercepted | Leakers
- Final row bold: Hull impacts
- Verdict card: green "DEFENDED — 0 missiles reach hull" or red "SATURATED — X missiles reach hull"

**H-hour input:** Small input at top of ResultsPanel. Optional. Format HH:MM:SS. When set, all T+Xs values display with clock time in parentheses.

**Deliverable:** Results panel renders correct solution for any scenario configuration. Saturation collapses and expands. H-hour converts times correctly.

---

### Stage 5 — Timeline

**What to build:** `src/components/Timeline.tsx`

Read-only swimlane visualization. One swimlane per friendly ship.

**Each salvo bar shows three phases as colored segments in sequence:**
- Wait phase: gray — from T=0 to `waitTimeS`
- Reposition phase: amber — from `waitTimeS` to `waitTimeS + repositionTimeS`
- Flight phase: blue — from fire time to arrival time
- If no wait and no reposition, bar is entirely blue (flight only)

**Arrival markers:**
- Vertical red tick at `arrivalTimeS` on each ship's swimlane
- Horizontal dashed red line at the synchronized arrival time crossing all swimlanes
- Green shaded band: `±simultaneityToleranceS` around synchronized arrival

**Controls:**
- Scroll wheel on timeline: zoom in/out (min 1px/s, max 20px/s)
- Drag on empty swimlane space: pan left/right
- No drag on bars — timeline is read-only output

**Axis:**
- X-axis: time in seconds, tick marks every 60s (or 300s when zoomed out)
- Labels: T+Xs, and clock time below if H-hour set
- Y-axis: ship names, fixed left column 120px wide

**Colors per ship:** Cycle through this palette in order:
`['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16']`

**Deliverable:** Timeline renders all phases correctly. Zoom and pan work. Arrival convergence band visible.

---

### Stage 6 — Polish

**What to build:**

**Header (`src/components/Header.tsx`):**
- Scenario tabs: click to switch, double-click to rename inline, × to delete (confirm dialog)
- `[+ New]` button: creates blank scenario with default tolerance 10s, warning threshold 3600s
- `[Duplicate]` button: clones active scenario with "(copy)" suffix, deep clone no shared refs
- `[Export]` button: downloads `scenario_[name]_[timestamp].json` with full `AppState`
- `[Import]` button: file input, accepts `.json`, missile collision → rename to `"Name (2)"`, appends scenarios without overwriting

**Theme:**
- Dark navy background: `#0A0F1E`
- Panel background: `#111827`
- Border color: `#1F2937`
- Text primary: `#F9FAFB`
- Text secondary: `#9CA3AF`
- Accent amber: `#F59E0B`
- Accent red: `#EF4444`
- Accent green: `#10B981`
- Apply via Tailwind config custom colors

**Misc:**
- Tooltip on every salvo bar in timeline: missile name, count, bearing, range
- Magazine warning badge on ship name in left panel
- Non-converged warning badge on ship name in left panel and results panel
- Reposition >1hr warning badge in results panel
- Scenario notes: textarea under scenario name in a collapsed section
- Empty state messages when no ships/targets added yet

**Deliverable:** Full app, styled, all features working end to end.

---

## Solver Details (reference for Stage 3)

### Coordinate system
All positions stored as `{ rangeNm, bearingDeg }` relative to each ship's own origin. Each ship is its own reference frame. The solver works entirely in polar coordinates converted to Cartesian internally for geometry.

### Cartesian conversion (internal to geo.ts)
```ts
// bearing is clockwise from north, convert to math angle
x = range * sin(bearingRad)
y = range * cos(bearingRad)
```

### projectPosition
```ts
// Given a position (range, bearing) and a displacement (distance, heading),
// return new position
function projectPosition(rangeNm, bearingDeg, distanceNm, headingDeg):
  x = rangeNm * sin(toRad(bearingDeg))
  y = rangeNm * cos(toRad(bearingDeg))
  dx = distanceNm * sin(toRad(headingDeg))
  dy = distanceNm * cos(toRad(headingDeg))
  nx = x + dx
  ny = y + dy
  return {
    rangeNm: sqrt(nx²+ny²),
    bearingDeg: (toDeg(atan2(nx, ny)) + 360) % 360
  }
```

### Bearing clustering (30° buckets, wrap-around safe)
```ts
// Normalize bearing to 0–360
// Bucket = floor(bearing / 30)
// Special case: 345°–360° and 0°–15° are same bucket (bucket 0)
// Use modulo arithmetic: bucket = floor(((bearing + 15) % 360) / 30)
```

---

## Test Cases Reference

All test cases are defined. Stage 3 must implement unit tests for these IDs:

**Solver tests:** TC-01, TC-02, TC-03, TC-04, TC-05, TC-06, TC-07, TC-08, TC-09, TC-10, TC-11, TC-12, TC-13, TC-14, TC-15, TC-16, TC-17

**Saturation tests:** TC-21, TC-22, TC-23, TC-24, TC-25, TC-26, TC-27

**Edge cases:** TC-35, TC-36

Full test case definitions:

**TC-01:** Ship A Harpoon 537kts 60nm → flight 402s. Ship B Exocet 590kts 55nm → flight 335s. Solver slips B by 67s. Both arrive T+402s. Delta 0s.

**TC-02:** Ship A 537kts 50nm → 335s. Ship B 680kts 80nm → 424s. Ship C 420kts 30nm → 257s. All arrive T+424s. A waits 89s. C waits 167s.

**TC-03:** Single ship in range. Expect: wait 0, reposition 0, fire T+0.

**TC-04:** Two identical ships identical range. Expect: both fire T+0, delta 0s.

**TC-05:** Ship B missile max 50nm, target 70nm, ship 30kts. Closing 20nm → 2400s reposition. Ship A arrives T+2760s. Ship B repositions 2400s + flight → arrives T+2760s. No warning.

**TC-06:** Closing 27nm at 27kts = exactly 3600s. No warning (threshold is strictly >3600s).

**TC-07:** Closing 27.01nm at 27kts = 3600.02s. Red reposition warning shown.

**TC-08:** Target 35kts heading away. Ship 28kts. Solver hits 20 iterations. converged=false. Best-effort result + warning.

**TC-09:** Ship A repositions 40min. Ship B repositions 75min. Ship A waits 35min before starting. Ship B repositions immediately. Red warning on Ship B.

**TC-10:** Target heading toward Ship B at 25kts. Ship B stationary, missile range 50nm, target 65nm. Solver finds: no reposition needed, wait until T+2160s when target enters range.

**TC-11:** Target 20kts heading 090° away. Ship A target at 40nm bearing 090°. Solver converges on ~44nm effective range, not 40nm.

**TC-12:** Target heading 000°, Ship A bearing to target 090°. Solver converges on intercept point northeast of current target pos.

**TC-13:** Target 30kts heading directly toward Ship A. Range 70nm. By fire time target at ~55nm. Flight time shorter than naive.

**TC-14:** Two ships, target heading 045°. Ship A from west, Ship B from east (target moving away from B). Different reposition profiles.

**TC-15:** Stationary target. Converges in 1 iteration.

**TC-16:** Target 15kts, repositioning needed. Converges in ≤5 iterations.

**TC-17:** Pathological non-convergence. converged=false, iterations=20, result still returned.

**TC-21:** 8 missiles, SM-2 6/30s, CIWS 4/5s, all within 8s. SM-2 intercepts 6, leakers 2. CIWS intercepts 2, leakers 0. Hull impacts 0.

**TC-22:** 16 missiles within 8s, SM-2 6/30s, CIWS 4/5s. SM-2 intercepts 6, leakers 10. CIWS intercepts 4, leakers 6. Hull impacts 6.

**TC-23:** SM-2 min range 5nm. Salvo at 3nm. SM-2 skipped. Passes to CIWS.

**TC-24:** SM-2 max range 80nm. Salvo at 95nm. SM-2 skipped.

**TC-25:** 4 salvos all bearing 045°. 1 cluster.

**TC-26:** Salvos at 000°, 090°, 180°, 270°. 4 clusters.

**TC-27:** Salvos at 344° and 016°. Same north cluster. Do not split at 360°/0° boundary.

**TC-35:** Range 0.1nm, speed 537kts. Flight time 0.67s. No crash, no division by zero.

**TC-36:** Range 990nm, speed 537kts. Flight time ~6637s. No overflow.

---

## Constraints & Rules

- Never use `any` in TypeScript
- All solver functions must be pure — no side effects, no imports from React
- `calc.ts` and `geo.ts` must have zero React imports
- All numbers displayed to user: round to 1 decimal for nm/kts, round to whole seconds for time
- Bearing inputs clamp to 0–359 (360 normalizes to 0)
- Division by zero guard: if `ship.speedKnots === 0` and repositioning is needed, mark as unsolvable immediately without iterating
- If `missile.speedKnots === 0`, mark as unsolvable
- All `id` fields: use `crypto.randomUUID()`
- Default new scenario: `simultaneityToleranceS: 10`, `repositionWarningThresholdS: 3600`

---

## What NOT to Build
- No map rendering
- No actual lat/lon coordinates — range/bearing only
- No multiplayer
- No backend
- No authentication
- No drag-to-reorder on anything except defense layers in Stage 2
- No animation on timeline bars
- No mobile layout