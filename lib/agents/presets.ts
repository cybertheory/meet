/**
 * Shared agent persona definitions used by both the Next.js dispatch API
 * and the client-side "AI Agents" panel. The same JSON shape is sent to the
 * Python worker as dispatch metadata (see agent/agent.py -> AgentSpec).
 */

export type RespondMode = 'always' | 'when_addressed';
export type ListenMode = 'humans' | 'everyone';

export interface AgentSpec {
  /** Display name of the agent. Also used by the "when_addressed" turn mode. */
  name: string;
  /** System prompt / persona for the LLM. */
  instructions: string;
  /** LiveKit Inference TTS descriptor, e.g. "cartesia/sonic-3:<voice-id>". */
  voice?: string;
  /** Tavus face ID. Falls back to TAVUS_FACE_ID on the worker, then Tavus' stock face. */
  faceId?: string;
  /** Tavus PAL ID. Falls back to TAVUS_PAL_ID on the worker, then Tavus' stock PAL. */
  palId?: string;
  /**
   * always          -> reply to every human turn (fine for 1 agent, chaotic for many)
   * when_addressed  -> only reply when the agent's name (or "everyone"/"all") is mentioned
   */
  respondMode?: RespondMode;
  /**
   * humans    -> only link to human (standard/SIP) participants
   * everyone  -> also link to other agents' avatars, so agents can talk to each other
   */
  listenMode?: ListenMode;
  /** Whether the agent greets the room when it joins. Default true. */
  greet?: boolean;
}

export interface AgentPreset extends AgentSpec {
  id: string;
  tagline: string;
}

export const AGENT_PRESETS: AgentPreset[] = [
  {
    id: 'ada',
    name: 'Ada',
    tagline: 'Pragmatic engineering lead',
    voice: 'cartesia/sonic-3:9626c31c-bec5-4cca-baa8-f8ba9e84c8bc',
    instructions:
      'You are Ada, a pragmatic engineering lead. You care about tradeoffs, shipping, and clear ' +
      'ownership. Keep answers concise and concrete.',
  },
  {
    id: 'blake',
    name: 'Blake',
    tagline: 'Energetic product marketer',
    voice: 'cartesia/sonic-3:a167e0f3-df7e-4d52-a9c3-f949145efdab',
    instructions:
      'You are Blake, an energetic product marketer. You think in terms of positioning, ' +
      'customer stories and launches. Be upbeat but brief.',
  },
  {
    id: 'robyn',
    name: 'Robyn',
    tagline: 'Calm finance partner',
    voice: 'cartesia/sonic-3:f31cc6a7-c1e8-4764-980c-60a361443dd1',
    instructions:
      'You are Robyn, a calm and precise finance partner. You bring up costs, runway and ' +
      'measurable outcomes. Speak plainly and avoid jargon.',
  },
  {
    id: 'apollo',
    name: 'Apollo',
    tagline: 'Casual UX researcher',
    voice: 'deepgram/aura-2:apollo',
    instructions:
      'You are Apollo, a casual UX researcher. You advocate for the end user, ask clarifying ' +
      'questions, and point out usability risks.',
  },
  {
    id: 'athena',
    name: 'Athena',
    tagline: 'Professional legal counsel',
    voice: 'deepgram/aura-2:athena',
    instructions:
      'You are Athena, in-house legal counsel. You flag compliance, privacy and contractual ' +
      'risks succinctly and suggest practical mitigations.',
  },
  {
    id: 'odysseus',
    name: 'Odysseus',
    tagline: 'Measured operations director',
    voice: 'deepgram/aura-2:odysseus',
    instructions:
      'You are Odysseus, a measured operations director. You focus on process, timelines and ' +
      'dependencies. Keep responses structured and short.',
  },
  {
    id: 'luna',
    name: 'Luna',
    tagline: 'Creative designer',
    voice: 'rime/coda:luna',
    instructions:
      'You are Luna, a creative product designer. You think visually, propose bold ideas, and ' +
      'care about craft and delight.',
  },
  {
    id: 'leo',
    name: 'Leo',
    tagline: 'Direct sales leader',
    voice: 'xai/tts-1:leo',
    instructions:
      'You are Leo, a direct sales leader. You care about pipeline, objections and closing. ' +
      'Be confident and to the point.',
  },
  {
    id: 'olivia',
    name: 'Olivia',
    tagline: 'Friendly customer support lead',
    voice: 'inworld/inworld-tts-1:Olivia',
    instructions:
      'You are Olivia, a friendly customer support lead. You bring the voice of the customer ' +
      'and surface recurring pain points.',
  },
  {
    id: 'edward',
    name: 'Edward',
    tagline: 'Fast-talking data scientist',
    voice: 'inworld/inworld-tts-1:Edward',
    instructions:
      'You are Edward, a fast-talking data scientist. You ask what the metric is, how it is ' +
      'measured, and whether the sample size is meaningful.',
  },
];

export function getPreset(id: string): AgentPreset | undefined {
  return AGENT_PRESETS.find((p) => p.id === id);
}

/**
 * Pick `count` presets, cycling through the list and suffixing names when a
 * persona is reused (e.g. "Ada", "Ada 2"), so every agent has a unique name.
 */
export function pickPresets(count: number, ids?: string[]): AgentSpec[] {
  const pool = ids && ids.length > 0 ? ids.map(getPreset).filter(Boolean) : AGENT_PRESETS;
  const result: AgentSpec[] = [];
  const seen = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const preset = pool[i % pool.length] as AgentPreset;
    const n = (seen.get(preset.id) ?? 0) + 1;
    seen.set(preset.id, n);
    const { id: _id, tagline: _tagline, ...spec } = preset;
    result.push({ ...spec, name: n === 1 ? preset.name : `${preset.name} ${n}` });
  }
  return result;
}
