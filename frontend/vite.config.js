import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        // Heavy libraries (Monaco code editor, tfjs+blazeface face detection, recharts) are each pinned
        // to ONE named vendor chunk so they are fetched once and shared by every page that needs them,
        // instead of being duplicated into each page's own chunk.
        //
        // The part that matters for first-load speed: React must live in its OWN chunk, and chunk groups
        // must NOT recursively swallow their dependencies. With the previous setting, the Monaco group
        // recursively pulled in React (a dependency of @monaco-editor/react), so the entry bundle had to
        // import vendor-monaco just to get React -- every visitor, even on the login page, downloaded
        // the 4 MB editor (~1.1 MB compressed) plus recharts before the app could start. Now the entry
        // only loads the small vendor-react chunk; editor / charts / face-detection load only on the
        // pages that actually use them.
        codeSplitting: {
          includeDependenciesRecursively: false,
          groups: [
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 40 },
            { name: 'vendor-monaco', test: /node_modules[\\/](monaco-editor|@monaco-editor|state-local)[\\/]/, priority: 30 },
            { name: 'vendor-tfjs', test: /node_modules[\\/](@tensorflow|@tensorflow-models)[\\/]/, priority: 30 },
            { name: 'vendor-recharts', test: /node_modules[\\/](recharts|recharts-scale|victory-vendor|d3-[^\\/]+|internmap|react-smooth|react-transition-group|dom-helpers|decimal\.js-light|eventemitter3|fast-equals|tiny-invariant)[\\/]/, priority: 30 },
          ],
        },
      },
    },
  },
})
