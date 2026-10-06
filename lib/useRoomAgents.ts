'use client';

import * as React from 'react';
import { useRoomContext } from '@livekit/components-react';
import type { AgentSpec, ListenMode, RespondMode } from '@/lib/agents/presets';

export const AGENTS_ENDPOINT = process.env.NEXT_PUBLIC_LK_AGENTS_ENDPOINT;
export const AGENTS_ENABLED = !!AGENTS_ENDPOINT;

export interface DispatchedAgent {
  dispatchId: string;
  spec: AgentSpec;
  createdAt: number;
}

export interface AddAgentsOptions {
  agents?: AgentSpec[];
  count?: number;
  presetIds?: string[];
  ensure?: boolean;
  respondMode?: RespondMode;
  listenMode?: ListenMode;
}

/**
 * Client-side helper around /api/agents for the current room: list, add and remove agents.
 */
export function useRoomAgents() {
  const room = useRoomContext();
  const [agents, setAgents] = React.useState<DispatchedAgent[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>();

  const refresh = React.useCallback(async () => {
    if (!AGENTS_ENDPOINT || !room.name) return;
    const res = await fetch(`${AGENTS_ENDPOINT}?roomName=${encodeURIComponent(room.name)}`);
    if (!res.ok) {
      setError(await res.text());
      return;
    }
    const data = await res.json();
    setAgents(data.agents ?? []);
  }, [room.name]);

  const addAgents = React.useCallback(
    async (opts: AddAgentsOptions) => {
      if (!AGENTS_ENDPOINT) throw new Error('NEXT_PUBLIC_LK_AGENTS_ENDPOINT is not set');
      setBusy(true);
      setError(undefined);
      try {
        const res = await fetch(AGENTS_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomName: room.name, ...opts }),
        });
        if (!res.ok) throw new Error(await res.text());
        await refresh();
        return (await res.json()) as { created: DispatchedAgent[] };
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [room.name, refresh],
  );

  const removeAgent = React.useCallback(
    async (dispatchId?: string) => {
      if (!AGENTS_ENDPOINT) return;
      setBusy(true);
      setError(undefined);
      try {
        const url = new URL(AGENTS_ENDPOINT, window.location.origin);
        url.searchParams.set('roomName', room.name);
        if (dispatchId) url.searchParams.set('dispatchId', dispatchId);
        const res = await fetch(url.toString(), { method: 'DELETE' });
        if (!res.ok) throw new Error(await res.text());
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [room.name, refresh],
  );

  React.useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  return { agents, busy, error, refresh, addAgents, removeAgent };
}
