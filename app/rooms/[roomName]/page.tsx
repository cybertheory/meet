import * as React from 'react';
import { PageClientImpl } from './PageClientImpl';
import { isVideoCodec } from '@/lib/types';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ roomName: string }>;
  searchParams: Promise<{
    // FIXME: We should not allow values for regions if in playground mode.
    region?: string;
    hq?: string;
    codec?: string;
    singlePC?: string;
    /** Number of AI agents to ensure are in the room, e.g. `?agents=5`. */
    agents?: string;
    /** Comma-separated preset ids to cycle through, e.g. `&personas=ada,blake`. */
    personas?: string;
  }>;
}) {
  const _params = await params;
  const _searchParams = await searchParams;
  const codec =
    typeof _searchParams.codec === 'string' && isVideoCodec(_searchParams.codec)
      ? _searchParams.codec
      : 'vp9';
  const hq = _searchParams.hq === 'true' ? true : false;
  const singlePC = _searchParams.singlePC !== 'false';
  const agentCount = Number.parseInt(_searchParams.agents ?? '', 10);
  const autoAgents =
    Number.isFinite(agentCount) && agentCount > 0
      ? {
          count: agentCount,
          presetIds: _searchParams.personas
            ? _searchParams.personas
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
        }
      : undefined;

  return (
    <PageClientImpl
      roomName={_params.roomName}
      region={_searchParams.region}
      hq={hq}
      codec={codec}
      singlePeerConnection={singlePC}
      autoAgents={autoAgents}
    />
  );
}
