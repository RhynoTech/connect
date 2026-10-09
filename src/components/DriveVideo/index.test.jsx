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

function renderPlayer() {
  mocks.store.state = {
    currentRoute: { fullname: 'dongle|log', duration: 60000, videoStartOffset: 0 },
    loop: { startTime: 0, duration: 60000 },
    isBufferingVideo: false,
  };
  const { container } = render(<Provider store={mocks.store}><DriveVideo isMuted /></Provider>);
  const video = container.querySelector('video');
  Object.defineProperty(video, 'readyState', { configurable: true, value: 1 });
  fireEvent.loadedMetadata(video);
  const hls = mocks.hls.at(-1);
  const error = (data) => act(() => hls.handlers.hlsError('hlsError', data));
  return { video, hls, error };
}

describe('DriveVideo', () => {
  it('resumes where it was after recovering from a media error', () => {
    const { video, hls, error } = renderPlayer();
    video.currentTime = 30;
    error({ fatal: true, type: 'mediaError' });
    expect(hls.recoverMediaError).toHaveBeenCalled();

    video.currentTime = 0; // the media reloads
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(30);
  });

  it('reports a missing segment at once, and reloads when seeked elsewhere', () => {
    const { video, hls, error } = renderPlayer();
    error({ fatal: false, type: 'networkError', response: { code: 404 } });
    expect(screen.getByRole('alert').textContent).toMatch(/not uploaded/);

    fireEvent.seeking(video);
    expect(mocks.hls.at(-1)).not.toBe(hls);
  });
});
