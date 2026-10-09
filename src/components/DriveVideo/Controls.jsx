import React, { useEffect, useRef, useState } from 'react';
import dayjs from 'dayjs';

import { Forward10, Fullscreen, FullscreenExit, Pause, PlayArrow, Replay10, VolumeOff, VolumeUp } from '../../icons';
import { bufferedRange, followPlayback, seekTo, tick } from '../../timeline';
import { getSegmentNumber } from '../../utils';

const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4, 8];
const NO_AUDIO = 'Enable audio recording through the "Record and Upload Microphone Audio" toggle on your device';

// Followers run every frame while playing, so they skip writes that would
// change nothing, and all their work while the controls are hidden.
function changed(last, key, value) {
  if (last[key] === value) {
    return false;
  }
  last[key] = value;
  return true;
}

function useFollowWhileVisible(visible, follower, deps) {
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  useEffect(() => {
    const last = {};
    return followPlayback((offset) => visibleRef.current && follower(offset, last));
  }, deps);
  useEffect(() => {
    if (visible) {
      tick();
    }
  }, [visible]);
}

// what the clock shows changes with its second, or with the segment
function clockKey(route, offset) {
  return `${Math.floor((route.start_time_utc_millis + offset) / 1000)} ${getSegmentNumber(route, offset)}`;
}

function clockTime(route, offset) {
  const time = dayjs(route.start_time_utc_millis + offset);
  return time.isValid() ? `${time.format('HH:mm:ss')} · seg ${getSegmentNumber(route, offset)}` : '--:--:--';
}

const Button = ({ label, className = '', children, ...props }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    className={`flex size-11 shrink-0 items-center justify-center rounded-full text-white transition-colors
      hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40 disabled:hover:bg-transparent
      [&_svg]:size-6 ${className}`}
    {...props}
  >
    {children}
  </button>
);

// Seeks within the selection. Dragging shows real frames where the video has
// loaded and seeks once on release, so a drag never downloads every segment
// it passes over.
function Scrubber({ route, start, end, visible, onSeek }) {
  const trackRef = useRef(null);
  const progressRefs = [useRef(null), useRef(null)];
  const bufferedRef = useRef(null);
  const dragging = useRef(false);
  const [hover, setHover] = useState(null);

  const fraction = (offset) => Math.min(1, Math.max(0, (offset - start) / (end - start)));
  const offsetAt = (ev) => {
    const { left, width } = trackRef.current.getBoundingClientRect();
    return start + (Math.min(1, Math.max(0, (ev.clientX - left) / width)) * (end - start));
  };
  const show = (offset, last = {}) => {
    const percent = fraction(offset) * 100;
    if (changed(last, 'percent', percent)) {
      progressRefs.forEach((ref) => { ref.current.style.transform = `translateX(${percent - 100}%)`; });
    }
    if (changed(last, 'valuenow', Math.round(percent))) {
      trackRef.current.setAttribute('aria-valuenow', Math.round(percent));
    }
    if (changed(last, 'clock', clockKey(route, offset))) {
      trackRef.current.setAttribute('aria-valuetext', clockTime(route, offset));
    }
  };

  useFollowWhileVisible(visible, (offset, last) => {
    const [from, to] = bufferedRange() || [start, start];
    if (changed(last, 'buffered', `${from},${to}`)) {
      bufferedRef.current.style.left = `${fraction(from) * 100}%`;
      bufferedRef.current.style.width = `${(fraction(to) - fraction(from)) * 100}%`;
    }
    if (!dragging.current) {
      show(offset, last);
    }
  }, [route, start, end]);

  const scrub = (ev) => {
    const offset = offsetAt(ev);
    setHover(offset);
    if (dragging.current) {
      show(offset);
      const range = bufferedRange();
      if (range && range[0] <= offset && offset <= range[1]) {
        seekTo(offset);
      }
    }
  };

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={100}
      className="group relative flex h-8 cursor-pointer touch-none items-center outline-none"
      onPointerDown={(ev) => {
        ev.currentTarget.setPointerCapture(ev.pointerId);
        dragging.current = true;
        scrub(ev);
      }}
      onPointerMove={(ev) => (dragging.current || ev.pointerType === 'mouse') && scrub(ev)}
      onPointerUp={(ev) => {
        if (dragging.current) {
          dragging.current = false;
          onSeek(offsetAt(ev));
        }
        if (ev.pointerType !== 'mouse') {
          setHover(null);
        }
      }}
      onPointerCancel={() => {
        dragging.current = false;
        setHover(null);
      }}
      onPointerLeave={() => !dragging.current && setHover(null)}
    >
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/25 transition-[height] group-hover:h-1.5 group-active:h-1.5">
        <div ref={bufferedRef} className="absolute inset-y-0 bg-white/30" />
        <div ref={progressRefs[0]} className="absolute inset-0 bg-white will-change-transform" />
      </div>
      <div ref={progressRefs[1]} className="pointer-events-none absolute inset-x-0 will-change-transform">
        <div className="absolute right-0 size-3.5 -translate-y-1/2 translate-x-1/2 rounded-full bg-white shadow
          transition-transform group-hover:scale-125 group-focus-visible:outline-2 group-focus-visible:outline-white group-active:scale-125"
        />
      </div>
      {hover !== null && (
        <div
          className="pointer-events-none absolute bottom-full mb-1 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#0c0e0f]/90
            px-2.5 py-1 text-xs font-medium tabular-nums text-white"
          style={{ left: `${fraction(hover) * 100}%` }}
        >
          {clockTime(route, hover)}
        </div>
      )}
    </div>
  );
}

// Over the video: a bar along the bottom, and on touch screens the play and
// skip buttons in the middle, where thumbs expect them. Wherever the middle
// ones aren't shown (on the map, after an error, play while loading), the bar
// has them instead.
const Controls = ({
  route, loop, visible, centerButtons, buffering, isPlaying, playSpeed, muted, hasAudio, fullscreen,
  onTogglePlay, onSkip, onSeek, onSpeed, onToggleMute, onToggleFullscreen, onActivity,
}) => {
  const timeRef = useRef(null);
  useFollowWhileVisible(visible, (offset, last) => {
    if (changed(last, 'clock', clockKey(route, offset))) {
      timeRef.current.textContent = clockTime(route, offset);
    }
  }, [route]);

  const start = loop ? loop.startTime : 0;
  const end = loop ? loop.startTime + loop.duration : route.duration;
  const interactive = visible ? 'pointer-events-auto' : 'pointer-events-none';
  const PlayIcon = isPlaying ? Pause : PlayArrow;
  const playLabel = isPlaying ? 'Pause' : 'Play';
  const centerPlay = centerButtons && !buffering;

  return (
    // using the controls keeps them up; so does focusing one from the keyboard
    <div
      className={`pointer-events-none absolute inset-0 text-white transition-opacity duration-200 motion-reduce:transition-none
        has-[:focus-visible]:opacity-100 ${visible ? 'opacity-100' : 'opacity-0'}`}
      onPointerDown={onActivity}
      onPointerMove={onActivity}
    >
      {centerButtons && (
        <div className="absolute inset-0 flex items-center justify-center gap-10">
          <Button label="Back 10 seconds" className={`hidden bg-black/40 pointer-coarse:flex ${interactive}`} onClick={() => onSkip(-10000)}>
            <Replay10 />
          </Button>
          <Button
            label={playLabel}
            className={`size-16 bg-black/40 [&_svg]:size-10 ${isPlaying ? 'hidden pointer-coarse:flex' : ''}
              ${centerPlay ? interactive : 'pointer-events-none opacity-0'}`}
            onClick={onTogglePlay}
          >
            <PlayIcon />
          </Button>
          <Button label="Forward 10 seconds" className={`hidden bg-black/40 pointer-coarse:flex ${interactive}`} onClick={() => onSkip(10000)}>
            <Forward10 />
          </Button>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/80 to-transparent px-3 pt-8">
        <div className={interactive}>
          <Scrubber route={route} start={start} end={end} visible={visible} onSeek={onSeek} />
        </div>
        <div className={`flex items-center gap-1 pb-1 ${interactive}`}>
          <Button label={playLabel} className={centerPlay ? 'pointer-coarse:hidden' : ''} onClick={onTogglePlay}>
            <PlayIcon />
          </Button>
          <Button label="Back 10 seconds" className={centerButtons ? 'pointer-coarse:hidden' : ''} onClick={() => onSkip(-10000)}>
            <Replay10 />
          </Button>
          <Button label="Forward 10 seconds" className={centerButtons ? 'pointer-coarse:hidden' : ''} onClick={() => onSkip(10000)}>
            <Forward10 />
          </Button>
          <span ref={timeRef} className="min-w-0 flex-1 truncate px-2 text-sm font-medium tabular-nums" />
          <label
            className="relative flex h-11 shrink-0 items-center rounded-full px-3 text-sm font-medium tabular-nums hover:bg-white/10
              has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-white"
          >
            {`${playSpeed}×`}
            <select
              aria-label="Playback speed"
              className="absolute inset-0 cursor-pointer opacity-0"
              value={playSpeed}
              onChange={(ev) => onSpeed(Number(ev.target.value))}
            >
              {SPEEDS.map((speed) => <option key={speed} value={speed}>{`${speed}×`}</option>)}
            </select>
          </label>
          <span title={hasAudio ? undefined : NO_AUDIO}>
            <Button label={muted ? 'Unmute' : 'Mute'} disabled={!hasAudio} onClick={onToggleMute}>
              {muted ? <VolumeOff /> : <VolumeUp />}
            </Button>
          </span>
          <Button label={fullscreen ? 'Exit full screen' : 'Full screen'} onClick={onToggleFullscreen}>
            {fullscreen ? <FullscreenExit /> : <Fullscreen />}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Controls;
