"""
Tavus meeting agent for LiveKit Meet.

One worker process registers under ``LIVEKIT_AGENT_NAME`` (default ``tavus-meeting-agent``).
The Next.js app calls ``AgentDispatchService.CreateDispatch`` once per agent it wants in a
room, passing an ``AgentSpec`` JSON blob as dispatch metadata. Every dispatch spawns one job
here, so N dispatches -> N independent Tavus avatars in the same room.

Multi-participant behaviour (the parts a stock voice agent lacks):

* Follows the active human speaker instead of being pinned to the first participant.
* Doesn't shut down when the first human leaves; re-links to whoever is still there.
* ``respond_mode="when_addressed"`` makes an agent reply only when its name (or a group word
  like "everyone") is spoken, so 10 agents in one room don't all answer every sentence.
  Unanswered turns are still appended to its chat context so it keeps up with the meeting.
* ``listen_mode="everyone"`` also links to other agents' avatars so agents can talk to each
  other (never to its own avatar).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from dataclasses import dataclass

from dotenv import load_dotenv

from livekit import rtc
from livekit.agents import (
    NOT_GIVEN,
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    StopResponse,
    cli,
    llm,
    room_io,
)
from livekit.agents.voice.room_io import ATTRIBUTE_PUBLISH_ON_BEHALF
from livekit.plugins import silero, tavus

load_dotenv()

logger = logging.getLogger("tavus-meeting-agent")
logger.setLevel(logging.INFO)

AGENT_NAME = os.getenv("LIVEKIT_AGENT_NAME", "tavus-meeting-agent")
DEFAULT_STT = os.getenv("AGENT_STT", "deepgram/nova-3:en")
DEFAULT_LLM = os.getenv("AGENT_LLM", "openai/gpt-4.1-mini")
DEFAULT_TTS = os.getenv("AGENT_TTS", "cartesia/sonic-3:a167e0f3-df7e-4d52-a9c3-f949145efdab")
# Shut the job down after this many seconds with no humans in the room (0 disables).
IDLE_TIMEOUT = float(os.getenv("AGENT_IDLE_TIMEOUT", "120"))

HUMAN_KINDS = [
    rtc.ParticipantKind.PARTICIPANT_KIND_STANDARD,
    rtc.ParticipantKind.PARTICIPANT_KIND_SIP,
]

GROUP_WORDS = re.compile(
    r"\b(everyone|everybody|all of you|you all|y'all|team|folks|guys|agents|panel)\b",
    re.IGNORECASE,
)


@dataclass
class AgentSpec:
    """Mirror of ``AgentSpec`` in lib/agents/presets.ts (camelCase accepted)."""

    name: str = "Agent"
    instructions: str = ""
    voice: str | None = None
    face_id: str | None = None
    pal_id: str | None = None
    respond_mode: str = "always"  # always | when_addressed
    listen_mode: str = "humans"  # humans | everyone
    greet: bool | None = None

    @classmethod
    def from_metadata(cls, raw: str | None) -> "AgentSpec":
        if not raw:
            return cls()
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("dispatch metadata is not JSON, using defaults: %r", raw[:80])
            return cls()
        if not isinstance(data, dict):
            return cls()

        def pick(*keys: str, default=None):
            for k in keys:
                if k in data and data[k] not in (None, ""):
                    return data[k]
            return default

        return cls(
            name=str(pick("name", default="Agent")),
            instructions=str(pick("instructions", default="")),
            voice=pick("voice"),
            face_id=pick("face_id", "faceId"),
            pal_id=pick("pal_id", "palId"),
            respond_mode=str(pick("respond_mode", "respondMode", default="always")),
            listen_mode=str(pick("listen_mode", "listenMode", default="humans")),
            greet=pick("greet"),
        )

    @property
    def short_name(self) -> str:
        """'Ada 2' -> 'Ada' so a reused persona still answers to its first name."""
        return self.name.split()[0] if self.name.strip() else self.name

    @property
    def should_greet(self) -> bool:
        if self.greet is not None:
            return bool(self.greet)
        # A room full of agents all greeting at once is noise; only greet in solo mode.
        return self.respond_mode == "always"


def slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-") or "agent"


def build_instructions(spec: AgentSpec) -> str:
    base = spec.instructions.strip() or (
        f"You are {spec.name}, a helpful participant in a video meeting."
    )
    rules = [
        f"Your name is {spec.name}. You are one participant in a live video meeting that may "
        "include several humans and several other AI participants.",
        "You are speaking out loud through a video avatar: keep replies short (one to three "
        "sentences), conversational, and free of markdown, lists or emoji.",
        "Do not announce your name on every turn. Do not speak for the other participants.",
    ]
    if spec.respond_mode == "when_addressed":
        rules.append(
            "You only reply when you are addressed by name or when the whole group is addressed. "
            "Messages you did not reply to are still in your context; use them to stay up to date."
        )
    return base + "\n\n" + "\n".join(rules)


class MeetingAgent(Agent):
    def __init__(self, spec: AgentSpec) -> None:
        super().__init__(instructions=build_instructions(spec))
        self._spec = spec
        self._name_re = re.compile(
            rf"\b{re.escape(spec.short_name)}\b", re.IGNORECASE
        )

    def _is_addressed(self, text: str) -> bool:
        return bool(self._name_re.search(text) or GROUP_WORDS.search(text))

    async def on_user_turn_completed(
        self, turn_ctx: llm.ChatContext, new_message: llm.ChatMessage
    ) -> None:
        if self._spec.respond_mode != "when_addressed":
            return
        text = new_message.text_content or ""
        if self._is_addressed(text):
            return
        # Not for us: remember what was said (the framework drops the turn on StopResponse)
        # so we keep following the meeting, but stay quiet.
        chat_ctx = self.chat_ctx.copy()
        chat_ctx.items.append(new_message)
        await self.update_chat_ctx(chat_ctx)
        raise StopResponse()


class ParticipantFollower:
    """
    Keeps the session linked to whoever should be heard right now.

    RoomIO can only listen to one remote participant at a time. We link to the loudest
    eligible active speaker, never switch away from someone who is still talking, and
    re-link when the linked participant leaves.
    """

    def __init__(
        self, ctx: JobContext, session: AgentSession, spec: AgentSpec, avatar_identity: str
    ) -> None:
        self._ctx = ctx
        self._session = session
        self._spec = spec
        self._avatar_identity = avatar_identity
        self._idle_task: asyncio.Task | None = None

    # -- eligibility -----------------------------------------------------------------------

    def _is_human(self, p: rtc.Participant) -> bool:
        return p.kind in HUMAN_KINDS

    def _is_eligible(self, p: rtc.Participant) -> bool:
        if p.identity == self._ctx.room.local_participant.identity:
            return False
        if p.identity == self._avatar_identity:
            return False
        if p.attributes.get(ATTRIBUTE_PUBLISH_ON_BEHALF) == self._ctx.room.local_participant.identity:
            return False
        if self._is_human(p):
            return True
        # other agents' avatars publish audio on behalf of their worker; plain workers don't speak
        return self._spec.listen_mode == "everyone" and bool(
            p.attributes.get(ATTRIBUTE_PUBLISH_ON_BEHALF)
        )

    def humans(self) -> list[rtc.RemoteParticipant]:
        return [p for p in self._ctx.room.remote_participants.values() if self._is_human(p)]

    # -- wiring ----------------------------------------------------------------------------

    def start(self) -> None:
        room = self._ctx.room
        room.on("active_speakers_changed", self._on_active_speakers)
        room.on("participant_disconnected", self._on_participant_disconnected)
        room.on("participant_connected", self._on_participant_connected)
        self._check_idle()

    def stop(self) -> None:
        room = self._ctx.room
        room.off("active_speakers_changed", self._on_active_speakers)
        room.off("participant_disconnected", self._on_participant_disconnected)
        room.off("participant_connected", self._on_participant_connected)
        if self._idle_task:
            self._idle_task.cancel()

    def _link(self, identity: str) -> None:
        room_io = self._session.room_io
        if room_io is None:
            return
        linked = room_io.linked_participant
        if linked is not None and linked.identity == identity:
            return
        logger.info("linking to participant", extra={"identity": identity})
        room_io.set_participant(identity)

    def _on_active_speakers(self, speakers: list[rtc.Participant]) -> None:
        room_io = self._session.room_io
        if room_io is None:
            return
        linked = room_io.linked_participant
        if linked is not None and any(s.identity == linked.identity for s in speakers):
            return  # the person we're listening to is still talking
        for s in speakers:  # ordered loudest first
            if self._is_eligible(s):
                self._link(s.identity)
                break

    def _on_participant_connected(self, p: rtc.RemoteParticipant) -> None:
        if self._is_human(p):
            self._check_idle()
            room_io = self._session.room_io
            if room_io is not None and room_io.linked_participant is None:
                self._link(p.identity)

    def _on_participant_disconnected(self, p: rtc.RemoteParticipant) -> None:
        room_io = self._session.room_io
        if room_io is None:
            return
        # RoomIO's own handler runs first and clears the link if `p` was the linked one.
        linked = room_io.linked_participant
        if linked is None or linked.identity == p.identity:
            humans = self.humans()
            if humans:
                self._link(humans[0].identity)
        self._check_idle()

    # -- idle shutdown ---------------------------------------------------------------------

    def _check_idle(self) -> None:
        if IDLE_TIMEOUT <= 0:
            return
        if self.humans():
            if self._idle_task:
                self._idle_task.cancel()
                self._idle_task = None
            return
        if self._idle_task is None or self._idle_task.done():
            self._idle_task = asyncio.create_task(self._idle_shutdown())

    async def _idle_shutdown(self) -> None:
        await asyncio.sleep(IDLE_TIMEOUT)
        if not self.humans():
            logger.info("no humans in room for %ss, shutting down", IDLE_TIMEOUT)
            self._ctx.shutdown(reason="idle")


server = AgentServer()


@server.rtc_session(agent_name=AGENT_NAME)
async def entrypoint(ctx: JobContext) -> None:
    spec = AgentSpec.from_metadata(ctx.job.metadata)
    logger.info(
        "starting agent",
        extra={
            "room": ctx.room.name,
            "name": spec.name,
            "respond_mode": spec.respond_mode,
            "listen_mode": spec.listen_mode,
        },
    )

    await ctx.connect()

    # Make the worker participant identifiable in the UI while its avatar is still joining.
    await ctx.room.local_participant.set_name(spec.name)
    await ctx.room.local_participant.set_attributes(
        {"meet.agent": "true", "meet.persona": spec.name, "meet.respond_mode": spec.respond_mode}
    )

    session = AgentSession(
        stt=DEFAULT_STT,
        llm=DEFAULT_LLM,
        tts=spec.voice or DEFAULT_TTS,
        vad=silero.VAD.load(),
    )

    # Unique avatar identity per job so N agents don't evict each other (default is a constant).
    avatar_identity = f"tavus-{slugify(spec.name)}-{ctx.job.id[-6:]}"
    face_id = spec.face_id or os.getenv("TAVUS_FACE_ID") or NOT_GIVEN
    pal_id = spec.pal_id or os.getenv("TAVUS_PAL_ID") or NOT_GIVEN
    avatar = tavus.AvatarSession(
        face_id=face_id,
        pal_id=pal_id,
        avatar_participant_identity=avatar_identity,
        avatar_participant_name=spec.name,
    )
    await avatar.start(session, room=ctx.room)

    # Link to the first human already in the room, if any; otherwise RoomIO links the next one.
    humans = [p for p in ctx.room.remote_participants.values() if p.kind in HUMAN_KINDS]
    await session.start(
        agent=MeetingAgent(spec),
        room=ctx.room,
        room_options=room_io.RoomOptions(
            participant_kinds=HUMAN_KINDS,
            participant_identity=humans[0].identity if humans else NOT_GIVEN,
            # A meeting has many humans; don't end the session when the first one leaves.
            close_on_disconnect=False,
        ),
    )

    follower = ParticipantFollower(ctx, session, spec, avatar_identity)
    follower.start()

    async def cleanup() -> None:
        follower.stop()

    ctx.add_shutdown_callback(cleanup)

    if spec.should_greet:
        session.generate_reply(
            instructions="Briefly greet the meeting in one short sentence and say your name."
        )


if __name__ == "__main__":
    cli.run_app(server)
