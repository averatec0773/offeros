import { defineConfig } from 'wxt';

const devExtKey = process.env.VITE_CHROME_EXT_KEY ?? '';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    action: {},
    side_panel: { default_path: 'sidepanel.html' },
    permissions: ['storage', 'tabs', 'sidePanel', 'nativeMessaging', 'scripting'],
    host_permissions: [
      'http://localhost/*',
      'https://*.greenhouse.io/*',
      'https://boards.greenhouse.io/*',
      'https://job-boards.greenhouse.io/*',
      'https://jobs.lever.co/*',
      'https://jobs.eu.lever.co/*',
      'https://*.ashbyhq.com/*',
      'https://*.icims.com/*',
      'https://*.myworkdayjobs.com/*',
    ],
    ...(devExtKey ? { key: devExtKey } : {}),
  },
});
