import React, { useCallback, useEffect, useRef, useState } from 'react';
import { connect } from 'react-redux';
import { CircularProgress, Typography } from '@material-ui/core';
import Hls from 'hls.js/light';

import { api } from '../../api/backend';

import Colors from '../../colors';
import { ErrorOutline } from '../../icons';
import { attachVideo, currentOffset, park, seekTo, tick } from '../../timeline';
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
  'onSeeked', 'onRateChange'];

const isFullscreen = () => Boolean(document.fullscreenElement || document.webkitFullscreenElement);
const nativeHls = () => isIos() || !Hls.isSupported();

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

  // load the drive: native HLS on iOS (and wherever hls.js can't run), hls.js everywhere else
  useEffect(() => {
    if (!fullname) {
      return undefined;
    }
    const video = videoRef.current;
    const src = api.video.getQcameraStreamUrl(fullname, exp, sig);
    let hls = null;
    setError(null);
    setHasAudio(false);
    if (nativeHls()) {
      video.src = src;
    } else {
      let recovered = false;
      hls = new Hls({ maxBufferLength: 40 });
      hls.on(Hls.Events.BUFFER_CODECS, (_, data) => setHasAudio(Boolean(data.audio)));
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.response?.code === 404) {
          setError(NOT_UPLOADED); // say so at once, not after hls.js gives up on the segment
        } else if (data.fatal && data.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) {
          recovered = true;
          park();
          hls.recoverMediaError();
        } else if (data.fatal) {
          setError(UNABLE);
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

  // controls show while paused, loading or on the map, and for a moment after the player is used
  const showControls = useCallback(() => {
    setActive(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setActive(false), HIDE_CONTROLS_MS);
  }, []);
  const controlsVisible = active || !isPlaying || isBufferingVideo || mapView || Boolean(error);

  const retry = () => {
    park();
    setAttempt((n) => n + 1);
  };
  const togglePlay = () => dispatch(videoRef.current.paused ? play() : pause());
  const skip = (ms) => dispatch(seek(currentOffset() + ms));
  const toggleMute = () => hasAudio && setMuted(!muted);
  const toggleFullscreen = () => {
    const box = boxRef.current;
    if (isFullscreen()) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else if (document.fullscreenEnabled) {
      box.requestFullscreen().then(() => window.screen.orientation?.lock?.('landscape')).catch(() => {});
    } else if (document.webkitFullscreenEnabled) {
      box.webkitRequestFullscreen();
    } else if (videoRef.current.readyState) {
      videoRef.current.webkitEnterFullscreen?.(); // iPhone: the system player
    }
  };

  useEffect(() => {
    const onKeyDown = (ev) => {
      const action = {
        ' ': togglePlay, k: togglePlay, j: () => skip(-10000), ArrowLeft: () => skip(-10000),
        l: () => skip(10000), ArrowRight: () => skip(10000), f: toggleFullscreen, m: toggleMute,
      }[ev.key];
      // only when nothing else has focus, or something in the player does
      const { target } = ev;
      if (!action || ev.defaultPrevented || ev.metaKey || ev.ctrlKey || ev.altKey
        || (target !== document.body && !boxRef.current.contains(target))
        || target.tagName === 'SELECT' || (ev.key === ' ' && target.tagName === 'BUTTON')) {
        return;
      }
      ev.preventDefault();
      action();
      showControls();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // a click plays or pauses; a tap shows or hides the controls, as in the phone's own player
  const onSurfaceClick = () => {
    if (lastPointer.current === 'mouse') {
      togglePlay();
      showControls();
    } else if (active) {
      setActive(false);
    } else {
      showControls();
    }
  };

  const onMediaEvent = (ev) => {
    dispatch(mirror(ev.currentTarget));
    tick();
  };
  const mirrorEvents = Object.fromEntries(MIRRORED_EVENTS.map((name) => [name, onMediaEvent]));
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
        onPointerDown={(ev) => { lastPointer.current = ev.pointerType; }}
        onClick={onSurfaceClick}
        onDoubleClick={() => lastPointer.current === 'mouse' && toggleFullscreen()}
        onLoadedMetadata={(ev) => {
          attachVideo(ev.currentTarget);
          if (nativeHls()) {
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
        onError={nativeHls() ? () => setError(UNABLE) : undefined}
        {...mirrorEvents}
        onSeeking={(ev) => {
          onMediaEvent(ev);
          if (error) {
            setAttempt((n) => n + 1); // seeking past a segment that failed to load reloads from there
          }
        }}
      />
      {children && <div className="absolute inset-0">{children}</div>}
      <div
        className={`pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#16181AAA]
          transition-opacity ${showOverlay ? 'opacity-100 delay-300' : 'opacity-0'}`}
      >
        {error ? (
          <>
            <ErrorOutline />
            <Typography role="alert">{error}</Typography>
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
          centerButtons={!mapView && !error}
          buffering={isBufferingVideo}
          isPlaying={isPlaying}
          playSpeed={playSpeed}
          muted={muted}
          hasAudio={hasAudio}
          fullscreen={fullscreen}
          onTogglePlay={togglePlay}
          onSkip={skip}
          onSeek={(offset) => dispatch(seek(offset))}
          onSpeed={(speed) => {
            // the default rate survives the video reloading
            videoRef.current.defaultPlaybackRate = speed;
            videoRef.current.playbackRate = speed;
          }}
          onActivity={showControls}
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
