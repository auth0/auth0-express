// Writes the HTML reference to docs/ (gitignored) and the Mintlify artifact,
// which is committed for the docs content pipeline to pick up.
//
// The root `npm run docs` also loads this file for the merged monorepo site, so
// don't set `name`: it would rename the package and break the root navigationLinks.
module.exports = {
  entryPoints: ['./src/index.ts'],
  entryPointStrategy: 'resolve',
  tsconfig: './tsconfig.docs.json',

  out: './docs/',
  json: './mintlify/auth0-express.json',
  readme: './README.md',
  cleanOutputDir: true,

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
    'Enterprise Connect',
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
