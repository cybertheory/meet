'use client';

import * as React from 'react';
import { useParticipants } from '@livekit/components-react';
import { ParticipantKind } from 'livekit-client';
import { AGENT_PRESETS, type ListenMode, type RespondMode } from '@/lib/agents/presets';
import { useRoomAgents } from '@/lib/useRoomAgents';
import styles from '../styles/AgentsPanel.module.css';

/**
 * Settings-menu tab for adding/removing Tavus avatar agents in the current room.
 */
export function AgentsPanel() {
  const { agents, busy, error, addAgents, removeAgent, refresh } = useRoomAgents();
  const participants = useParticipants();
  const [count, setCount] = React.useState(3);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [respondMode, setRespondMode] = React.useState<RespondMode>('when_addressed');
  const [listenMode, setListenMode] = React.useState<ListenMode>('humans');
  const [customName, setCustomName] = React.useState('');
  const [customInstructions, setCustomInstructions] = React.useState('');

  // Identities of agent-kind participants that are actually connected, keyed by name
  const connectedAgentNames = React.useMemo(() => {
    const names = new Set<string>();
    for (const p of participants) {
      if (p.kind === ParticipantKind.AGENT && p.name) names.add(p.name.toLowerCase());
    }
    return names;
  }, [participants]);

  const togglePreset = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));

  const onAddPresets = async () => {
    await addAgents({
      count,
      presetIds: selected.length ? selected : undefined,
      respondMode,
      listenMode,
    }).catch(() => {});
  };

  const onAddCustom = async () => {
    if (!customName.trim()) return;
    await addAgents({
      agents: [{ name: customName.trim(), instructions: customInstructions.trim() }],
      respondMode,
      listenMode,
    }).catch(() => {});
    setCustomName('');
    setCustomInstructions('');
  };

  return (
    <div className={styles.panel}>
      <h3>AI agents in this room ({agents.length})</h3>
      <section>
        {agents.length === 0 && <p className={styles.muted}>No agents dispatched yet.</p>}
        <ul className={styles.list}>
          {agents.map((a) => {
            const online = connectedAgentNames.has(a.spec.name.toLowerCase());
            return (
              <li key={a.dispatchId} className={styles.row}>
                <span
                  className={online ? styles.dotOnline : styles.dotPending}
                  title={online ? 'connected' : 'joining…'}
                />
                <span className={styles.name}>{a.spec.name}</span>
                <span className={styles.muted}>
                  {a.spec.respondMode === 'always' ? 'replies to all' : 'replies when addressed'}
                </span>
                <button
                  className="lk-button"
                  disabled={busy}
                  onClick={() => removeAgent(a.dispatchId)}
                  aria-label={`Remove ${a.spec.name}`}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
        {agents.length > 0 && (
          <div className={styles.actions}>
            <button className="lk-button" disabled={busy} onClick={() => refresh()}>
              Refresh
            </button>
            <button className="lk-button" disabled={busy} onClick={() => removeAgent()}>
              Remove all
            </button>
          </div>
        )}
      </section>

      <h3>Add agents</h3>
      <section className={styles.form}>
        <label className={styles.field}>
          <span>How many</span>
          <input
            type="number"
            min={1}
            max={25}
            value={count}
            onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
        <label className={styles.field}>
          <span>Turn taking</span>
          <select
            value={respondMode}
            onChange={(e) => setRespondMode(e.target.value as RespondMode)}
          >
            <option value="when_addressed">Reply only when addressed by name</option>
            <option value="always">Reply to every turn (noisy with many agents)</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Listen to</span>
          <select value={listenMode} onChange={(e) => setListenMode(e.target.value as ListenMode)}>
            <option value="humans">Humans only</option>
            <option value="everyone">Everyone (agents can talk to each other)</option>
          </select>
        </label>
        <div className={styles.field}>
          <span>Personas (optional — leave empty to cycle through all)</span>
          <div className={styles.presets}>
            {AGENT_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`lk-button ${styles.preset}`}
                aria-pressed={selected.includes(p.id)}
                onClick={() => togglePreset(p.id)}
                title={p.tagline}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
        <button className="lk-button" disabled={busy} onClick={onAddPresets}>
          {busy ? 'Dispatching…' : `Add ${count} agent${count === 1 ? '' : 's'}`}
        </button>
      </section>

      <h3>Add a custom agent</h3>
      <section className={styles.form}>
        <label className={styles.field}>
          <span>Name</span>
          <input
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder="e.g. Max"
          />
        </label>
        <label className={styles.field}>
          <span>Instructions</span>
          <textarea
            rows={3}
            value={customInstructions}
            onChange={(e) => setCustomInstructions(e.target.value)}
            placeholder="You are Max, a skeptical CTO…"
          />
        </label>
        <button className="lk-button" disabled={busy || !customName.trim()} onClick={onAddCustom}>
          Add custom agent
        </button>
      </section>

      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
