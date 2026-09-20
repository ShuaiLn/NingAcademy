import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { checkPlanHash } from './preparation.mjs';
checkPlanHash();
const directory = 'docs/personalized-english/phase2/';
const read = name => JSON.parse(readFileSync(directory + name, 'utf8'));
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const label = '(^|[^a-z])(' + read('sensitive-labels.v1.json').labels.map(escape).join('|') + ')([ ]*[:#=-][ ]*|[ ]+)[^ ]';
const patterns = [...read('stage1-patterns.v1.json').patterns.map(pattern => pattern.source), label];
const files = ['limits.v1.json', 'runtime-profile.v1.json', 'stage1-patterns.v1.json', 'sensitive-labels.v1.json',
  'gazetteer.v1.json', 'institution-patterns.v1.json', 'ner-correction-rules.v1.json', 'correction-fixtures.v1.json', 'morphology.v1.json', 'dictionary.v1.json'];
const registry = read('correction-fixtures.v1.json');
const limits = read('limits.v1.json');
const runtimeProfile = read('runtime-profile.v1.json');
const morphology = read('morphology.v1.json');
const normalizationParity = [
  { label: 'ascii', input: '  Mixed   CASE  ', expected: 'mixed case' },
  { label: 'newline', input: 'line\nbreak', expected: 'line break' },
  { label: 'tab', input: 'tab\tspace', expected: 'tab space' },
  { label: 'blank-spacing', input: '\t\r\n', expected: '' },
  { label: 'NEL', input: 'nel\u0085space', expected: 'nel space' },
  { label: 'em-space', input: 'em\u2003space', expected: 'em space' },
  { label: 'ideographic-space', input: 'full\u3000width', expected: 'full width' },
  { label: 'NBSP-excluded', input: 'nbsp\u00a0gap', expected: 'nbsp\u00a0gap' },
  { label: 'figure-space-excluded', input: 'figure\u2007space', expected: 'figure\u2007space' },
  { label: 'leading-BOM-excluded', input: '\uFEFFleading', expected: '\uFEFFleading' },
  { label: 'trailing-BOM-excluded', input: 'trailing\uFEFF', expected: 'trailing\uFEFF' },
  { label: 'capital-I-dot', input: '\u0130', expected: 'i' },
  { label: 'final-sigma', input: '\u039f\u03a3', expected: '\u03bf\u03c3' },
  { label: 'interior-sigma', input: '\u039f\u03a3\u0391', expected: '\u03bf\u03c3\u03b1' },
];
const ids = new Set(registry.fixtures.map(fixture => fixture.id));
if (ids.size !== registry.fixtures.length) throw Error('Duplicate fixture ID');
for (const rule of [...read('ner-correction-rules.v1.json').rules, ...read('institution-patterns.v1.json').patterns]) {
  if (!rule.id || !rule.version || !rule.reason || !rule.fixtureIds?.length || rule.fixtureIds.some(id => !ids.has(id))) throw Error('Unregistered policy rule');
}
if (!Array.isArray(morphology.rules) || morphology.rules.length === 0 || morphology.rules.some(rule =>
  !['strip', 'replace', 'stem_variants'].includes(rule.kind) || !rule.suffix || !Number.isInteger(rule.minimumStemLength)
  || rule.minimumStemLength < 1 || (rule.kind === 'replace' && !rule.replacement))) {
  throw Error('Governed morphology rules are incomplete');
}
const requireSource = (path, snippets) => {
  const source = readFileSync(path, 'utf8');
  for (const snippet of snippets) if (!source.includes(snippet)) throw Error(`Governed runtime drift in ${path}: ${snippet}`);
};
requireSource('app/_lib/ocr-import/candidates.ts', [
  'profile.confidenceBands.confirmMinimum',
  'profile.confidenceBands.normalMinimum',
]);
requireSource('app/_lib/ocr-import/policy.ts', [
  'profile.position.minimumValidNonblankLines',
  'profile.position.edgeFraction',
]);
requireSource('app/_lib/ocr-import/dictionary.ts', ['morphology.rules as readonly MorphologyRule[]']);
const manifest = { version: 1, status: 'LOCAL_IMPLEMENTATION_AWAITING_APPROVAL', approvedAt: null, deployedAt: null,
  precedenceVersion: 1, positionalThresholds: read('runtime-profile.v1.json').position, positionalApproval: null,
  artifacts: files.map(name => ({ path: directory + name, sha256: hash(directory + name) })) };
const manifestPath = directory + 'privacy-policy.v1.json';
if (existsSync(manifestPath)) {
  const existing = read('privacy-policy.v1.json');
  if (existing.approvedAt || existing.deployedAt) {
    if (JSON.stringify(existing.artifacts) !== JSON.stringify(manifest.artifacts)) throw Error('Approved/deployed v1 is immutable; introduce v2');
    manifest.status = existing.status; manifest.approvedAt = existing.approvedAt; manifest.deployedAt = existing.deployedAt;
    manifest.positionalApproval = existing.positionalApproval;
  }
}
const sql = `-- BEGIN GENERATED STAGE1 (scripts/phase2/policy-governance.mjs)
create function private.captured_text_has_high_confidence_pii_v1(p_text text)
returns boolean language sql immutable security definer set search_path = '' as $pii$
  select ${patterns.map(pattern => `pg_catalog.regexp_replace(pg_catalog.normalize(coalesce(p_text, ''), 'NFKC'), '[[:space:]]+', ' ', 'g') ~* '${pattern.replaceAll("'", "''")}'`).join('\n    or ')};
$pii$;
revoke all on function private.captured_text_has_high_confidence_pii_v1(text) from public, anon, authenticated;
comment on function private.captured_text_has_high_confidence_pii_v1(text) is 'Generated v1 deterministic Stage 1 defense in depth; never logs input. Private only, no authenticated execute grant.';
-- END GENERATED STAGE1`;
const normalizationSql = `-- BEGIN GENERATED NORMALIZATION PARITY (scripts/phase2/policy-governance.mjs)
select is(private.normalize_spelling(input), expected, 'Postgres/TypeScript normalization fixture: ' || label)
from jsonb_to_recordset($fixtures$${JSON.stringify(normalizationParity)}$fixtures$::jsonb)
  as fixtures(label text, input text, expected text);
-- END GENERATED NORMALIZATION PARITY`;
const migration = 'supabase/migrations/20260919025607_personal_word_ocr_imports.sql';
const original = readFileSync(migration, 'utf8');
const databaseTest = 'supabase/tests/personal_english_ocr.test.sql';
const originalDatabaseTest = readFileSync(databaseTest, 'utf8');
for (const snippet of [
  `check (confirmed_count between 1 and ${limits.maxBulkItems})`,
  `ocr_item_index between 0 and ${limits.maxBulkItems - 1}`,
  `p_item_index not between 0 and ${limits.maxBulkItems - 1}`,
  `v_count not between 1 and ${limits.maxBulkItems}`,
  `char_length(v_term) > ${limits.maxTermLength}`,
  `char_length(v_meaning) > ${limits.maxMeaningLength}`,
  `char_length(v_example) > ${limits.maxExampleLength}`,
  `char_length(v_sentence) > ${limits.maxExampleLength}`,
  `) > ${limits.hourlyImports}`,
  `) > ${limits.lifetimeImports}`,
  `+ v_count > ${limits.lifetimeSourceItems}`,
]) if (!original.includes(snippet)) throw Error('Governed SQL limit drift: ' + snippet);
const outputs = [[manifestPath, JSON.stringify(manifest, null, 2) + '\n'],
  [migration, original.replace(/-- BEGIN GENERATED STAGE1[^]*?-- END GENERATED STAGE1/, sql)],
  [databaseTest, originalDatabaseTest.replace(/-- BEGIN GENERATED NORMALIZATION PARITY[^]*?-- END GENERATED NORMALIZATION PARITY/, normalizationSql)],
  ['app/_lib/ocr-import/policy.generated.ts', '// Generated by policy-governance.mjs; approval is separate.\nexport const PRIVACY_POLICY_VERSION = 1 as const;\nexport const POLICY_ARTIFACT_HASHES = ' + JSON.stringify(manifest.artifacts, null, 2) + ' as const;\n'],
  ['scripts/phase2/policy-test-literals.generated.json', JSON.stringify({ limits, runtimeProfile, morphology, normalizationParity, stage1: patterns, fixtureIds: [...ids] }, null, 2) + '\n']];
for (const [path, content] of outputs) {
  if (process.argv.includes('--write')) writeFileSync(path, content);
  else if (readFileSync(path, 'utf8') !== content) throw Error('Governed artifact drift: ' + path);
}
console.log('Policy hashes, generated SQL/TS/test literals, rule coverage and freeze state verified; approval not inferred.');
