// playback controls act on the drive's video, see ./index.js
// the store only mirrors what the video reports, through videoState()
import * as Types from '../actions/types';
import { pauseVideo, playVideo, seekTo } from '.';

export function reducer(state, action) {
  switch (action.type) {
    case Types.ACTION_LOOP: {
      const hasLoop = action.start !== null && action.start !== undefined
        && action.end !== null && action.end !== undefined;
      return {
        ...state,
        loop: hasLoop ? { startTime: action.start, duration: action.end - action.start } : null,
      };
    }
    case Types.ACTION_VIDEO_STATE:
      return { ...state, ...action.state };
    default:
      return state;
  }
}

// seek to a specific offset
export function seek(offset) {
  return (dispatch) => {
    seekTo(offset);
    dispatch({ type: Types.ACTION_SEEK, offset });
  };
}

// pause the playback
export function pause() {
  return (dispatch) => {
    pauseVideo();
    dispatch({ type: Types.ACTION_PAUSE });
  };
}

// resume the playback
export function play() {
  return (dispatch) => {
    playVideo();
    dispatch({ type: Types.ACTION_PLAY });
  };
}

export function selectLoop(start, end) {
  return {
    type: Types.ACTION_LOOP,
    start,
    end,
  };
}

// mirror the video's state: { isPlaying, playSpeed, isBufferingVideo }
export function videoState(state) {
  return {
    type: Types.ACTION_VIDEO_STATE,
    state,
  };
}
