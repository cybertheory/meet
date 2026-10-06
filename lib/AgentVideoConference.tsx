'use client';

import * as React from 'react';
import { ParticipantKind, RoomEvent, Track } from 'livekit-client';
import {
  CarouselLayout,
  Chat,
  ConnectionStateToast,
  ControlBar,
  FocusLayout,
  FocusLayoutContainer,
  GridLayout,
  LayoutContextProvider,
  ParticipantTile,
  RoomAudioRenderer,
  isTrackReference,
  useCreateLayoutContext,
  usePinnedTracks,
  useTracks,
  type MessageFormatter,
  type TrackReferenceOrPlaceholder,
  type WidgetState,
  type MessageDecoder,
  type MessageEncoder,
} from '@livekit/components-react';

/**
 * Attribute set on avatar participants (e.g. Tavus) that publish media on behalf of an
 * agent worker participant. Mirrors `ATTRIBUTE_PUBLISH_ON_BEHALF` in livekit-agents.
 */
export const ATTRIBUTE_PUBLISH_ON_BEHALF = 'lk.publish_on_behalf';

export interface AgentVideoConferenceProps extends React.HTMLAttributes<HTMLDivElement> {
  chatMessageFormatter?: MessageFormatter;
  chatMessageEncoder?: MessageEncoder;
  chatMessageDecoder?: MessageDecoder;
  SettingsComponent?: React.ComponentType;
  /**
   * Hide placeholder tiles for agent participants that publish no video. With an avatar
   * provider like Tavus, the Python worker joins as a camera-less "agent" participant and the
   * avatar joins as a second participant that publishes audio+video on its behalf; without
   * this filter every agent would render as two tiles (one of them blank).
   */
  hideHeadlessAgents?: boolean;
}

function isEqualTrackRef(
  a?: TrackReferenceOrPlaceholder,
  b?: TrackReferenceOrPlaceholder,
): boolean {
  if (a === undefined || b === undefined) return false;
  if (isTrackReference(a) && isTrackReference(b)) {
    return a.publication.trackSid === b.publication.trackSid;
  }
  return a.participant.identity === b.participant.identity && a.source === b.source;
}

/**
 * Drop-in replacement for `VideoConference` from @livekit/components-react that understands
 * agent participants. The layout, chat and control bar are identical to the upstream prefab.
 */
export function AgentVideoConference({
  chatMessageFormatter,
  chatMessageDecoder,
  chatMessageEncoder,
  SettingsComponent,
  hideHeadlessAgents = true,
  ...props
}: AgentVideoConferenceProps) {
  const [widgetState, setWidgetState] = React.useState<WidgetState>({
    showChat: false,
    unreadMessages: 0,
    showSettings: false,
  });
  const lastAutoFocusedScreenShareTrack = React.useRef<TrackReferenceOrPlaceholder | null>(null);

  const allTracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    {
      updateOnlyOn: [RoomEvent.ActiveSpeakersChanged, RoomEvent.ParticipantAttributesChanged],
      onlySubscribed: false,
    },
  );

  const tracks = React.useMemo(() => {
    if (!hideHeadlessAgents) return allTracks;
    // identities that some avatar participant is publishing on behalf of
    const representedIdentities = new Set<string>();
    for (const t of allTracks) {
      const onBehalfOf = t.participant.attributes?.[ATTRIBUTE_PUBLISH_ON_BEHALF];
      if (onBehalfOf) representedIdentities.add(onBehalfOf);
    }
    return allTracks.filter((t) => {
      if (isTrackReference(t)) return true; // real media, always show
      const p = t.participant;
      if (p.kind !== ParticipantKind.AGENT) return true;
      // headless worker whose avatar is already in the room -> the avatar tile stands in for it.
      // Before the avatar joins, the worker's placeholder tile is kept as a "joining" indicator.
      return !representedIdentities.has(p.identity);
    });
  }, [allTracks, hideHeadlessAgents]);

  const layoutContext = useCreateLayoutContext();

  const screenShareTracks = tracks
    .filter(isTrackReference)
    .filter((track) => track.publication.source === Track.Source.ScreenShare);

  const focusTrack = usePinnedTracks(layoutContext)?.[0];
  const carouselTracks = tracks.filter((track) => !isEqualTrackRef(track, focusTrack));

  React.useEffect(() => {
    if (
      screenShareTracks.some((track) => track.publication.isSubscribed) &&
      lastAutoFocusedScreenShareTrack.current === null
    ) {
      layoutContext.pin.dispatch?.({ msg: 'set_pin', trackReference: screenShareTracks[0] });
      lastAutoFocusedScreenShareTrack.current = screenShareTracks[0];
    } else if (
      lastAutoFocusedScreenShareTrack.current &&
      !screenShareTracks.some(
        (track) =>
          track.publication.trackSid ===
          lastAutoFocusedScreenShareTrack.current?.publication?.trackSid,
      )
    ) {
      layoutContext.pin.dispatch?.({ msg: 'clear_pin' });
      lastAutoFocusedScreenShareTrack.current = null;
    }
    if (focusTrack && !isTrackReference(focusTrack)) {
      const updatedFocusTrack = tracks.find(
        (tr) =>
          tr.participant.identity === focusTrack.participant.identity &&
          tr.source === focusTrack.source,
      );
      if (updatedFocusTrack !== focusTrack && isTrackReference(updatedFocusTrack)) {
        layoutContext.pin.dispatch?.({ msg: 'set_pin', trackReference: updatedFocusTrack });
      }
    }
  }, [
    screenShareTracks
      .map((ref) => `${ref.publication.trackSid}_${ref.publication.isSubscribed}`)
      .join(),
    focusTrack?.publication?.trackSid,
    tracks,
  ]);

  const isWeb = typeof window !== 'undefined';

  return (
    <div className="lk-video-conference" {...props}>
      {isWeb && (
        <LayoutContextProvider value={layoutContext} onWidgetChange={setWidgetState}>
          <div className="lk-video-conference-inner">
            {!focusTrack ? (
              <div className="lk-grid-layout-wrapper">
                <GridLayout tracks={tracks}>
                  <ParticipantTile />
                </GridLayout>
              </div>
            ) : (
              <div className="lk-focus-layout-wrapper">
                <FocusLayoutContainer>
                  <CarouselLayout tracks={carouselTracks}>
                    <ParticipantTile />
                  </CarouselLayout>
                  {focusTrack && <FocusLayout trackRef={focusTrack} />}
                </FocusLayoutContainer>
              </div>
            )}
            <ControlBar controls={{ chat: true, settings: !!SettingsComponent }} />
          </div>
          <Chat
            style={{ display: widgetState.showChat ? 'grid' : 'none' }}
            messageFormatter={chatMessageFormatter}
            messageEncoder={chatMessageEncoder}
            messageDecoder={chatMessageDecoder}
          />
          {SettingsComponent && (
            <div
              className="lk-settings-menu-modal"
              style={{ display: widgetState.showSettings ? 'block' : 'none' }}
            >
              <SettingsComponent />
            </div>
          )}
        </LayoutContextProvider>
      )}
      <RoomAudioRenderer />
      <ConnectionStateToast />
    </div>
  );
}
