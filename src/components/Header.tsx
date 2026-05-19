import { useScenario, useUndoRedo } from '../hooks/useScenario';

type Props = {
  onOpenMissileLibrary: () => void;
};

export function Header({ onOpenMissileLibrary }: Props) {
  const { state, dispatch, activeScenario } = useScenario();
  const { undo, redo, canUndo, canRedo } = useUndoRedo();

  return (
    <header className="flex items-center gap-2 border-b border-panelBorder bg-panel px-4 py-2">
      <div className="flex flex-1 gap-1 overflow-x-auto">
        {state.scenarios.map((s) => (
          <button
            key={s.id}
            onClick={() => dispatch({ type: 'SET_ACTIVE_SCENARIO', id: s.id })}
            className={`whitespace-nowrap rounded px-3 py-1 text-sm ${
              s.id === activeScenario?.id
                ? 'bg-navy text-textPrimary'
                : 'text-textSecondary hover:bg-navy hover:text-textPrimary'
            }`}
          >
            {s.name}
          </button>
        ))}
        <button
          onClick={() => dispatch({ type: 'ADD_SCENARIO' })}
          className="rounded px-2 py-1 text-sm text-textSecondary hover:text-textPrimary"
        >
          + New
        </button>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={undo}
          disabled={!canUndo}
          className="rounded border border-panelBorder px-3 py-1 text-sm disabled:opacity-40"
        >
          Undo
        </button>
        <button
          onClick={redo}
          disabled={!canRedo}
          className="rounded border border-panelBorder px-3 py-1 text-sm disabled:opacity-40"
        >
          Redo
        </button>
        <button
          onClick={onOpenMissileLibrary}
          className="rounded border border-panelBorder px-3 py-1 text-sm hover:bg-navy"
        >
          Missile Library
        </button>
      </div>
    </header>
  );
}
