import { useRef, useState } from 'react';
import { useScenario } from '../hooks/useScenario';
import type { DefenseLayer } from '../types';

type Props = {
  scenarioId: string;
  targetId: string;
  layers: DefenseLayer[];
};

export function DefenseLayerEditor({ scenarioId, targetId, layers }: Props) {
  const { dispatch } = useScenario();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const update = (layerId: string, patch: Partial<DefenseLayer>) =>
    dispatch({ type: 'UPDATE_DEFENSE_LAYER', scenarioId, targetId, layerId, patch });

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
        <button
          onClick={() => dispatch({ type: 'ADD_DEFENSE_LAYER', scenarioId, targetId })}
          className="rounded border border-panelBorder px-2 py-0.5 font-mono text-xs uppercase tracking-wider text-textSecondary hover:border-skyAccent/50 hover:text-textPrimary"
        >
          + Layer
        </button>
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
                <span
                  onPointerDown={(e) => onPointerDown(e, layer.id)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  className="cursor-grab select-none px-1 text-textSecondary"
                  title="Drag to reorder"
                >
                  &#x2630;
                </span>
                <input
                  type="text"
                  value={layer.name}
                  onChange={(e) => update(layer.id, { name: e.target.value })}
                  className="flex-1 bg-transparent text-sm text-textPrimary outline-none"
                />
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
              </div>
              <div className="grid grid-cols-2 gap-2 px-3 pb-2 text-xs text-textSecondary">
                <label className="flex items-center gap-1">
                  Intercepts/win
                  <input
                    type="number"
                    min={0}
                    value={layer.interceptsPerWindow}
                    onChange={(e) =>
                      update(layer.id, { interceptsPerWindow: Number(e.target.value) })
                    }
                    className="ml-auto w-16 rounded border border-panelBorder bg-navy px-1 text-right font-mono text-textPrimary outline-none focus:border-skyAccent focus:ring-1 focus:ring-skyAccent/20"
                  />
                </label>
                <label className="flex items-center gap-1">
                  Window (s)
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={layer.windowS}
                    onChange={(e) =>
                      update(layer.id, { windowS: Number(e.target.value) })
                    }
                    className="ml-auto w-16 rounded border border-panelBorder bg-navy px-1 text-right font-mono text-textPrimary outline-none focus:border-skyAccent focus:ring-1 focus:ring-skyAccent/20"
                  />
                </label>
                <label className="flex items-center gap-1">
                  Min range (nm)
                  <input
                    type="number"
                    min={0}
                    value={layer.minRangeNm ?? ''}
                    placeholder="—"
                    onChange={(e) =>
                      update(layer.id, {
                        minRangeNm: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                    className="ml-auto w-16 rounded border border-panelBorder bg-navy px-1 text-right font-mono text-textPrimary outline-none focus:border-skyAccent focus:ring-1 focus:ring-skyAccent/20"
                  />
                </label>
                <label className="flex items-center gap-1">
                  Max range (nm)
                  <input
                    type="number"
                    min={0}
                    value={layer.maxRangeNm ?? ''}
                    placeholder="—"
                    onChange={(e) =>
                      update(layer.id, {
                        maxRangeNm: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                    className="ml-auto w-16 rounded border border-panelBorder bg-navy px-1 text-right font-mono text-textPrimary outline-none focus:border-skyAccent focus:ring-1 focus:ring-skyAccent/20"
                  />
                </label>
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
