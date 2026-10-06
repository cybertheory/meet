# Tavus meeting agent

A [LiveKit Agents](https://docs.livekit.io/agents/) worker that joins a LiveKit Meet room as a
[Tavus](https://www.tavus.io/) video avatar. One worker process serves every agent: the web app
creates one explicit dispatch per agent, each dispatch becomes a job, and each job runs its own
`AgentSession` + `tavus.AvatarSession` in the room.

## Run locally

```bash
cd agent
cp .env.example .env.local   # fill in LiveKit + Tavus keys
uv sync
uv run agent.py download-files   # one-time: Silero VAD + turn-detector weights
uv run agent.py dev
```

`dev` registers the worker with your LiveKit project under `LIVEKIT_AGENT_NAME`
(`tavus-meeting-agent` by default). Keep it running, then start the Next.js app with
`NEXT_PUBLIC_LK_AGENTS_ENDPOINT=/api/agents` and open a room with `?agents=3`.

## Deploy

The `Dockerfile` is ready for [LiveKit Cloud agent deployment](https://docs.livekit.io/agents/ops/deployment/)
(`lk agent create` / `lk agent deploy`) or any container host. Set the same env vars as
`.env.example` as secrets.

## Dispatch metadata

The app sends this JSON as the dispatch `metadata` (see `lib/agents/presets.ts`):

| key            | default           | meaning                                                                 |
| -------------- | ----------------- | ----------------------------------------------------------------------- |
| `name`         | `Agent`           | Display name; also what the agent answers to in `when_addressed` mode   |
| `instructions` | generic persona   | System prompt                                                           |
| `voice`        | `AGENT_TTS`       | LiveKit Inference TTS descriptor, e.g. `cartesia/sonic-3:<voice-id>`    |
| `faceId`       | `TAVUS_FACE_ID`   | Tavus face                                                              |
| `palId`        | `TAVUS_PAL_ID`    | Tavus PAL                                                               |
| `respondMode`  | `always`          | `always` or `when_addressed`                                            |
| `listenMode`   | `humans`          | `humans` or `everyone` (agents can hear other agents' avatars)          |
| `greet`        | depends           | Greet on join; defaults to true only in `always` mode                   |

You can dispatch from anywhere, not just the app:

```bash
lk dispatch create --room my-room --agent-name tavus-meeting-agent \
  --metadata '{"name":"Ada","instructions":"You are Ada, a pragmatic engineering lead.","respondMode":"when_addressed"}'
```

## How multi-participant works

A stock LiveKit voice agent links to the first participant and ends when that participant leaves.
This worker instead:

- links to the current loudest eligible speaker (`active_speakers_changed`), never switching away
  from someone who is mid-sentence;
- sets `close_on_disconnect=False` and re-links to a remaining human when the linked one leaves;
- shuts itself down after `AGENT_IDLE_TIMEOUT` seconds with no humans in the room;
- in `when_addressed` mode, uses `on_user_turn_completed` + `StopResponse` to stay quiet unless
  its first name or a group word ("everyone", "team", …) is spoken, while still appending the
  turn to its chat context so it keeps up with the conversation;
- gives each Tavus avatar a unique participant identity (the plugin default is a constant, so
  two avatars in one room would otherwise evict each other).

Each job hears one participant at a time (a LiveKit `RoomIO` limitation), so crosstalk between
two humans is attributed to whoever was louder first.
