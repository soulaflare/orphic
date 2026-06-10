import { defineConfig } from 'electron-vite'

/* The renderer stays as dependency-free classic scripts at the repo root
 * (index.html + js/ + css/) so the app keeps working as a plain web page;
 * the main process serves those files over the orphic:// scheme. Only the
 * main and preload processes are built. */
export default defineConfig({
  main: {},
  preload: {},
})
