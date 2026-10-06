import { AgentDispatchClient } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { AgentSpec, pickPresets } from '@/lib/agents/presets';

/**
 * CAUTION:
 * Like the recording endpoints, this implementation does not authenticate users. Anyone who
 * knows a roomName can add or remove agents in that room. Add auth before using in production.
 */

const AGENT_NAME = process.env.LIVEKIT_AGENT_NAME ?? 'tavus-meeting-agent';
const MAX_AGENTS_PER_ROOM = Number(process.env.LIVEKIT_MAX_AGENTS_PER_ROOM ?? 25);

export interface DispatchedAgent {
  dispatchId: string;
  spec: AgentSpec;
  createdAt: number;
}

export interface DispatchAgentsRequest {
  roomName: string;
  /** Explicit list of agents to dispatch. Takes precedence over `count`. */
  agents?: AgentSpec[];
  /** Shortcut: dispatch `count` agents from the presets (optionally restricted to `presetIds`). */
  count?: number;
  presetIds?: string[];
  /**
   * When true, agents whose name is already dispatched in the room are skipped. This makes
   * the request idempotent so a shared `?agents=N` link doesn't add N agents per joiner.
   */
  ensure?: boolean;
  respondMode?: AgentSpec['respondMode'];
  listenMode?: AgentSpec['listenMode'];
}

function getClient() {
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
  if (!LIVEKIT_URL) throw new Error('LIVEKIT_URL is not defined');
  const hostURL = new URL(LIVEKIT_URL);
  hostURL.protocol = 'https:';
  return new AgentDispatchClient(hostURL.origin, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
}

function parseSpec(metadata: string): AgentSpec | undefined {
  try {
    const parsed = JSON.parse(metadata);
    if (parsed && typeof parsed.name === 'string') return parsed as AgentSpec;
  } catch {}
  return undefined;
}

async function listAgents(roomName: string): Promise<DispatchedAgent[]> {
  const client = getClient();
  const dispatches = await client.listDispatch(roomName);
  return dispatches
    .filter((d) => d.agentName === AGENT_NAME)
    .map((d) => ({
      dispatchId: d.id,
      spec: parseSpec(d.metadata) ?? { name: d.id, instructions: '' },
      createdAt: Number(d.state?.createdAt ?? 0),
    }));
}

export async function GET(req: NextRequest) {
  try {
    const roomName = req.nextUrl.searchParams.get('roomName');
    if (!roomName) return new NextResponse('Missing roomName parameter', { status: 400 });
    const agents = await listAgents(roomName);
    return NextResponse.json({ agentName: AGENT_NAME, agents });
  } catch (error) {
    return new NextResponse(error instanceof Error ? error.message : 'error', { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as DispatchAgentsRequest;
    const { roomName } = body;
    if (!roomName) return new NextResponse('Missing roomName', { status: 400 });

    let specs: AgentSpec[] = body.agents ?? [];
    if (specs.length === 0 && body.count && body.count > 0) {
      specs = pickPresets(Math.floor(body.count), body.presetIds);
    }
    if (specs.length === 0) return new NextResponse('No agents specified', { status: 400 });

    const defaultRespond: AgentSpec['respondMode'] = specs.length > 1 ? 'when_addressed' : 'always';
    specs = specs.map((s) => ({
      ...s,
      respondMode: body.respondMode ?? s.respondMode ?? defaultRespond,
      listenMode: body.listenMode ?? s.listenMode ?? 'humans',
    }));

    const client = getClient();
    const existing = await listAgents(roomName);
    const existingNames = new Set(existing.map((a) => a.spec.name.toLowerCase()));

    if (body.ensure) {
      specs = specs.filter((s) => !existingNames.has(s.name.toLowerCase()));
    }

    const room = existing.length + specs.length;
    if (room > MAX_AGENTS_PER_ROOM) {
      return new NextResponse(
        `Room would have ${room} agents, limit is ${MAX_AGENTS_PER_ROOM} (LIVEKIT_MAX_AGENTS_PER_ROOM)`,
        { status: 429 },
      );
    }

    // Each createDispatch() spawns one job on the worker registered under AGENT_NAME, so
    // dispatching the same agent name N times with different metadata yields N agents.
    const created = await Promise.all(
      specs.map(async (spec) => {
        const d = await client.createDispatch(roomName, AGENT_NAME, {
          metadata: JSON.stringify(spec),
        });
        return { dispatchId: d.id, spec, createdAt: Date.now() } satisfies DispatchedAgent;
      }),
    );

    return NextResponse.json({ agentName: AGENT_NAME, created, skipped: existing.length });
  } catch (error) {
    return new NextResponse(error instanceof Error ? error.message : 'error', { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const roomName = req.nextUrl.searchParams.get('roomName');
    const dispatchId = req.nextUrl.searchParams.get('dispatchId');
    if (!roomName) return new NextResponse('Missing roomName parameter', { status: 400 });

    const client = getClient();
    if (dispatchId) {
      await client.deleteDispatch(dispatchId, roomName);
      return NextResponse.json({ deleted: [dispatchId] });
    }
    // No dispatchId -> remove every agent in the room
    const agents = await listAgents(roomName);
    await Promise.all(agents.map((a) => client.deleteDispatch(a.dispatchId, roomName)));
    return NextResponse.json({ deleted: agents.map((a) => a.dispatchId) });
  } catch (error) {
    return new NextResponse(error instanceof Error ? error.message : 'error', { status: 500 });
  }
}
