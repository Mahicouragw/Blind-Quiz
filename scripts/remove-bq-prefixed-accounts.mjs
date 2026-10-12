// Preview or remove the exact BQ-prefixed profile-name group requested by the owner.
// The apply mode is intentionally restricted to 677 display names beginning with BQ and uses
// the already-guarded transactional bq_delete_account function for every matching profile.
// Usage: node scripts/remove-bq-prefixed-accounts.mjs --preview | --apply
import { appendFileSync } from 'node:fs';

const EXPECTED = 677;
const NAME_MATCH = "upper(left(display_name, 2)) = 'BQ'";
const mode = process.argv[2];
const summary = [];
const note = text => {
  console.log(process.env.GITHUB_ACTIONS ? `::notice title=BQ account cleanup::${text}` : text);
  summary.push(`- ${text}`);
};
const writeSummary = () => {
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## BQ-prefixed account cleanup\n\n${summary.join('\n')}\n`);
  }
};
const fail = message => {
  console.error(process.env.GITHUB_ACTIONS ? `::error::${message}` : message);
  summary.push(`**Stopped:** ${message}`);
  writeSummary();
  process.exit(1);
};
if (!['--preview', '--apply'].includes(mode)) fail('Usage: remove-bq-prefixed-accounts.mjs --preview | --apply');
if (mode === '--apply' && process.env.BQ_DELETE_CONFIRMATION !== 'DELETE-677-BQ-ACCOUNTS') {
  fail('The guarded workflow confirmation is missing. No account changes were made.');
}
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) fail('SUPABASE_ACCESS_TOKEN is not set.');
const ref = process.env.PROJECT_REF || 'zchircgdkyjnowqcdwvf';
async function query(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'blind-quiz-bq-account-cleanup' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await response.text();
  if (!response.ok) fail(`The guarded database query returned HTTP ${response.status}: ${text.slice(0, 350)}`);
  try { return JSON.parse(text || '[]'); }
  catch { fail('The guarded database query returned an unreadable result.'); }
}
const COUNTS = `select
  count(*) filter (where ${NAME_MATCH})::int as display_name_matches,
  count(*) filter (where upper(left(name_normalized, 2)) = 'BQ')::int as normalized_name_matches,
  count(*) filter (where upper(left(login_id, 2)) = 'BQ')::int as login_id_matches,
  (select count(*)::int from public.bq_admins a join public.bq_profiles p on p.id = a.profile_id where ${NAME_MATCH.replaceAll('display_name', 'p.display_name')}) as matched_admins,
  (select count(*)::int from public.bq_admins) as total_admins,
  (to_regprocedure('public.bq_delete_account(uuid)') is not null) as delete_function_ready,
  case when to_regprocedure('public.bq_delete_account(uuid)') is not null
    then has_function_privilege('service_role', 'public.bq_delete_account(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.bq_delete_account(uuid)', 'execute')
      and not has_function_privilege('authenticated', 'public.bq_delete_account(uuid)', 'execute')
    else false end as delete_function_locked
from public.bq_profiles`;
const snapshot = (await query(COUNTS))[0];
if (!snapshot) fail('No database preflight result was returned.');
const matches = Number(snapshot.display_name_matches);
const normalizedMatches = Number(snapshot.normalized_name_matches);
const adminsOutsideTarget = Number(snapshot.total_admins) - Number(snapshot.matched_admins);
const ready = matches === EXPECTED
  && normalizedMatches === EXPECTED
  && snapshot.delete_function_ready === true
  && snapshot.delete_function_locked === true
  && adminsOutsideTarget >= 1;
note(`Exact display-name prefix matches (BQ, case-insensitive): ${matches}.`);
note(`Normalized-name prefix matches: ${normalizedMatches}. Login-ID prefix matches (not used for deletion): ${Number(snapshot.login_id_matches)}.`);
note(`The last-admin safeguard is preserved: ${adminsOutsideTarget} admin account(s) are outside the deletion set.`);
note(`Preflight status: ${ready ? 'ready for the separately labelled apply step' : 'blocked; no accounts changed'}.`);
if (mode === '--preview') {
  writeSummary();
  if (!ready) process.exitCode = 2;
  else note('Preview only; this step did not delete accounts.');
  writeSummary();
  process.exit(process.exitCode || 0);
}
if (!ready) fail(`Deletion refused: expected exactly ${EXPECTED} matching display and normalized names, an available service_role-only deletion function, and at least one admin outside the target set. No account changes were made.`);

// One transaction, strict count recheck, a write lock against concurrent signup/renames, and the
// existing account-erasure function's cascade/last-admin checks make partial deletion impossible.
const applySql = `begin;
lock table public.bq_profiles in share row exclusive mode;
do $bq_delete$
declare target_id uuid; outcome jsonb; matched integer; deleted integer := 0; remaining integer;
begin
  select count(*) into matched from public.bq_profiles where ${NAME_MATCH};
  if matched <> ${EXPECTED} then
    raise exception 'BQ cleanup stopped: expected ${EXPECTED} exact display-name matches, found %; transaction rolled back', matched;
  end if;
  if not exists (
    select 1 from public.bq_admins a join public.bq_profiles p on p.id = a.profile_id
    where not (${NAME_MATCH.replaceAll('display_name', 'p.display_name')})
  ) then
    raise exception 'BQ cleanup stopped: it would remove the last admin; transaction rolled back';
  end if;
  for target_id in
    select id from public.bq_profiles where ${NAME_MATCH} order by id for update
  loop
    outcome := public.bq_delete_account(target_id);
    if coalesce((outcome->>'ok')::boolean, false) is not true then
      raise exception 'BQ cleanup stopped: a guarded account deletion was refused; transaction rolled back';
    end if;
    deleted := deleted + 1;
  end loop;
  select count(*) into remaining from public.bq_profiles where ${NAME_MATCH};
  if deleted <> ${EXPECTED} or remaining <> 0 then
    raise exception 'BQ cleanup stopped: count verification failed; transaction rolled back';
  end if;
end
$bq_delete$;
commit;`;
await query(applySql);
const after = (await query(`select count(*)::int as remaining_matches,
  (select count(*)::int from public.bq_admins) as remaining_admins
  from public.bq_profiles where ${NAME_MATCH}`))[0];
if (!after || Number(after.remaining_matches) !== 0 || Number(after.remaining_admins) < 1) {
  fail('The apply transaction finished but post-checks did not confirm zero prefix matches and a remaining admin. Stop and inspect the guarded workflow; no further action was taken.');
}
note(`Verified: ${EXPECTED} BQ-prefixed account records were removed; no matching display names remain, and an admin account remains.`);
writeSummary();
