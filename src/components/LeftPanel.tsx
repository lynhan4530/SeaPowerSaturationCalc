import { useScenario } from '../hooks/useScenario';
import type { FriendlyShip, Salvo, TargetShip } from '../types';
import { CompassInput } from './CompassInput';
import { DefenseLayerEditor } from './DefenseLayerEditor';

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
            missiles={state.missileLibrary}
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

function FriendlyShipCard({
  scenarioId,
  ship,
  targets,
  missiles,
}: {
  scenarioId: string;
  ship: FriendlyShip;
  targets: TargetShip[];
  missiles: ReturnType<typeof useScenario>['state']['missileLibrary'];
}) {
  const { dispatch } = useScenario();
  const totalLoaded = ship.salvos.reduce((sum, s) => sum + (Number.isFinite(s.count) ? s.count : 0), 0);
  const overMagazine = totalLoaded > ship.magazineSize;

  const update = (patch: Partial<FriendlyShip>) =>
    dispatch({ type: 'UPDATE_FRIENDLY_SHIP', scenarioId, shipId: ship.id, patch });

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
      <div className="mt-1 grid grid-cols-2 gap-2 text-xs text-textSecondary">
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

      <div className="mt-2 space-y-2 border-t border-panelBorder pt-2">
        <div className="flex items-center justify-between">
          <h5 className="text-xs font-bold uppercase tracking-widest text-textSecondary">Salvos</h5>
          <button
            onClick={() => dispatch({ type: 'ADD_SALVO', scenarioId, shipId: ship.id })}
            disabled={missiles.length === 0 || targets.length === 0}
            className="rounded border border-panelBorder px-2 py-0.5 text-xs text-textSecondary hover:text-textPrimary disabled:opacity-40"
            title={
              missiles.length === 0
                ? 'Add a missile to the library first'
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
              missiles={missiles}
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
  missiles: ReturnType<typeof useScenario>['state']['missileLibrary'];
}) {
  const { dispatch } = useScenario();
  const update = (patch: Partial<Salvo>) =>
    dispatch({ type: 'UPDATE_SALVO', scenarioId, shipId, salvoId: salvo.id, patch });

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
  const update = (patch: Partial<TargetShip>) =>
    dispatch({ type: 'UPDATE_TARGET_SHIP', scenarioId, targetId: target.id, patch });

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
      <div className="mt-1 grid grid-cols-2 gap-2 text-xs text-textSecondary">
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
        <div className="flex items-center justify-between gap-1">
          <span>Heading</span>
          <CompassInput
            value={target.headingDeg}
            onChange={(deg) => update({ headingDeg: deg })}
            size={48}
            label="Target heading"
          />
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
