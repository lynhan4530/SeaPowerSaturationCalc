import { useEffect } from 'react';
import { useScenario } from '../hooks/useScenario';
import type { Missile, Platform } from '../types';

type Props = {
  onClose: () => void;
};

const PLATFORM_OPTIONS: Platform[] = ['submarine', 'surface_ship', 'aircraft'];

const PLATFORM_LABEL: Record<Platform, string> = {
  submarine: 'Submarine',
  surface_ship: 'Surface ship',
  aircraft: 'Aircraft',
};

export function MissileLibrary({ onClose }: Props) {
  const { state, dispatch } = useScenario();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const update = (id: string, patch: Partial<Missile>) =>
    dispatch({ type: 'UPDATE_MISSILE', id, patch });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-[720px] flex-col overflow-hidden rounded border border-panelBorder bg-panel shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-panelBorder px-4 py-3">
          <h2 className="text-base font-semibold text-textPrimary">Missile Library</h2>
          <div className="flex gap-2">
            <button
              onClick={() => dispatch({ type: 'ADD_MISSILE' })}
              className="rounded bg-greenAccent/20 px-3 py-1 text-sm text-greenAccent hover:bg-greenAccent/30"
            >
              + Add missile
            </button>
            <button
              onClick={onClose}
              className="rounded border border-panelBorder px-3 py-1 text-sm text-textSecondary hover:text-textPrimary"
            >
              Close
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {state.missileLibrary.length === 0 ? (
            <p className="p-6 text-center text-sm italic text-textSecondary">
              No missiles defined. Click &ldquo;Add missile&rdquo; to start.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-panel text-left text-xs uppercase tracking-wide text-textSecondary">
                <tr className="border-b border-panelBorder">
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Speed (kts)</th>
                  <th className="px-4 py-2 font-medium">Max range (nm)</th>
                  <th className="px-4 py-2 font-medium">Platform</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {state.missileLibrary.map((m) => (
                  <tr key={m.id} className="border-b border-panelBorder/50">
                    <td className="px-4 py-2">
                      <input
                        type="text"
                        value={m.name}
                        onChange={(e) => update(m.id, { name: e.target.value })}
                        className="w-full bg-transparent text-textPrimary outline-none focus:bg-navy focus:px-1"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        min={0}
                        value={m.speedKnots}
                        onChange={(e) =>
                          update(m.id, { speedKnots: Number(e.target.value) })
                        }
                        className="w-24 bg-transparent text-textPrimary outline-none focus:bg-navy focus:px-1"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        min={0}
                        value={m.maxRangeNm}
                        onChange={(e) =>
                          update(m.id, { maxRangeNm: Number(e.target.value) })
                        }
                        className="w-24 bg-transparent text-textPrimary outline-none focus:bg-navy focus:px-1"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={m.platform}
                        onChange={(e) =>
                          update(m.id, { platform: e.target.value as Platform })
                        }
                        className="bg-navy px-2 py-1 text-textPrimary outline-none"
                      >
                        {PLATFORM_OPTIONS.map((p) => (
                          <option key={p} value={p}>
                            {PLATFORM_LABEL[p]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => dispatch({ type: 'DELETE_MISSILE', id: m.id })}
                        className="text-redAccent hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
