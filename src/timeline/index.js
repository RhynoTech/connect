import store from '../store';

// The drive's <video> element is the playback clock. DriveVideo attaches it once
// it has loaded, and everything that follows playback (timeline, map, time
// display) reads currentOffset(). Until then, or without a video, playback is
// parked at the last offset it was seeked to.
let video = null;
let parked = 0;

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
}

// Before the video reloads (a retry, or recovering from a media error), so that
// it resumes where it was rather than at the last seek.
export function park() {
  parked = currentOffset();
}

export function playVideo(speed) {
  if (video) {
    video.defaultPlaybackRate = speed; // survives the video reloading
    video.playbackRate = speed;
    video.play().catch(() => {});
  }
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
