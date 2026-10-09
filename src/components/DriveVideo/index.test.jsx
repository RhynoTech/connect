import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';

import DriveVideo from '.';

const mocks = vi.hoisted(() => {
  const store = {
    state: {},
    getState: () => store.state,
    subscribe: () => () => {},
    dispatch: (action) => (typeof action === 'function' ? action(store.dispatch) : action),
  };
  return { store, hls: [] };
});

vi.mock('../../store', () => ({ default: mocks.store }));
vi.mock('../../api/backend', () => ({ api: { video: { getQcameraStreamUrl: () => 'qcamera.m3u8' } } }));
vi.mock('hls.js/light', () => ({
  default: class {
    static Events = { ERROR: 'hlsError', BUFFER_CODECS: 'hlsBufferCodecs' };

    static ErrorTypes = { MEDIA_ERROR: 'mediaError', NETWORK_ERROR: 'networkError' };

    static isSupported() { return true; }

    constructor() {
      this.handlers = {};
      this.recoverMediaError = vi.fn();
      mocks.hls.push(this);
    }

    on(event, handler) { this.handlers[event] = handler; }

    loadSource() {}

    attachMedia() {}

    destroy() {}
  },
}));

// jsdom has no PointerEvent
window.PointerEvent = class extends MouseEvent {
  constructor(type, init = {}) {
    super(type, init);
    this.pointerType = init.pointerType;
  }
};

function renderPlayer() {
  mocks.store.state = {
    currentRoute: { fullname: 'dongle|log', start_time_utc_millis: 0, duration: 60000, videoStartOffset: 0 },
    loop: { startTime: 0, duration: 60000 },
    isPlaying: false,
    playSpeed: 1,
    isBufferingVideo: false,
  };
  const { container } = render(<Provider store={mocks.store}><DriveVideo /></Provider>);
  const video = container.querySelector('video');
  Object.defineProperty(video, 'readyState', { configurable: true, value: 1 });
  video.play = vi.fn(async () => {});
  video.pause = vi.fn();
  fireEvent.loadedMetadata(video);
  const hls = mocks.hls.at(-1);
  const error = (data) => act(() => hls.handlers.hlsError('hlsError', data));
  return { video, hls, error };
}

describe('DriveVideo', () => {
  it('resumes where it was, at the same speed, after recovering from a media error', () => {
    const { video, hls, error } = renderPlayer();
    fireEvent.change(screen.getByLabelText('Playback speed'), { target: { value: '2' } });
    video.currentTime = 30;
    error({ fatal: true, type: 'mediaError' });
    expect(hls.recoverMediaError).toHaveBeenCalled();

    video.currentTime = 0; // the media reloads
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(30);
    expect(video.defaultPlaybackRate).toBe(2);
  });

  it('reports a missing segment at once, and reloads when seeked elsewhere', () => {
    const { video, hls, error } = renderPlayer();
    error({ fatal: false, type: 'networkError', response: { code: 404 } });
    expect(screen.getByRole('alert').textContent).toMatch(/not uploaded/);

    fireEvent.seeking(video);
    expect(mocks.hls.at(-1)).not.toBe(hls);
  });

  it('plays or pauses on a primary click, not other buttons or taps', () => {
    const { video } = renderPlayer();
    fireEvent.pointerDown(video, { pointerType: 'mouse', button: 2 });
    fireEvent.pointerUp(video, { pointerType: 'mouse', button: 2 });
    fireEvent.contextMenu(video);
    fireEvent.pointerDown(video, { pointerType: 'touch' });
    fireEvent.click(video);
    expect(video.play).not.toHaveBeenCalled();

    fireEvent.pointerDown(video, { pointerType: 'mouse' });
    fireEvent.click(video);
    expect(video.play).toHaveBeenCalledTimes(1);
  });

  it('leaves keys alone while something outside the player has focus', () => {
    const { video } = renderPlayer();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    fireEvent.keyDown(outside, { key: 'k' });
    expect(video.play).not.toHaveBeenCalled();

    outside.remove();
    fireEvent.keyDown(document.body, { key: 'k' });
    expect(video.play).toHaveBeenCalledTimes(1);
  });
});
