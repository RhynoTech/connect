import React, { useCallback, useEffect, useRef, useState } from 'react';
import { connect } from 'react-redux';
import { CircularProgress, Typography } from '@material-ui/core';
import Hls from 'hls.js/light';

import { api } from '../../api/backend';

import Colors from '../../colors';
import { ErrorOutline } from '../../icons';
import { attachVideo, currentOffset, seekTo, tick } from '../../timeline';
import { pause, play, seek, videoState } from '../../timeline/playback';
import { isIos } from '../../utils/browser.js';
import Controls from './Controls';

const NOT_UPLOADED = 'This video segment has not uploaded yet or has been deleted.';
const UNABLE = 'Unable to load video';
const HIDE_CONTROLS_MS = 2500;

// the store mirrors the video on every event that can change these
const mirror = (video) => videoState({
  isPlaying: !video.paused,
  playSpeed: video.playbackRate,
  isBufferingVideo: video.readyState < 2 || video.seeking || (!video.paused && video.readyState < 3),
});
const MIRRORED_EVENTS = ['onLoadStart', 'onLoadedData', 'onCanPlay', 'onPlay', 'onPlaying', 'onPause', 'onWaiting',
  'onSeeking', 'onSeeked', 'onRateChange'];

const isFullscreen = () => Boolean(document.fullscreenElement || document.webkitFullscreenElement);

const DriveVideo = ({ dispatch, currentRoute, loop, isPlaying, playSpeed, isBufferingVideo, mapView, children }) => {
  const boxRef = useRef(null);
  const videoRef = useRef(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [muted, setMuted] = useState(true);
  const [hasAudio, setHasAudio] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [active, setActive] = useState(false);
  const hideTimer = useRef(null);
  const lastPointer = useRef('mouse');
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
    setHasAudio(false);
    if (isIos()) {
      video.src = src;
    } else {
      let recovered = false;
      hls = new Hls({ maxBufferLength: 40 });
      hls.on(Hls.Events.BUFFER_CODECS, (_, data) => setHasAudio(Boolean(data.audio)));
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
  }, [fullname, exp, sig, attempt]);

  // move into a newly selected loop
  useEffect(() => {
    const offset = currentOffset();
    if (loop && (offset < loop.startTime || offset > loop.startTime + loop.duration)) {
      seekTo(loop.startTime);
    }
  }, [loop]);

  useEffect(() => {
    const onChange = () => setFullscreen(isFullscreen());
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
      clearTimeout(hideTimer.current);
    };
  }, []);

  // controls show while paused, loading or on the map, and for a moment after any interaction
  const showControls = useCallback(() => {
    setActive(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setActive(false), HIDE_CONTROLS_MS);
  }, []);
  const controlsVisible = active || !isPlaying || isBufferingVideo || mapView || Boolean(error);

  const retry = () => {
    seekTo(currentOffset());
    setAttempt(attempt + 1);
  };
  const togglePlay = () => {
    const video = videoRef.current;
    dispatch(video.paused ? play(video.playbackRate) : pause());
  };
  const skip = (ms) => dispatch(seek(currentOffset() + ms));
  const seekAndRecover = (offset) => {
    dispatch(seek(offset));
    if (error) {
      retry(); // seeking past a missing segment loads from there
    }
  };
  const toggleMute = () => hasAudio && setMuted(!muted);
  const toggleFullscreen = () => {
    const box = boxRef.current;
    if (isFullscreen()) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else if (document.fullscreenEnabled) {
      box.requestFullscreen().then(() => window.screen.orientation?.lock?.('landscape')).catch(() => {});
    } else if (document.webkitFullscreenEnabled) {
      box.webkitRequestFullscreen();
    } else {
      videoRef.current.webkitEnterFullscreen?.(); // iPhone: the system player
    }
  };

  useEffect(() => {
    const onKeyDown = (ev) => {
      const action = {
        ' ': togglePlay, k: togglePlay, j: () => skip(-10000), ArrowLeft: () => skip(-10000),
        l: () => skip(10000), ArrowRight: () => skip(10000), f: toggleFullscreen, m: toggleMute,
      }[ev.key];
      const { target } = ev;
      if (!action || ev.defaultPrevented || ev.metaKey || ev.ctrlKey || ev.altKey
        || target.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="dialog"]')
        || (ev.key === ' ' && target.closest('button'))) {
        return;
      }
      ev.preventDefault();
      action();
      showControls();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // a mouse click plays or pauses; a tap shows or hides the controls, as in the phone's own player
  const onSurfacePointerUp = (ev) => {
    lastPointer.current = ev.pointerType;
    if (ev.pointerType === 'mouse') {
      togglePlay();
      showControls();
    } else if (active) {
      setActive(false);
    } else {
      showControls();
    }
  };

  const mirrorEvents = Object.fromEntries(MIRRORED_EVENTS.map((name) => [name, (ev) => {
    dispatch(mirror(ev.currentTarget));
    tick();
  }]));
  const showOverlay = !mapView && (Boolean(error) || isBufferingVideo);
  return (
    <div
      ref={boxRef}
      className={`relative m-[0_auto] max-w-[964px] select-none overflow-hidden rounded-lg bg-black [&:fullscreen]:rounded-none
        ${mapView ? 'min-h-[300px]' : 'aspect-[1.593] min-h-[200px]'} ${controlsVisible ? '' : 'cursor-none'}`}
      onPointerMove={(ev) => ev.pointerType === 'mouse' && showControls()}
      onPointerLeave={(ev) => ev.pointerType === 'mouse' && setActive(false)}
      onFocus={showControls}
    >
      <video
        ref={videoRef}
        className="h-full w-full touch-manipulation"
        autoPlay
        playsInline
        muted={muted}
        onPointerUp={onSurfacePointerUp}
        onDoubleClick={() => lastPointer.current === 'mouse' && toggleFullscreen()}
        onLoadedMetadata={(ev) => {
          attachVideo(ev.currentTarget);
          if (isIos()) {
            setHasAudio(ev.currentTarget.audioTracks?.length > 0);
          }
        }}
        onTimeUpdate={() => {
          // loop at the end of the selection
          if (loop && currentOffset() > loop.startTime + loop.duration) {
            seekTo(loop.startTime);
          }
        }}
        onEnded={(ev) => {
          // or at the end of the video, if that comes first
          if (loop && currentOffset() > loop.startTime) {
            seekTo(loop.startTime);
            ev.currentTarget.play().catch(() => {});
          }
        }}
        // hls.js reports its own errors
        onError={isIos() ? () => setError(UNABLE) : undefined}
        {...mirrorEvents}
      />
      {children && <div className="absolute inset-0">{children}</div>}
      <div
        className={`pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#16181AAA]
          transition-opacity ${showOverlay ? 'opacity-100 delay-300' : 'opacity-0'}`}
      >
        {error ? (
          <>
            <ErrorOutline />
            <Typography>{error}</Typography>
            <button
              type="button"
              className={`rounded-full bg-white/10 px-4 py-2 text-white hover:bg-white/20 ${showOverlay ? 'pointer-events-auto' : ''}`}
              onClick={retry}
            >
              Retry
            </button>
          </>
        ) : showOverlay && (
          <CircularProgress style={{ color: Colors.white }} thickness={4} size={50} />
        )}
      </div>
      {currentRoute && (
        <Controls
          route={currentRoute}
          loop={loop}
          visible={controlsVisible}
          centerButtons={!mapView && !error && !isBufferingVideo}
          isPlaying={isPlaying}
          playSpeed={playSpeed}
          muted={muted}
          hasAudio={hasAudio}
          fullscreen={fullscreen}
          onTogglePlay={togglePlay}
          onSkip={skip}
          onSeek={seekAndRecover}
          onSpeed={(speed) => { videoRef.current.playbackRate = speed; }}
          onToggleMute={toggleMute}
          onToggleFullscreen={toggleFullscreen}
        />
      )}
    </div>
  );
};

const stateToProps = (state) => ({
  currentRoute: state.currentRoute,
  loop: state.loop,
  isPlaying: state.isPlaying,
  playSpeed: state.playSpeed,
  isBufferingVideo: state.isBufferingVideo,
});

export default connect(stateToProps)(DriveVideo);
