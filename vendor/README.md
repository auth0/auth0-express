# Vendored `@auth0/auth0-api-js` (temporary)

`auth0-api-js-1.7.0-poppy-cca4b64.tgz` is a build of the `Poppy` support in `@auth0/auth0-api-js`, which is not released yet. It exists only so that this branch can be installed and tested. Remove this folder when the release is out (see the description of the pull request).

| | |
| --- | --- |
| Source | [auth0/auth0-auth-js](https://github.com/auth0/auth0-auth-js), branch `feat/poppy-api-js`, commit `cca4b64` (pull request #342) |
| Package | `packages/auth0-api-js`, version `1.7.0` |
| SHA-256 of the file | `3dd3796fd3d3a4ba334744345edef059e62104adfd0f44a346369eb32b7b2f0b` |

To make it again, from `packages/auth0-api-js` at that commit:

```bash
rm -rf dist
npm run build
npm pack
```

`rm -rf dist` matters: without it, files of an earlier build stay in the package. Then rename the file to `auth0-api-js-1.7.0-poppy-<commit>.tgz` and point `packages/auth0-express-api/package.json` at it.

`packages/auth0-express-api/package.json` has a `file:` dependency on it, so that package must not be published as it is.
