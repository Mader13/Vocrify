import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 5174,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  // Build optimizations for better code splitting
  build: {
    // Enable minification
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
    // Enable code splitting
    rollupOptions: {
      output: {
        // Split vendor libraries into separate chunks
        manualChunks: {
          // React ecosystem
          'react-vendor': ['react', 'react-dom'],
          
          // WaveSurfer and plugins
          'wavesurfer': ['wavesurfer.js'],
          'wavesurfer-regions': ['wavesurfer.js/dist/plugins/regions.js'],
          
          // State management
          'state': ['zustand'],
          
          // Animation
          'framer-motion': ['framer-motion'],
          
          // Icons
          'lucide-react': ['lucide-react'],
        },
      },
    },
    // Chunk size warning limit (increase to avoid warnings)
    chunkSizeWarningLimit: 1000,
  },
});
