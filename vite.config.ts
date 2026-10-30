import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    rolldownOptions: {
      input: {
        main: 'index.html',
        wiiForwarders: 'wii-forwarders/index.html',
        wiiHomebrew: 'wii-homebrew/index.html',
      },
    },
  },
});
