// Writes the Mintlify artifact, which is committed for the docs content pipeline to pick up.
// Only `json` is set, so no HTML is written here. The HTML site comes from `typedoc.json`.
// `npm run docs` runs both, this file only through `--options typedoc.cjs`.
module.exports = {
  entryPoints: ['./src/index.ts'],
  entryPointStrategy: 'resolve',
  tsconfig: './tsconfig.build.json',

  json: './mintlify/auth0-express.json',
  readme: './README.md',

  excludePrivate: true,
  excludeProtected: true,
  excludeInternal: true,
  excludeExternals: true,
  externalPattern: ['**/node_modules/typescript/**', '**/node_modules/@types/**'],

  categorizeByGroup: false,
  // Re-exports from @auth0/auth0-server-js carry its categories (Configuration, Errors,
  // Utilities, Session Stores & Cookies), so those names are part of this list.
  categoryOrder: [
    'Getting Started',
    'Configuration',
    'Route Protection',
    'Claim Checks',
    'Enterprise Connect',
    'Anonymous Sessions',
    'Session Stores & Cookies',
    'Utilities',
    'Errors',
    '*',
    'Other',
  ],
  defaultCategory: 'Other',
  navigation: {
    includeCategories: true,
    includeGroups: false,
  },
  sort: ['kind', 'alphabetical'],
  kindSortOrder: ['Function', 'Class', 'Interface', 'TypeAlias', 'Enum', 'Variable'],

  // Keeps source links stable so regenerating only diffs changed symbols.
  gitRevision: 'main',
  hideGenerator: true,
  searchInComments: true,
};
