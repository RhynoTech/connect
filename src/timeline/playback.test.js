import { vi } from 'vitest';

import { attachVideo, currentOffset, park, seekTo } from '.';
import { pause, play, reducer, seek, selectLoop, videoState } from './playback';

const state = { currentRoute: null, loop: null };
vi.mock('../store', () => ({ default: { getState: () => state } }));

function makeVideo() {
  return { currentTime: 0, playbackRate: 1, play: vi.fn(async () => {}), pause: vi.fn() };
}

describe('playback', () => {
  beforeEach(() => {
    state.currentRoute = { videoStartOffset: 500 };
    state.loop = { startTime: 1000, duration: 1000 };
    attachVideo(null);
    seekTo(0);
  });

  it('selects and clears loops', () => {
    expect(reducer({}, selectLoop(1000, 3000)).loop).toEqual({ startTime: 1000, duration: 2000 });
    expect(reducer({ loop: state.loop }, selectLoop(null, null)).loop).toBeNull();
  });

  it('mirrors video state', () => {
    const before = { isPlaying: true, playSpeed: 1, isBufferingVideo: false };
    expect(reducer(before, videoState({ isPlaying: false, playSpeed: 2, isBufferingVideo: true })))
      .toEqual({ isPlaying: false, playSpeed: 2, isBufferingVideo: true });
  });

  it('parks playback inside the loop until a video loads', () => {
    expect(currentOffset()).toEqual(1000);
    seekTo(1500);
    expect(currentOffset()).toEqual(1500);
    seekTo(5000);
    expect(currentOffset()).toEqual(2000);
  });

  it('follows the video once it has loaded', () => {
    seekTo(1500);
    const video = makeVideo();
    attachVideo(video);
    expect(video.currentTime).toEqual(1); // 1500ms into the route is 1s into the video
    video.currentTime = 1.25;
    expect(currentOffset()).toEqual(1750);
  });

  it('seeks the video within the loop', () => {
    const video = makeVideo();
    attachVideo(video);
    seekTo(5000);
    expect(currentOffset()).toEqual(2000);
    state.loop = { startTime: 0, duration: 2000 };
    seekTo(0); // the route starts before the video
    expect(video.currentTime).toEqual(0);
  });

  it('resumes a reloaded video where it was, not at the last seek', () => {
    const video = makeVideo();
    seekTo(1000);
    attachVideo(video);
    video.currentTime = 1.2; // played on past the seek
    park();
    video.currentTime = 0; // reloading starts the media over
    attachVideo(video);
    expect(currentOffset()).toEqual(1700);
  });

  it('controls the video and still reports each action', () => {
    const video = makeVideo();
    attachVideo(video);
    const dispatch = vi.fn();

    play(2)(dispatch);
    expect(video.playbackRate).toEqual(2);
    expect(video.defaultPlaybackRate).toEqual(2);
    expect(video.play).toHaveBeenCalled();

    pause()(dispatch);
    expect(video.pause).toHaveBeenCalled();

    seek(1250)(dispatch);
    expect(currentOffset()).toEqual(1250);

    expect(dispatch.mock.calls.map(([action]) => action.type)).toEqual(['ACTION_PLAY', 'ACTION_PAUSE', 'ACTION_SEEK']);
  });
});
