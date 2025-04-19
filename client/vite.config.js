import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: true, // 👈 Required to accept external connections
    port: 3000, // 👈 Optional, but make sure it's the one used in nginx
    allowedHosts: ["members.estorefactory.com"], // 👈 Good!
  },
  plugins: [react()],
  build: {
    outDir: 'dist', // 👈 Only needed if you plan to do production build later
  },
})
