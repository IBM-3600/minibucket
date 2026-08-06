/** Offline index rebuild utility: npm run rebuild-index */
import { buildApp } from '../app.js';

const app = await buildApp();
const report = await app.mb.service.rebuild('cli', process.argv.includes('--rehash'));
console.log('Rebuild complete:', report);
await app.close();
process.exit(0);