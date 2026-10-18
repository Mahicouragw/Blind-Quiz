import { SUPABASE_URL as PRODUCTION_SUPABASE_URL } from '../../src/config.js';

const PRODUCTION_PROJECT_HOST = new URL(PRODUCTION_SUPABASE_URL).hostname.toLowerCase();
const PRODUCTION_PROJECT_REF = PRODUCTION_PROJECT_HOST.split('.')[0];

// The live verification scripts create synthetic profiles. Require an explicit,
// dedicated non-production project so a CI job or local command cannot pollute
// the real player database by inheriting src/config.js defaults.
export function requireDedicatedTestProject() {
  const rawUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const approved = process.env.BQ_ALLOW_TEST_ACCOUNT_CREATION === 'true';
  const block = reason => {
    console.error(`Live verification blocked: ${reason} No request was sent and no profile was created.`);
    process.exit(2);
  };

  if (!rawUrl || !publishableKey || !approved) {
    block('set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY for a dedicated non-production project, and explicitly set BQ_ALLOW_TEST_ACCOUNT_CREATION=true.');
  }

  let url;
  try { url = new URL(rawUrl); } catch {
    block('SUPABASE_URL is not a valid URL.');
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === PRODUCTION_PROJECT_HOST || hostname.includes(PRODUCTION_PROJECT_REF)) {
    block('the configured URL is the production Blind Quiz project; synthetic live-test profiles are not allowed there.');
  }
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase())) {
    block('test projects must use HTTPS (localhost is allowed for a local Supabase stack).');
  }
  return url.toString().replace(/\/$/, '');
}
