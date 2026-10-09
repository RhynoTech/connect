import store from '../store';

// The drive's <video> element is the playback clock. DriveVideo attaches it once
// it has loaded; the timeline, map and controls follow it with followPlayback(),
// and anything else can read currentOffset(). Until then, or without a video,
// playback is parked at the last offset it was seeked to.
let video = null;
let parked = 0;

// Followers of playback get the offset on every frame while the video plays,
// and once whenever it seeks, pauses or loads. A paused video costs nothing.
const followers = new Set();
let frame = null;

function notify() {
  frame = video && !video.paused ? requestAnimationFrame(notify) : null;
  const offset = currentOffset();
  followers.forEach((follower) => follower(offset));
}

export function tick() {
  if (!frame) {
    notify();
  }
}

/**
 * @param {(offset: number) => void} follower called with the playback offset
 * @returns {() => void} stops following
 */
export function followPlayback(follower) {
  followers.add(follower);
  follower(currentOffset());
  return () => followers.delete(follower);
}

function videoStartOffset() {
  return store.getState().currentRoute?.videoStartOffset || 0;
}

function clampToLoop(offset) {
  const { loop } = store.getState();
  return loop ? Math.min(Math.max(offset, loop.startTime), loop.startTime + loop.duration) : offset;
}

/**
 * Get current playback offset
 *
 * @returns {number} milliseconds from the start of the route
 */
export function currentOffset() {
  return video ? videoStartOffset() + (video.currentTime * 1000) : clampToLoop(parked);
}

/**
 * Seek playback, staying within the selected loop
 *
 * @param {number} offset milliseconds from the start of the route
 */
export function seekTo(offset) {
  parked = offset;
  if (video) {
    video.currentTime = Math.max(0, clampToLoop(offset) - videoStartOffset()) / 1000;
  }
  tick();
}

/**
 * @returns {[number, number]|null} the loaded stretch of video around the current position, as route offsets
 */
export function bufferedRange() {
  const { buffered, currentTime } = video || {};
  for (let i = 0; i < (buffered?.length || 0); i++) {
    if (buffered.start(i) <= currentTime && currentTime <= buffered.end(i)) {
      return [buffered.start(i), buffered.end(i)].map((t) => videoStartOffset() + (t * 1000));
    }
  }
  return null;
}

// Before the video reloads (a retry, or recovering from a media error), so that
// it resumes where it was rather than at the last seek.
export function park() {
  parked = currentOffset();
}

export function playVideo() {
  video?.play().catch(() => {});
}

export function pauseVideo() {
  video?.pause();
}

/**
 * @param {HTMLVideoElement|null} element a video with media loaded, or null once it has none
 */
export function attachVideo(element) {
  video = element;
  if (video) {
    seekTo(parked);
  }
}
