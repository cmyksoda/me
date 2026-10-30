import { parseTPL } from './tpl';

// Banners decode here, off the main thread, so opening one never waits on its textures.
addEventListener('message', (event: MessageEvent<{ id: number; bytes: Uint8Array }>) => {
  const texture = parseTPL(event.data.bytes)[0];
  postMessage({ id: event.data.id, texture }, { transfer: [texture.rgba.buffer] });
});
