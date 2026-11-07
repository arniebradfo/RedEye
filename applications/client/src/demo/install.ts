import { db } from './db';
import { executeDemoQuery } from './executor';
import { installFetchShim } from './fetch-shim';
import { demoSettings } from './settings';

// Imported first by index.tsx so the shim is in place before the store makes its first request
installFetchShim();

// Handy for debugging in devtools, and used by the Cypress GraphQL tests
(window as any).__redeyeDemo = { db, executeDemoQuery, demoSettings };
