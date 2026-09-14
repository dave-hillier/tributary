/**
 * The methods the browser harnesses expose on `window.tributary`. Keep this in
 * sync with `apps/desktop/src/preload.ts`; both `preview.mjs` and
 * `verify-url.mjs` import it so they can never drift apart.
 */
export const PRELOAD_METHODS = [
  'getDocument',
  'listDocuments',
  'saveDocument',
  'history',
  'resolveLink',
  'backlinks',
  'diff',
  'search',
  'listWorkItems',
  'updateWorkItem',
  'createWorkItem',
  'createProblem',
  'diagnostics',
  'renameDocument',
  'addRemote',
  'sync',
  'compileDocument',
  'updateCell',
  'runWeeklyReport',
  'listJobBranches',
  'mergeJobBranch',
];
