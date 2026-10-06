<a href="https://livekit.io/">
  <img src="./.github/assets/livekit-mark.png" alt="LiveKit logo" width="100" height="100">
</a>

# LiveKit Meet

<p>
  <a href="https://meet.livekit.io"><strong>Try the demo</strong></a>
  •
  <a href="https://github.com/livekit/components-js">LiveKit Components</a>
  •
  <a href="https://docs.livekit.io/">LiveKit Docs</a>
  •
  <a href="https://livekit.io/cloud">LiveKit Cloud</a>
  •
  <a href="https://blog.livekit.io/">Blog</a>
</p>

<br>

LiveKit Meet is an open source video conferencing app built on [LiveKit Components](https://github.com/livekit/components-js), [LiveKit Cloud](https://cloud.livekit.io/), and Next.js. It's been completely redesigned from the ground up using our new components library.

![LiveKit Meet screenshot](./.github/assets/livekit-meet.jpg)

## AI agents (this fork)

This fork adds first-class support for running many [Tavus](https://www.tavus.io/) avatar agents
in a single meeting alongside human participants, using
[LiveKit Agents](https://docs.livekit.io/agents/) explicit dispatch.

- **Dispatch API** — `app/api/agents/route.ts` (`GET`/`POST`/`DELETE`) lists, adds and removes
  agents in a room via `AgentDispatchClient`. One dispatch = one agent; dispatch the same worker
  N times with different metadata to get N agents.
- **"AI Agents" tab** in the in-room settings menu: pick a count, personas, turn-taking mode,
  add custom agents, remove agents.
- **`?agents=N[&personas=ada,blake]`** on a room URL (and an "AI agents to invite" field on the
  home page) auto-dispatches on join. Idempotent, so a shared link won't add N more per joiner.
- **Agent-aware grid** — `lib/AgentVideoConference.tsx` hides the blank tile of each headless
  agent worker once its avatar (which publishes on its behalf) is in the room.
- **Python worker** — `agent/` contains the multi-participant Tavus agent. See
  [`agent/README.md`](./agent/README.md).

Setup:

1. Run the worker: `cd agent && cp .env.example .env.local && uv sync && uv run agent.py dev`
2. In `.env.local` of the web app set `NEXT_PUBLIC_LK_AGENTS_ENDPOINT=/api/agents`
   (and `LIVEKIT_AGENT_NAME` if you changed it on the worker).
3. `pnpm dev`, start a meeting with a non-zero agent count, or open the settings menu → AI Agents.

Turn-taking: with more than one agent the default is `when_addressed`, so an agent only speaks
when you say its name ("Ada, what do you think?") or address the group ("everyone, …"). Switch to
`always` for a single agent that should answer everything.

## Tech Stack

- This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).
- App is built with [@livekit/components-react](https://github.com/livekit/components-js/) library.

## Demo

Give it a try at https://meet.livekit.io.

## Dev Setup

Steps to get a local dev setup up and running:

1. Run `pnpm install` to install all dependencies.
2. Copy `.env.example` in the project root and rename it to `.env.local`.
3. Update the missing environment variables in the newly created `.env.local` file.
4. Run `pnpm dev` to start the development server and visit [http://localhost:3000](http://localhost:3000) to see the result.
5. Start development 🎉
