import { defineManifest } from '@crxjs/vite-plugin';

/**
 * Permission set is frozen per docs/EXTENSION_DESIGN.md §1 and CLAUDE.md — activeTab,
 * scripting, storage, nothing else. No content_scripts entry: injection happens exclusively
 * via chrome.scripting.executeScript from the background worker, triggered by an explicit user
 * action, satisfying "the content script only runs after an explicit user action."
 *
 * `externally_connectable` and `key` are additive, not part of that frozen permission set (they
 * grant no new DOM/browser capability — see docs/EXTENSION_DESIGN.md §4 and
 * docs/SECURITY_AND_PRIVACY.md §7 for the justification), confirmed with the user before
 * implementation:
 * - `externally_connectable.matches` whitelists which page origins may open a
 *   chrome.runtime.sendMessage channel to this extension — only the Career OS web app.
 * - `key` is a public RSA key (not secret) that pins a stable extension ID across dev
 *   reloads/checkouts, so /extension-connect's sendMessage(EXTENSION_ID, ...) target doesn't
 *   change every time the extension is reloaded unpacked. Generated once for local dev; a real
 *   Chrome Web Store listing gets its own key/ID at publish time and this one stops mattering.
 */
export default defineManifest({
  manifest_version: 3,
  name: 'Career OS',
  version: '0.1.0',
  description: 'Analyze job postings and detect application form fields for Career OS.',
  action: {
    default_popup: 'src/popup/index.html',
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  icons: {
    16: 'public/icons/icon16.png',
    32: 'public/icons/icon32.png',
    48: 'public/icons/icon48.png',
    128: 'public/icons/icon128.png',
  },
  permissions: ['activeTab', 'scripting', 'storage'],
  host_permissions: [],
  externally_connectable: {
    matches: ['http://localhost:3000/*', 'https://apply.mypham.space/*'],
  },
  key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA6Oh4jBUmG++l9YK1p1y5Nu+LfkUfY97e31ZCZ3M8HmHSLdjAJzifg+Rsqbks4cAskSqM7TE9Vpb9KnCoGM6fpB8cPb37jEYPmn7FsiNbK4J13tQOZWbOVVwsYYSKMwwCLpYgL8Ld8SydHN4QV5Di5IDXNUDT2N9bg5jN2qim2lVw3GzFgn76fYKNYm2V4j19IbzEGNQ7J9uEq4AQlIDkmtXWq30fQ1+YUWkoZ7IZuXwZuWG3A/2ZoC7NhlmdgaxoM1I/PcjdbHrXG1iYwCkFvhcy1N5Z+XveYkLxXPxUpmxvbCkfbJ8ts5gsjI1Jq7Fy5wpyREEKKs8bn7K9dMkjMwIDAQAB',
});
