import { useEffect, useRef, useState } from 'react';
import { useScenario, useUndoRedo } from '../hooks/useScenario';
import { downloadScenarioJson, importScenarios } from '../lib/storage';

type Props = {
  onOpenMissileLibrary: () => void;
};

export function Header({ onOpenMissileLibrary }: Props) {
  const { state, dispatch, activeScenario } = useScenario();
  const { undo, redo, canUndo, canRedo } = useUndoRedo();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(id);
  }, [notice]);

  const beginRename = (id: string, current: string) => {
    setConfirmId(null);
    setEditingId(id);
    setDraft(current);
  };
  const commitRename = () => {
    if (editingId) {
      const name = draft.trim();
      if (name) dispatch({ type: 'RENAME_SCENARIO', id: editingId, name });
    }
    setEditingId(null);
  };

  const onImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const result = importScenarios(text, {
        scenarios: state.scenarios,
        missileLibrary: state.missileLibrary,
      });
      const newScenarios = result.scenarios.slice(state.scenarios.length);
      dispatch({
        type: 'IMPORT_SCENARIOS',
        scenarios: newScenarios,
        missileLibrary: result.missileLibrary,
      });
      const renamed = result.renamedMissiles;
      const base = `Imported ${newScenarios.length} scenario${
        newScenarios.length === 1 ? '' : 's'
      }.`;
      setNotice(
        renamed.length === 0
          ? base
          : `${base} Renamed ${renamed.length} missile${
              renamed.length === 1 ? '' : 's'
            }: ${renamed.map((r) => `${r.from} → ${r.to}`).join(', ')}`,
      );
    } catch {
      setNotice('Import failed — file is not a valid scenario export.');
    }
  };

  const toolBtn =
    'rounded border border-panelBorder px-3 py-1 font-mono text-xs uppercase tracking-wider text-textSecondary hover:border-skyAccent/50 hover:bg-navy hover:text-textPrimary disabled:opacity-40 disabled:hover:border-panelBorder disabled:hover:text-textSecondary';

  return (
    <header className="border-b border-panelBorder bg-panel">
      <div className="flex items-center gap-2 px-4 py-2">
        <div className="flex flex-1 items-center gap-1 overflow-x-auto">
          {state.scenarios.map((s) => {
            const isActive = s.id === activeScenario?.id;
            if (editingId === s.id) {
              return (
                <input
                  key={s.id}
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  className="w-32 rounded border border-skyAccent bg-navy px-2 py-1 text-sm text-textPrimary outline-none focus:ring-1 focus:ring-skyAccent/20"
                />
              );
            }
            if (confirmId === s.id) {
              return (
                <span
                  key={s.id}
                  className="flex items-center gap-1 whitespace-nowrap rounded bg-navy px-2 py-1 text-sm text-textPrimary"
                >
                  Delete “{s.name}”?
                  <button
                    onClick={() => {
                      dispatch({ type: 'DELETE_SCENARIO', id: s.id });
                      setConfirmId(null);
                    }}
                    className="rounded px-1 text-redAccent hover:bg-redAccent/20"
                    title="Confirm delete"
                  >
                    ✓
                  </button>
                  <button
                    onClick={() => setConfirmId(null)}
                    className="rounded px-1 text-textSecondary hover:bg-panelBorder"
                    title="Cancel"
                  >
                    ✗
                  </button>
                </span>
              );
            }
            return (
              <span
                key={s.id}
                className={`group flex items-center whitespace-nowrap rounded border-b-2 ${
                  isActive
                    ? 'border-b-skyAccent bg-navy'
                    : 'border-b-transparent hover:bg-navy'
                }`}
              >
                <button
                  onClick={() => dispatch({ type: 'SET_ACTIVE_SCENARIO', id: s.id })}
                  onDoubleClick={() => beginRename(s.id, s.name)}
                  title="Double-click to rename"
                  className={`px-3 py-1 text-sm ${
                    isActive ? 'text-textPrimary' : 'text-textSecondary group-hover:text-textPrimary'
                  }`}
                >
                  {s.name}
                </button>
                <button
                  onClick={() => {
                    setEditingId(null);
                    setConfirmId(s.id);
                  }}
                  title="Delete scenario"
                  className="px-1.5 text-textSecondary opacity-0 hover:text-redAccent group-hover:opacity-100"
                >
                  ×
                </button>
              </span>
            );
          })}
          <button
            onClick={() => dispatch({ type: 'ADD_SCENARIO' })}
            className="rounded px-2 py-1 font-mono text-xs uppercase tracking-wider text-textSecondary hover:text-textPrimary"
          >
            + New
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() =>
              activeScenario &&
              dispatch({ type: 'DUPLICATE_SCENARIO', id: activeScenario.id })
            }
            disabled={!activeScenario}
            className={toolBtn}
          >
            Duplicate
          </button>
          <button
            onClick={() =>
              activeScenario && downloadScenarioJson(activeScenario, state.missileLibrary)
            }
            disabled={!activeScenario}
            className={toolBtn}
          >
            Export
          </button>
          <button onClick={() => fileInputRef.current?.click()} className={toolBtn}>
            Import
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onImportFile(file);
              e.target.value = '';
            }}
          />

          <span className="mx-1 h-5 w-px bg-panelBorder" />

          <button onClick={undo} disabled={!canUndo} className={toolBtn}>
            Undo
          </button>
          <button onClick={redo} disabled={!canRedo} className={toolBtn}>
            Redo
          </button>
          <button onClick={onOpenMissileLibrary} className={toolBtn}>
            Missile Library
          </button>
        </div>
      </div>

      {notice && (
        <div className="flex items-start justify-between gap-3 border-t border-panelBorder bg-navy px-4 py-1.5 text-xs text-textSecondary">
          <span>{notice}</span>
          <button
            onClick={() => setNotice(null)}
            className="shrink-0 text-textSecondary hover:text-textPrimary"
          >
            Dismiss
          </button>
        </div>
      )}
    </header>
  );
}
