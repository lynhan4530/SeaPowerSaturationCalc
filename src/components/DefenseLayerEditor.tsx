import { useRef, useState } from 'react';
import { useScenario } from '../hooks/useScenario';
import type { DefenseLayer, GuidanceType, WeaponSystem } from '../types';

type Props = {
  scenarioId: string;
  targetId: string;
  layers: DefenseLayer[];
  isPreset?: boolean;
};

const NUM_CLS =
  'w-16 rounded border border-panelBorder bg-navy px-1 text-right font-mono text-textPrimary outline-none focus:border-skyAccent focus:ring-1 focus:ring-skyAccent/20';

const GUIDANCE_OPTIONS: GuidanceType[] = ['SARH', 'ARH', 'gun'];

export function DefenseLayerEditor({ scenarioId, targetId, layers, isPreset = false }: Props) {
  const { dispatch } = useScenario();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const update = (layerId: string, patch: Partial<DefenseLayer>) =>
    dispatch({ type: 'UPDATE_DEFENSE_LAYER', scenarioId, targetId, layerId, patch });

  const updateSystem = (layerId: string, systemId: string, patch: Partial<WeaponSystem>) =>
    dispatch({ type: 'UPDATE_WEAPON_SYSTEM', scenarioId, targetId, layerId, systemId, patch });

  const computeDropIndex = (clientY: number): number => {
    const list = listRef.current;
    if (!list) return 0;
    const items = Array.from(list.querySelectorAll<HTMLLIElement>('li[data-layer-row]'));
    for (let i = 0; i < items.length; i += 1) {
      const rect = items[i].getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (clientY < mid) return i;
    }
    return items.length;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLSpanElement>, id: string) => {
    e.preventDefault();
    (e.currentTarget as HTMLSpanElement).setPointerCapture(e.pointerId);
    setDraggingId(id);
    setDropIndex(layers.findIndex((l) => l.id === id));
  };

  const onPointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!draggingId) return;
    setDropIndex(computeDropIndex(e.clientY));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!draggingId) return;
    const fromIdx = layers.findIndex((l) => l.id === draggingId);
    let toIdx = dropIndex ?? fromIdx;
    if (toIdx > fromIdx) toIdx -= 1;
    if (fromIdx !== toIdx && toIdx >= 0) {
      const next = layers.slice();
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      dispatch({
        type: 'REORDER_DEFENSE_LAYERS',
        scenarioId,
        targetId,
        orderedLayerIds: next.map((l) => l.id),
      });
    }
    (e.currentTarget as HTMLSpanElement).releasePointerCapture(e.pointerId);
    setDraggingId(null);
    setDropIndex(null);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold uppercase tracking-widest text-textSecondary">
          Defense layers (outermost first)
        </h4>
        {!isPreset && (
          <button
            onClick={() => dispatch({ type: 'ADD_DEFENSE_LAYER', scenarioId, targetId })}
            className="rounded border border-panelBorder px-2 py-0.5 font-mono text-xs uppercase tracking-wider text-textSecondary hover:border-skyAccent/50 hover:text-textPrimary"
          >
            + Layer
          </button>
        )}
      </div>
      {layers.length === 0 ? (
        <p className="text-xs italic text-textSecondary">No defense layers.</p>
      ) : (
        <ul ref={listRef} className="space-y-1">
          {layers.map((layer, idx) => (
            <li
              key={layer.id}
              data-layer-row
              className={`relative rounded border bg-navy/40 ${
                draggingId === layer.id ? 'border-amberAccent opacity-60' : 'border-panelBorder'
              }`}
            >
              {draggingId && dropIndex === idx && (
                <span className="pointer-events-none absolute -top-0.5 left-0 right-0 block h-0.5 bg-greenAccent" />
              )}
              <div className="flex items-center gap-2 px-2 py-1">
                {!isPreset && (
                  <span
                    onPointerDown={(e) => onPointerDown(e, layer.id)}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    className="cursor-grab select-none px-1 text-textSecondary"
                    title="Drag to reorder"
                  >
                    &#x2630;
                  </span>
                )}
                <input
                  type="text"
                  value={layer.name}
                  onChange={(e) => update(layer.id, { name: e.target.value })}
                  disabled={isPreset}
                  className="flex-1 bg-transparent text-sm text-textPrimary outline-none disabled:text-textSecondary/80"
                />
                {!isPreset && (
                  <button
                    onClick={() =>
                      dispatch({
                        type: 'DELETE_DEFENSE_LAYER',
                        scenarioId,
                        targetId,
                        layerId: layer.id,
                      })
                    }
                    className="text-xs text-redAccent hover:underline"
                  >
                    Delete
                  </button>
                )}
              </div>
              <div className="space-y-2 px-3 pb-2 text-xs text-textSecondary">
                <label 
                  className="flex items-center gap-1 cursor-help"
                  title="The sliding window duration in seconds during which incoming missiles are grouped together for defense allocation."
                >
                  Window (s)
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={layer.windowS}
                    onChange={(e) => update(layer.id, { windowS: Number(e.target.value) })}
                    disabled={isPreset}
                    className={`ml-auto ${NUM_CLS} disabled:opacity-70 disabled:cursor-not-allowed`}
                  />
                </label>

                <div className="flex items-center justify-between">
                  <span className="font-bold uppercase tracking-wider text-textSecondary/80">
                    Weapon systems
                  </span>
                  {!isPreset && (
                    <button
                      onClick={() =>
                        dispatch({
                          type: 'ADD_WEAPON_SYSTEM',
                          scenarioId,
                          targetId,
                          layerId: layer.id,
                        })
                      }
                      className="rounded border border-panelBorder px-2 py-0.5 font-mono uppercase tracking-wider text-textSecondary hover:border-skyAccent/50 hover:text-textPrimary"
                    >
                      + System
                    </button>
                  )}
                </div>

                {layer.weaponSystems.length === 0 ? (
                  <p className="italic text-textSecondary/70">
                    No weapon systems — this layer intercepts nothing.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {layer.weaponSystems.map((ws) => (
                      <li
                        key={ws.id}
                        className="space-y-1.5 rounded border border-panelBorder/70 bg-navy/30 p-2"
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={ws.name}
                            onChange={(e) => updateSystem(layer.id, ws.id, { name: e.target.value })}
                            disabled={isPreset}
                            className="flex-1 bg-transparent text-textPrimary outline-none disabled:text-textSecondary/80"
                          />
                          <select
                            value={ws.guidance}
                            onChange={(e) =>
                              updateSystem(layer.id, ws.id, {
                                guidance: e.target.value as GuidanceType,
                              })
                            }
                            disabled={isPreset}
                            className="rounded border border-panelBorder bg-navy px-1 py-0.5 font-mono text-textPrimary outline-none focus:border-skyAccent disabled:opacity-75 disabled:cursor-not-allowed"
                          >
                            {GUIDANCE_OPTIONS.map((g) => (
                              <option key={g} value={g}>
                                {g}
                              </option>
                            ))}
                          </select>
                          {!isPreset && (
                            <button
                              onClick={() =>
                                dispatch({
                                  type: 'DELETE_WEAPON_SYSTEM',
                                  scenarioId,
                                  targetId,
                                  layerId: layer.id,
                                  systemId: ws.id,
                                })
                              }
                              className="text-redAccent hover:underline"
                              title="Remove weapon system"
                            >
                              &times;
                            </button>
                          )}
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <label 
                            className="flex flex-col gap-0.5 cursor-help"
                            title="Number of simultaneous guidance channels (e.g. radar illuminators or fire control loops). Limits how many missiles can be guided at once."
                          >
                            <span className="text-[10px] uppercase tracking-wider">Channels</span>
                            <input
                              type="number"
                              min={0}
                              value={ws.channels}
                              onChange={(e) =>
                                updateSystem(layer.id, ws.id, { channels: Number(e.target.value) })
                              }
                              disabled={isPreset}
                              className={`w-full ${NUM_CLS} disabled:opacity-70 disabled:cursor-not-allowed`}
                            />
                          </label>
                          <label 
                            className="flex flex-col gap-0.5 cursor-help"
                            title="Re-engagements per channel. The number of defensive shots a single channel can guide in succession within one window."
                          >
                            <span className="text-[10px] uppercase tracking-wider">Eng/ch</span>
                            <input
                              type="number"
                              min={1}
                              value={ws.engagementsPerChannel}
                              onChange={(e) =>
                                updateSystem(layer.id, ws.id, {
                                  engagementsPerChannel: Number(e.target.value),
                                })
                              }
                              disabled={isPreset}
                              className={`w-full ${NUM_CLS} disabled:opacity-70 disabled:cursor-not-allowed`}
                            />
                          </label>
                          <label 
                            className="flex flex-col gap-0.5 cursor-help"
                            title="Single-shot probability of kill. The chance (0 to 1) that a single defensive shot intercepts its target."
                          >
                            <span className="text-[10px] uppercase tracking-wider">Pk</span>
                            <input
                              type="number"
                              min={0}
                              max={1}
                              step={0.05}
                              value={ws.pk}
                              onChange={(e) =>
                                updateSystem(layer.id, ws.id, { pk: Number(e.target.value) })
                              }
                              disabled={isPreset}
                              className={`w-full ${NUM_CLS} disabled:opacity-70 disabled:cursor-not-allowed`}
                            />
                          </label>
                          <label 
                            className="flex flex-col gap-0.5 cursor-help"
                            title="Minimum engagement range in nautical miles. Defensive systems cannot engage targets closer than this range."
                          >
                            <span className="text-[10px] uppercase tracking-wider">Min nm</span>
                            <input
                              type="number"
                              min={0}
                              value={ws.minRangeNm ?? ''}
                              placeholder="—"
                              onChange={(e) =>
                                updateSystem(layer.id, ws.id, {
                                  minRangeNm:
                                    e.target.value === '' ? undefined : Number(e.target.value),
                                })
                              }
                              disabled={isPreset}
                              className={`w-full ${NUM_CLS} disabled:opacity-70 disabled:cursor-not-allowed`}
                            />
                          </label>
                          <label 
                            className="flex flex-col gap-0.5 cursor-help"
                            title="Maximum engagement range in nautical miles. The physical limit of the weapon system's reach."
                          >
                            <span className="text-[10px] uppercase tracking-wider">Max nm</span>
                            <input
                              type="number"
                              min={0}
                              value={ws.maxRangeNm ?? ''}
                              placeholder="—"
                              onChange={(e) =>
                                updateSystem(layer.id, ws.id, {
                                  maxRangeNm:
                                    e.target.value === '' ? undefined : Number(e.target.value),
                                })
                              }
                              disabled={isPreset}
                              className={`w-full ${NUM_CLS} disabled:opacity-70 disabled:cursor-not-allowed`}
                            />
                          </label>
                          <label 
                            className="flex flex-col gap-0.5 cursor-help"
                            title="Defending missile speed in knots. Finite speed limits maximum intercept range and degrades re-engagement capacity against fast targets."
                          >
                            <span className="text-[10px] uppercase tracking-wider">Speed (kts)</span>
                            <input
                              type="number"
                              min={0}
                              value={ws.speedKnots ?? ''}
                              placeholder="—"
                              onChange={(e) =>
                                updateSystem(layer.id, ws.id, {
                                  speedKnots:
                                    e.target.value === '' ? undefined : Number(e.target.value),
                                })
                              }
                              disabled={isPreset}
                              className={`w-full ${NUM_CLS} disabled:opacity-70 disabled:cursor-not-allowed`}
                            />
                          </label>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
          {draggingId && dropIndex === layers.length && (
            <li className="pointer-events-none h-0.5 bg-greenAccent" />
          )}
        </ul>
      )}
    </div>
  );
}
