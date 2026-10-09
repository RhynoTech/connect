import React, { useEffect, useRef, useState } from 'react';
import { connect } from 'react-redux';
import { CircularProgress, Typography } from '@material-ui/core';
import Hls from 'hls.js/light';

import { api } from '../../api/backend';

import Colors from '../../colors';
import { ErrorOutline } from '../../icons';
import { attachVideo, currentOffset, seekTo } from '../../timeline';
import { pause, play, videoState } from '../../timeline/playback';
import { isIos } from '../../utils/browser.js';

const NOT_UPLOADED = 'This video segment has not uploaded yet or has been deleted.';
const UNABLE = 'Unable to load video';

// the store mirrors the video on every event that can change these
const mirror = (video) => videoState({
  isPlaying: !video.paused,
  playSpeed: video.playbackRate,
  isBufferingVideo: video.readyState < 2 || video.seeking || (!video.paused && video.readyState < 3),
});
const MIRRORED_EVENTS = ['onLoadStart', 'onLoadedData', 'onCanPlay', 'onPlay', 'onPlaying', 'onPause', 'onWaiting',
  'onSeeking', 'onSeeked', 'onRateChange'];

const DriveVideo = ({ dispatch, currentRoute, loop, isBufferingVideo, isMuted, onAudioStatusChange }) => {
  const videoRef = useRef(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const { fullname, share_exp: exp, share_sig: sig } = currentRoute || {};

  // a new drive starts at the beginning of its loop
  useEffect(() => {
    seekTo(0);
  }, [fullname]);

  // load the drive: native HLS on iOS, hls.js everywhere else
  useEffect(() => {
    if (!fullname) {
      return undefined;
    }
    const video = videoRef.current;
    const src = api.video.getQcameraStreamUrl(fullname, exp, sig);
    let hls = null;
    setError(null);
    if (isIos()) {
      video.src = src;
    } else {
      let recovered = false;
      hls = new Hls({ maxBufferLength: 40 });
      hls.on(Hls.Events.BUFFER_CODECS, (_, data) => onAudioStatusChange?.(Boolean(data.audio)));
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) {
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) {
          recovered = true;
          hls.recoverMediaError();
        } else {
          setError(data.response?.code === 404 ? NOT_UPLOADED : UNABLE);
        }
      });
      hls.loadSource(src);
      hls.attachMedia(video);
    }
    return () => {
      attachVideo(null);
      hls?.destroy();
      video.removeAttribute('src');
      video.load();
    };
  }, [fullname, exp, sig, attempt, onAudioStatusChange]);

  // move into a newly selected loop
  useEffect(() => {
    const offset = currentOffset();
    if (loop && (offset < loop.startTime || offset > loop.startTime + loop.duration)) {
      seekTo(loop.startTime);
    }
  }, [loop]);

  const onLoadedMetadata = (ev) => {
    attachVideo(ev.currentTarget);
    if (isIos()) {
      onAudioStatusChange?.(ev.currentTarget.audioTracks?.length > 0);
    }
  };

  // loop at the end of the selection, or of the video if that comes first
  const onTimeUpdate = () => {
    if (loop && currentOffset() > loop.startTime + loop.duration) {
      seekTo(loop.startTime);
    }
  };
  const onEnded = (ev) => {
    if (loop && currentOffset() > loop.startTime) {
      seekTo(loop.startTime);
      ev.currentTarget.play().catch(() => {});
    }
  };

  const retry = () => {
    seekTo(currentOffset());
    setAttempt(attempt + 1);
  };

  const mirrorEvents = Object.fromEntries(MIRRORED_EVENTS.map((name) => [name, (ev) => dispatch(mirror(ev.currentTarget))]));
  const showOverlay = Boolean(error) || isBufferingVideo;
  return (
    <div className="min-h-[200px] relative max-w-[964px] m-[0_auto] aspect-[1.593] bg-black">
      <video
        ref={videoRef}
        className="h-full w-full"
        autoPlay
        playsInline
        muted={isMuted}
        onClick={(ev) => dispatch(ev.currentTarget.paused ? play(ev.currentTarget.playbackRate) : pause())}
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={onTimeUpdate}
        onEnded={onEnded}
        // hls.js reports its own errors
        onError={isIos() ? () => setError(UNABLE) : undefined}
        {...mirrorEvents}
      />
      <div
        className={`absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#16181AAA] transition-opacity
          ${showOverlay ? 'opacity-100 delay-300' : 'opacity-0'} ${error ? '' : 'pointer-events-none'}`}
      >
        {error ? (
          <>
            <ErrorOutline />
            <Typography>{error}</Typography>
            <button type="button" className="rounded-full bg-white/10 px-4 py-1 hover:bg-white/20" onClick={retry}>
              Retry
            </button>
          </>
        ) : (
          <CircularProgress style={{ color: Colors.white }} thickness={4} size={50} />
        )}
      </div>
    </div>
  );
};

const stateToProps = (state) => ({
  currentRoute: state.currentRoute,
  loop: state.loop,
  isBufferingVideo: state.isBufferingVideo,
});

export default connect(stateToProps)(DriveVideo);
