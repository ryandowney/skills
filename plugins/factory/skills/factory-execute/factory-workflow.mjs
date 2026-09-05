export const meta = {
  name: 'factory-execute',
  description: 'Factory execution engine: decompose an approved plan, implement backend + frontend in parallel, test, and fix until green.',
  phases: [
    { title: 'Decompose', detail: 'turn the approved plan into backend + frontend task lists' },
    { title: 'Implement', detail: 'backend and frontend implementers in parallel (Sonnet)' },
    { title: 'Test', detail: 'backend: dotnet test vs the repo test suite · frontend: npm run check + build' },
    { title: 'Fix', detail: 'fix new failures and re-test, up to a round cap' },
  ],
}

// ---- args (passed by the /factory skill) -------------------------------------
// {
//   planPath:      absolute path to the approved plan/requirements+test-plan doc   (required)
//   repoDir:       absolute path to the monorepo working tree                      (required)
//   featureBranch: branch name already checked out
//   solutionPath:  repo-relative path to the .sln   (required — resolve from src/*.sln; the template
//                  placeholder; after scripts/init-project.sh it is src/<ProjectName>.sln, so
//                  the caller should pass the resolved path)
//   webDir:        absolute path to the frontend    (default: <repoDir>/apps/web)
//   dotnetCmd:     how to invoke dotnet             (default: 'dotnet'; pass a machine-specific
//                  override here if the project's CLAUDE.md defines one)
//   baseline:      description of the current green baseline (suite count / known-failing tests)
//   maxFixRounds:  number (default 3)
//   houseRulesHint: string — REPLACES the built-in house-rules paragraph. The built-in one describes
//                  the template repo (DbUp scripts, shadcn-svelte, apps/web, {Entity}{Op} naming);
//                  a repo with different conventions MUST pass its own or implementers get told to
//                  do the wrong thing.
//   schemaInstruction: string — REPLACES the built-in "exactly one DbUp script" instruction given to
//                  the backend implementer. Pass e.g. "This change needs NO migration" when true.
// }
// args can arrive JSON-stringified depending on the caller — normalize defensively.
const A = typeof args === 'string' ? JSON.parse(args) : (args || {})

const repoDir = A.repoDir
if (!repoDir) throw new Error('factory-workflow: repoDir is required (absolute path to the repo root)')
const planPath = A.planPath
if (!planPath) throw new Error('factory-workflow: planPath is required (absolute path to the approved plan)')

const webDir = A.webDir || `${repoDir}/apps/web`
const SLN = A.solutionPath
if (!SLN) throw new Error('factory-workflow: solutionPath is required (resolve with: ls $repoDir/src/*.sln)')
const DOTNET = A.dotnetCmd || 'dotnet'
const MAX_FIX_ROUNDS = A.maxFixRounds || 3
const BASELINE = A.baseline ||
  'not recorded — run the suite once BEFORE changing anything to establish the current green baseline, ' +
  'then treat anything newly red as caused by this feature'

const BUILD_CMD = `${DOTNET} build ${SLN}`
const TEST_CMD = `${DOTNET} test ${SLN}`

const HOUSE_RULES_HINT = A.houseRulesHint || `Follow every rule in ${repoDir}/CLAUDE.md (it is the authority; read it before writing code) ` +
  `and the repo's living spec if it has one (e.g. docs/functional-spec.md). ` +
  `Layering: Clients call ONE Manager; Managers→Engines/Accessors; Engines→Accessors; Accessors→Utilities only. ` +
  `ServiceProxy for dependencies (handlers are Activator-created — no constructor DI). ` +
  `HandlerResolver naming: {Entity}{Op}Request in Contracts.Requests.{Path} → {Entity}{Op}Handler in Handlers.{Path} — ` +
  `names AND namespace segments must mirror exactly or reflection-based dispatch fails at RUN TIME (it still compiles). ` +
  `Validation logic lives in the validation engine ({Name}ValidationHandler); managers keep thin Validate delegates — ` +
  `and permission/validation tests must go through the same entry point production uses (a test that calls Handle() ` +
  `while skipping Validate() proves nothing about the gate). ` +
  `Auth gates and fail-closed access resolution as defined in CLAUDE.md. ` +
  `Exactly ONE new DbUp script per feature (next sequential NNN_Description.sql in the DbUp project's Scripts/ folder — ` +
  `read the folder to get the number; never edit a shipped script) and it MUST be registered wherever the test host ` +
  `applies schema, or the suite runs against stale schema. ` +
  `Tests: reuse the EXISTING base classes and seed helpers in the repo's test project (src/**/*.Tests) — discover their ` +
  `real names, do not invent them; seeds must be FK-honest (real parent rows, valid lookup ids). ` +
  `Assertions must be falsifiable: if no plausible production change could make the test fail, it is decoration. ` +
  `Frontend: SvelteKit + Svelte 5 runes + Tailwind v4; API calls in apps/web/src/lib/api.ts must match controller routes exactly; ` +
  `COMPOSITION RULE: every page is COMPOSED from the shared library in apps/web/src/lib/components ` +
  `— shadcn-svelte, imported from the '$lib/components' barrel: Button/Input/Textarea/Label/Badge/Separator/Spinner ` +
  `single-part, Card./Dialog./Table./Alert./Field./Empty./NativeSelect. namespaced, plus AppShell/PageHeader which are ours. ` +
  `Pages hold composition + page-specific logic only; need a pattern the library lacks => run ` +
  `\`npx shadcn-svelte add <name>\`, export it from the barrel, THEN use it. Hand-rolled Tailwind ` +
  `for any primitive the library covers is a review violation. Any new UI must handle the empty, loading and error ` +
  `states, and use colour/opacity that is actually visible on the surface it sits on (a build passes either way).`

const DECOMPOSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['backendTasks', 'webTasks'],
  properties: {
    backendTasks: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['title', 'detail'], properties: {
        title: { type: 'string' }, detail: { type: 'string' },
        files: { type: 'array', items: { type: 'string' } } } } },
    webTasks: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['title', 'detail'], properties: {
        title: { type: 'string' }, detail: { type: 'string' },
        files: { type: 'array', items: { type: 'string' } } } } },
    testPlan: { type: 'string', description: 'test cases to add, and which existing test tier/base class each uses' },
    notes: { type: 'string' },
  },
}

const TEST_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['area', 'passed', 'summary'],
  properties: {
    area: { type: 'string' },
    passed: { type: 'boolean' },
    newFailures: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

const IMPL_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['area', 'done', 'summary'],
  properties: {
    area: { type: 'string' },
    done: { type: 'boolean' },
    summary: { type: 'string' },
    filesTouched: { type: 'array', items: { type: 'string' } },
  },
}

// ---- Stage 1: Decompose -------------------------------------------------------
phase('Decompose')
const plan = await agent(
  `Read the approved plan at ${planPath}. It is the source of truth for a full-stack feature in the repo at ${repoDir}.\n` +
  `Decompose it into concrete, ordered implementation tasks split by area: backendTasks (under ${repoDir}/src) and ` +
  `webTasks (under ${webDir}; return an empty array if this repo has no frontend). Each task = a title + a specific ` +
  `detail an engineer can act on, plus the likely files. Copy each affected handler's CONTRACT block ` +
  `from the plan VERBATIM into the detail of the task that implements it — implementers see your task list, ` +
  `not the plan, and a handler implemented without its contract gets tests written from the code instead. Also restate the test cases to cover and which existing test ` +
  `tier/base class each belongs to (read the test project to get the real names). ${HOUSE_RULES_HINT}`,
  { label: 'decompose-plan', phase: 'Decompose', schema: DECOMPOSE_SCHEMA, effort: 'high' }
)

log(`Decomposed: ${plan.backendTasks.length} backend task(s), ${plan.webTasks.length} web task(s)`)

// ---- Stage 2: Implement (areas in parallel — disjoint dirs in one repo) --------
phase('Implement')
async function implementArea(area, tasks, extra) {
  if (!tasks || tasks.length === 0) return { area, done: true, summary: 'no tasks', filesTouched: [] }
  const taskList = tasks.map((t, i) => `${i + 1}. ${t.title} — ${t.detail}${t.files ? ' [files: ' + t.files.join(', ') + ']' : ''}`).join('\n')
  return agent(
    `You are the ${area} implementer. Repo: ${repoDir} (already on the feature branch). ` +
    `Stay strictly within your area (${area === 'backend' ? 'src/ and docs/' : webDir}) — another agent owns the other area. ` +
    `Implement ALL of the following tasks IN ORDER, as production code matching the codebase's existing patterns. ` +
    `The approved plan at ${planPath} is the statement of intent — consult it whenever a task is ambiguous, and ` +
    `write each handler's CONTRACT block into the code as part of implementing that handler. ` +
    `${HOUSE_RULES_HINT}\n\nTASKS:\n${taskList}\n\n${extra}\nReturn done=false if you could not finish; list files touched.`,
    { label: `implement:${area}`, phase: 'Implement', schema: IMPL_SCHEMA, model: 'sonnet', effort: 'high' }
  )
}

const impl = await parallel([
  () => implementArea('backend', plan.backendTasks,
    (A.schemaInstruction ||
    `Put ALL SQL schema changes into EXACTLY ONE new DbUp script (next sequential number in the DbUp project's ` +
    `Scripts/ folder under ${repoDir}/src) and make sure it is registered the way the existing scripts are, including ` +
    `for the test host.`) + ` After implementing, run \`${BUILD_CMD}\` from ${repoDir} and fix any compile errors before ` +
    `returning. Write the plan's test cases in the repo's test project (${repoDir}/src/**/*.Tests) using its existing ` +
    `base classes, real-database tiers and FK-honest seeds.`),
  () => implementArea('web', plan.webTasks,
    `Do NOT add a test framework — the frontend gate is \`npm run check\` + \`npm run build\`. After implementing, ` +
    `run both from ${webDir} and fix issues before returning.`),
])
impl.filter(Boolean).forEach(r => log(`Implemented ${r.area}: ${r.summary}`))

// ---- Stages 3+4: Test, then fix-until-green ----------------------------------
async function testBackend() {
  return agent(
    `Test the backend at ${repoDir}. If the suite uses Testcontainers, Docker must be running. ` +
    `Run \`${BUILD_CMD}\` then \`${TEST_CMD}\`. ` +
    `Green baseline: ${BASELINE}. Any failure not in that baseline is new and is yours. ` +
    `A wave of Inconclusive/skipped DB tests means the container runtime is down: report passed=false with that ` +
    `diagnosis rather than calling it green. ` +
    `Set passed=true only if the build succeeds and zero tests fail. List failures with fully-qualified names.`,
    { label: 'test:backend', phase: 'Test', schema: TEST_SCHEMA, effort: 'medium' }
  )
}
async function testWeb() {
  return agent(
    `Test the frontend at ${webDir}. If that directory does not exist, this repo has no frontend: return ` +
    `passed=true with summary "no frontend". Otherwise run in order: \`npm run check\` then \`npm run build\`. ` +
    `passed=true only if both are clean. List any failures.`,
    { label: 'test:web', phase: 'Test', schema: TEST_SCHEMA, effort: 'medium' }
  )
}

let round = 0
let beRes, webRes
while (true) {
  phase(round === 0 ? 'Test' : 'Fix')
  ;[beRes, webRes] = await parallel([testBackend, testWeb])
  beRes = beRes || { area: 'backend', passed: false, newFailures: ['test agent did not return'], summary: 'no result' }
  webRes = webRes || { area: 'web', passed: false, newFailures: ['test agent did not return'], summary: 'no result' }
  log(`Round ${round}: backend ${beRes.passed ? 'PASS' : 'FAIL'}, web ${webRes.passed ? 'PASS' : 'FAIL'}`)

  if (beRes.passed && webRes.passed) break
  if (round >= MAX_FIX_ROUNDS) {
    log(`Reached max fix rounds (${MAX_FIX_ROUNDS}) — stopping with failures remaining.`)
    break
  }
  round++

  const fixThunks = []
  if (!beRes.passed) fixThunks.push(() => agent(
    `The backend at ${repoDir} has failing checks. Build/test summary: ${beRes.summary}. ` +
    `New failures: ${(beRes.newFailures || []).join('; ') || 'see summary'}. ` +
    `Fix the code (and tests where the test is wrong — but never by weakening an assertion into something that ` +
    `passes regardless of behaviour) so \`${BUILD_CMD}\` and \`${TEST_CMD}\` pass with zero failures. ` +
    `Handler CONTRACT blocks in the code (and the plan at ${planPath}) state the INTENDED behaviour — when code ` +
    `and test disagree, fix toward the contract, never toward whatever the code currently does. ${HOUSE_RULES_HINT}`,
    { label: `fix:backend:r${round}`, phase: 'Fix', model: 'sonnet', effort: 'high' }))
  if (!webRes.passed) fixThunks.push(() => agent(
    `The frontend at ${webDir} has failing checks. Summary: ${webRes.summary}. ` +
    `Failures: ${(webRes.newFailures || []).join('; ') || 'see summary'}. ` +
    `Fix so \`npm run check\` and \`npm run build\` pass. ${HOUSE_RULES_HINT}`,
    { label: `fix:web:r${round}`, phase: 'Fix', model: 'sonnet', effort: 'high' }))
  await parallel(fixThunks)
}

return {
  decompose: { backendTasks: plan.backendTasks.length, webTasks: plan.webTasks.length, testPlan: plan.testPlan || '' },
  implement: impl.filter(Boolean),
  fixRounds: round,
  backend: beRes,
  web: webRes,
  green: beRes.passed && webRes.passed,
}
