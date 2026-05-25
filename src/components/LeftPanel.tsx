import { useEffect, useState, useRef } from 'react';
import { useScenario } from '../hooks/useScenario';
import type { FriendlyShip, Salvo, TargetShip, ShipPreset, MissilePreset } from '../types';
import { CompassInput } from './CompassInput';
import { DefenseLayerEditor } from './DefenseLayerEditor';
import { db } from '../lib/db';
import { getMagazineSizeForShip, getMissilesForShip, buildDefenseLayersForShip } from '../lib/vesselSync';

export function LeftPanel() {
  const { state, dispatch, activeScenario } = useScenario();

  if (!activeScenario) {
    return (
      <aside className="w-1/3 min-w-[360px] overflow-y-auto border-r border-panelBorder bg-panel p-4 text-sm text-textSecondary">
        <p className="italic">No active scenario.</p>
      </aside>
    );
  }

  const scenarioId = activeScenario.id;

  return (
    <aside className="w-1/3 min-w-[400px] overflow-y-auto border-r border-panelBorder bg-panel">
      <section className="border-b border-panelBorder p-3">
        <h3 className="mb-2 text-sm font-bold uppercase tracking-widest text-textSecondary">
          Scenario Notes
        </h3>
        <textarea
          value={activeScenario.notes ?? ''}
          onChange={(e) =>
            dispatch({ type: 'UPDATE_SCENARIO', id: scenarioId, patch: { notes: e.target.value } })
          }
          placeholder="Mission notes, assumptions, intent…"
          rows={2}
          className="w-full resize-y rounded border border-panelBorder bg-navy px-2 py-1 text-xs text-textPrimary outline-none focus:border-skyAccent focus:ring-1 focus:ring-skyAccent/20"
        />
      </section>

      <Section
        title="Friendly Ships"
        onAdd={() => dispatch({ type: 'ADD_FRIENDLY_SHIP', scenarioId })}
        empty={activeScenario.friendlyShips.length === 0 ? 'No friendly ships.' : null}
      >
        {activeScenario.friendlyShips.map((ship) => (
          <FriendlyShipCard
            key={ship.id}
            scenarioId={scenarioId}
            ship={ship}
            targets={activeScenario.targetShips}
            fallbackMissiles={state.missileLibrary}
          />
        ))}
      </Section>

      <Section
        title="Target Ships"
        onAdd={() => dispatch({ type: 'ADD_TARGET_SHIP', scenarioId })}
        empty={activeScenario.targetShips.length === 0 ? 'No target ships.' : null}
      >
        {activeScenario.targetShips.map((target) => (
          <TargetShipCard key={target.id} scenarioId={scenarioId} target={target} />
        ))}
      </Section>
    </aside>
  );
}

function Section({
  title,
  onAdd,
  empty,
  children,
}: {
  title: string;
  onAdd: () => void;
  empty: string | null;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-panelBorder p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-widest text-textSecondary">
          {title}
        </h3>
        <button
          onClick={onAdd}
          className="rounded bg-greenAccent/20 px-2 py-0.5 text-xs text-greenAccent hover:bg-greenAccent/30"
        >
          + Add
        </button>
      </div>
      {empty ? (
        <p className="text-xs italic text-textSecondary">{empty}</p>
      ) : (
        <div className="space-y-3">{children}</div>
      )}
    </section>
  );
}

function VesselSelector({
  onSelect,
  placeholder = 'Search ship class...',
}: {
  onSelect: (ship: ShipPreset) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ShipPreset[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const search = async () => {
      const lowercaseQuery = query.toLowerCase();
      const allShips = await db.ships.toArray();
      const matched = allShips.filter(
        (s) =>
          s.name.toLowerCase().includes(lowercaseQuery) ||
          (s.nickname && s.nickname.toLowerCase().includes(lowercaseQuery)),
      );
      setResults(matched.slice(0, 10));
    };
    const tid = setTimeout(search, 150);
    return () => clearTimeout(tid);
  }, [query]);

  return (
    <div ref={containerRef} className="relative w-full text-xs">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="w-full rounded border border-panelBorder bg-navy px-2 py-1 text-textPrimary outline-none focus:border-skyAccent focus:ring-1 focus:ring-skyAccent/20"
      />
      {open && results.length > 0 && (
        <ul className="absolute left-0 right-0 z-50 mt-1 max-h-48 overflow-y-auto rounded border border-panelBorder bg-panel shadow-lg">
          {results.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => {
                  onSelect(s);
                  setQuery('');
                  setOpen(false);
                }}
                className="w-full px-3 py-1.5 text-left text-textPrimary hover:bg-navy hover:text-white"
              >
                <div className="font-semibold">{s.name}</div>
                <div className="text-[10px] text-textSecondary">
                  {s.nickname ? `${s.nickname} | ` : ''}
                  {s.category || s.unitType} | Source: {s.source}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FriendlyShipCard({
  scenarioId,
  ship,
  targets,
  fallbackMissiles,
}: {
  scenarioId: string;
  ship: FriendlyShip;
  targets: TargetShip[];
  fallbackMissiles: ReturnType<typeof useScenario>['state']['missileLibrary'];
}) {
  const { dispatch } = useScenario();
  const [preset, setPreset] = useState<ShipPreset | null>(null);
  const [availableMissiles, setAvailableMissiles] = useState<MissilePreset[]>([]);

  const totalLoaded = ship.salvos.reduce((sum, s) => sum + (Number.isFinite(s.count) ? s.count : 0), 0);
  const overMagazine = totalLoaded > ship.magazineSize;

  const update = (patch: Partial<FriendlyShip>) =>
    dispatch({ type: 'UPDATE_FRIENDLY_SHIP', scenarioId, shipId: ship.id, patch });

  useEffect(() => {
    if (ship.presetId) {
      db.ships.get(ship.presetId).then((p) => {
        if (p) {
          setPreset(p);
          getMissilesForShip(p, ship.loadout || 'Default').then(setAvailableMissiles);
        }
      });
    } else {
      setPreset(null);
      setAvailableMissiles([]);
    }
  }, [ship.presetId, ship.loadout]);

  const handleSelectPreset = (selectedPreset: ShipPreset) => {
    const defaultLoadout = selectedPreset.loadouts[0]?.name || 'Default';
    const magSize = getMagazineSizeForShip(selectedPreset, defaultLoadout);
    update({
      name: selectedPreset.name,
      speedKnots: selectedPreset.maxSpeedKnots ?? 25,
      magazineSize: magSize,
      presetId: selectedPreset.id,
      loadout: defaultLoadout,
    });
  };

  const handleChangeLoadout = (newLoadout: string) => {
    if (!preset) return;
    const magSize = getMagazineSizeForShip(preset, newLoadout);
    update({
      loadout: newLoadout,
      magazineSize: magSize,
    });
  };

  const handleClearLink = () => {
    update({
      presetId: undefined,
      loadout: undefined,
    });
  };

  // If the ship is linked, use the launcher-compatible missiles; otherwise fall back to manual library
  const missilesList = ship.presetId ? availableMissiles : fallbackMissiles;

  return (
    <div className="rounded border border-panelBorder bg-navy/40 p-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={ship.name}
          onChange={(e) => update({ name: e.target.value })}
          className="flex-1 bg-transparent text-sm font-medium text-textPrimary outline-none focus:bg-navy focus:px-1"
        />
        {overMagazine && (
          <span className="rounded-sm border border-amberAccent/30 bg-amberAccent/10 px-2 py-0.5 font-mono text-xs uppercase tracking-wider text-amberAccent">
            {totalLoaded}/{ship.magazineSize} &mdash; over limit
          </span>
        )}
        <button
          onClick={() => dispatch({ type: 'DELETE_FRIENDLY_SHIP', scenarioId, shipId: ship.id })}
          className="text-xs text-redAccent hover:underline"
        >
          Delete
        </button>
      </div>

      <div className="mt-2 space-y-2">
        {!ship.presetId ? (
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-textSecondary">
              Link with Game Preset
            </label>
            <VesselSelector onSelect={handleSelectPreset} placeholder="Link ship class..." />
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-1 rounded bg-navy/60 p-1 text-[11px] text-textSecondary">
            <span>
              Preset: <strong className="text-amberAccent">{preset?.nickname || preset?.name}</strong>
            </span>
            <div className="flex items-center gap-1.5">
              {preset && preset.loadouts.length > 0 && (
                <select
                  value={ship.loadout || 'Default'}
                  onChange={(e) => handleChangeLoadout(e.target.value)}
                  className="bg-panel px-1 py-0.5 text-textPrimary border border-panelBorder rounded outline-none"
                >
                  {preset.loadouts.map((l) => (
                    <option key={l.name} value={l.name}>
                      {l.name}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={handleClearLink}
                className="text-[10px] text-redAccent hover:underline"
              >
                Clear Link
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 text-xs text-textSecondary">
          <label className="flex items-center gap-1">
            Speed (kts)
            <input
              type="number"
              min={0}
              value={ship.speedKnots}
              onChange={(e) => update({ speedKnots: Number(e.target.value) })}
              className="ml-auto w-16 rounded border border-panelBorder bg-navy px-1 text-right font-mono text-textPrimary outline-none focus:border-skyAccent focus:ring-1 focus:ring-skyAccent/20"
            />
          </label>
          <label className="flex items-center gap-1">
            Magazine
            <input
              type="number"
              min={0}
              value={ship.magazineSize}
              onChange={(e) => update({ magazineSize: Number(e.target.value) })}
              className="ml-auto w-16 rounded border border-panelBorder bg-navy px-1 text-right font-mono text-textPrimary outline-none focus:border-skyAccent focus:ring-1 focus:ring-skyAccent/20"
            />
          </label>
        </div>
      </div>

      <div className="mt-2 space-y-2 border-t border-panelBorder pt-2">
        <div className="flex items-center justify-between">
          <h5 className="text-xs font-bold uppercase tracking-widest text-textSecondary">Salvos</h5>
          <button
            onClick={() => dispatch({ type: 'ADD_SALVO', scenarioId, shipId: ship.id })}
            disabled={missilesList.length === 0 || targets.length === 0}
            className="rounded border border-panelBorder px-2 py-0.5 text-xs text-textSecondary hover:text-textPrimary disabled:opacity-40"
            title={
              missilesList.length === 0
                ? 'No compatible ammunition in this ship loadout'
                : targets.length === 0
                ? 'Add a target ship first'
                : ''
            }
          >
            + Salvo
          </button>
        </div>
        {ship.salvos.length === 0 ? (
          <p className="text-xs italic text-textSecondary">No salvos.</p>
        ) : (
          ship.salvos.map((salvo) => (
            <SalvoRow
              key={salvo.id}
              scenarioId={scenarioId}
              shipId={ship.id}
              salvo={salvo}
              targets={targets}
              missiles={missilesList}
            />
          ))
        )}
      </div>
    </div>
  );
}

function SalvoRow({
  scenarioId,
  shipId,
  salvo,
  targets,
  missiles,
}: {
  scenarioId: string;
  shipId: string;
  salvo: Salvo;
  targets: TargetShip[];
  missiles: Array<{ id: string; name: string }>;
}) {
  const { dispatch } = useScenario();
  const update = (patch: Partial<Salvo>) =>
    dispatch({ type: 'UPDATE_SALVO', scenarioId, shipId, salvoId: salvo.id, patch });

  useEffect(() => {
    // If the selected missileId is invalid or absent, auto-select the first compatible one
    if (missiles.length > 0 && !missiles.some((m) => m.id === salvo.missileId)) {
      update({ missileId: missiles[0]?.id });
    }
  }, [missiles, salvo.missileId]);

  return (
    <div className="rounded border border-panelBorder/60 bg-panel p-2">
      <div className="grid grid-cols-2 gap-2 text-xs text-textSecondary">
        <label className="col-span-2 flex items-center gap-1">
          Missile
          <select
            value={salvo.missileId}
            onChange={(e) => update({ missileId: e.target.value })}
            className="ml-auto flex-1 rounded border border-panelBorder bg-navy px-1 py-0.5 text-textPrimary outline-none focus:border-skyAccent focus:ring-1 focus:ring-skyAccent/20"
          >
            {missiles.length === 0 && <option value="">—</option>}
            {missiles.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 flex items-center gap-1">
          Target
          <select
            value={salvo.targetId}
            onChange={(e) => update({ targetId: e.target.value })}
            className="ml-auto flex-1 rounded border border-panelBorder bg-navy px-1 py-0.5 text-textPrimary outline-none focus:border-skyAccent focus:ring-1 focus:ring-skyAccent/20"
          >
            {targets.length === 0 && <option value="">—</option>}
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          Count
          <input
            type="number"
            min={1}
            value={salvo.count}
            onChange={(e) => update({ count: Number(e.target.value) })}
            className="ml-auto w-16 rounded border border-panelBorder bg-navy px-1 text-right font-mono text-textPrimary outline-none focus:border-skyAccent focus:ring-1 focus:ring-skyAccent/20"
          />
        </label>
        <label className="flex items-center gap-1">
          Range (nm)
          <input
            type="number"
            min={0}
            value={salvo.rangeToTargetNm}
            onChange={(e) => update({ rangeToTargetNm: Number(e.target.value) })}
            className="ml-auto w-16 rounded border border-panelBorder bg-navy px-1 text-right font-mono text-textPrimary outline-none focus:border-skyAccent focus:ring-1 focus:ring-skyAccent/20"
          />
        </label>
        <div className="col-span-2 flex items-center justify-between gap-2">
          <span>Bearing</span>
          <CompassInput
            value={salvo.bearingToTargetDeg}
            onChange={(deg) => update({ bearingToTargetDeg: deg })}
            size={48}
            label="Bearing to target"
          />
        </div>
      </div>
      <div className="mt-1 text-right">
        <button
          onClick={() => dispatch({ type: 'DELETE_SALVO', scenarioId, shipId, salvoId: salvo.id })}
          className="text-xs text-redAccent hover:underline"
        >
          Delete salvo
        </button>
      </div>
    </div>
  );
}

function TargetShipCard({
  scenarioId,
  target,
}: {
  scenarioId: string;
  target: TargetShip;
}) {
  const { dispatch } = useScenario();
  const [preset, setPreset] = useState<ShipPreset | null>(null);

  const update = (patch: Partial<TargetShip>) =>
    dispatch({ type: 'UPDATE_TARGET_SHIP', scenarioId, targetId: target.id, patch });

  useEffect(() => {
    if (target.presetId) {
      db.ships.get(target.presetId).then((p) => {
        if (p) setPreset(p);
      });
    } else {
      setPreset(null);
    }
  }, [target.presetId]);

  const handleSelectPreset = async (selectedPreset: ShipPreset) => {
    const defaultLoadout = selectedPreset.loadouts[0]?.name || 'Default';
    const layers = await buildDefenseLayersForShip(selectedPreset, defaultLoadout);
    update({
      name: selectedPreset.name,
      speedKnots: selectedPreset.maxSpeedKnots ?? 20,
      presetId: selectedPreset.id,
      loadout: defaultLoadout,
      defenseLayers: layers,
    });
  };

  const handleChangeLoadout = async (newLoadout: string) => {
    if (!preset) return;
    const layers = await buildDefenseLayersForShip(preset, newLoadout);
    update({
      loadout: newLoadout,
      defenseLayers: layers,
    });
  };

  const handleClearLink = () => {
    update({
      presetId: undefined,
      loadout: undefined,
    });
  };

  return (
    <div className="rounded border border-panelBorder bg-navy/40 p-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={target.name}
          onChange={(e) => update({ name: e.target.value })}
          className="flex-1 bg-transparent text-sm font-medium text-textPrimary outline-none focus:bg-navy focus:px-1"
        />
        <button
          onClick={() => dispatch({ type: 'DELETE_TARGET_SHIP', scenarioId, targetId: target.id })}
          className="text-xs text-redAccent hover:underline"
        >
          Delete
        </button>
      </div>

      <div className="mt-2 space-y-2">
        {!target.presetId ? (
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-textSecondary">
              Link with Game Preset
            </label>
            <VesselSelector onSelect={handleSelectPreset} placeholder="Link ship class..." />
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-1 rounded bg-navy/60 p-1 text-[11px] text-textSecondary">
            <span>
              Preset: <strong className="text-amberAccent">{preset?.nickname || preset?.name}</strong>
            </span>
            <div className="flex items-center gap-1.5">
              {preset && preset.loadouts.length > 0 && (
                <select
                  value={target.loadout || 'Default'}
                  onChange={(e) => handleChangeLoadout(e.target.value)}
                  className="bg-panel px-1 py-0.5 text-textPrimary border border-panelBorder rounded outline-none"
                >
                  {preset.loadouts.map((l) => (
                    <option key={l.name} value={l.name}>
                      {l.name}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={handleClearLink}
                className="text-[10px] text-redAccent hover:underline"
              >
                Clear Link
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 text-xs text-textSecondary">
          <label className="flex items-center gap-1">
            Speed (kts)
            <input
              type="number"
              min={0}
              value={target.speedKnots}
              onChange={(e) => update({ speedKnots: Number(e.target.value) })}
              className="ml-auto w-16 rounded border border-panelBorder bg-navy px-1 text-right font-mono text-textPrimary outline-none focus:border-skyAccent focus:ring-1 focus:ring-skyAccent/20"
            />
          </label>
          <div className="flex items-center justify-between gap-1 col-span-1">
            <span>Heading</span>
            <CompassInput
              value={target.headingDeg}
              onChange={(deg) => update({ headingDeg: deg })}
              size={48}
              label="Target heading"
            />
          </div>
        </div>
      </div>

      <div className="mt-2 border-t border-panelBorder pt-2">
        <DefenseLayerEditor
          scenarioId={scenarioId}
          targetId={target.id}
          layers={target.defenseLayers}
        />
      </div>
    </div>
  );
}
