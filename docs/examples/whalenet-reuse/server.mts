import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, constants, openSync, closeSync, readFileSync, fstatSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const here = dirname(fileURLToPath(import.meta.url));
const role = z.enum(['creator', 'consumer']).parse(process.env.WHALENET_ROLE);
const directory = resolve(z.string().min(1).parse(process.env.WHALENET_DIRECTORY));
const expires = z.coerce.number().int().positive().parse(process.env.WHALENET_EXPIRES_AT);
const expected = role === 'consumer' ? z.string().regex(/^[a-f0-9]{64}$/).parse(process.env.WHALENET_CAPABILITY) : null;
const instance = randomUUID();
const digest = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const workerDigest = digest(readFileSync(join(here, 'worker.py')));
const serverDigest = digest(readFileSync(fileURLToPath(import.meta.url)));
const log = (event: Record<string, unknown>) => appendFileSync(join(directory, `${role}.jsonl`), JSON.stringify({at: new Date().toISOString(), role, instance, node_pid: process.pid, ...event}) + '\n', {mode: 0o600});

if (process.env.DEEPSEEK_API_KEY) throw new Error('Provider credentials must not enter the MCP process');
const python = spawn(process.env.WHALENET_PYTHON ?? 'python3', ['-I', '-u', join(here, 'worker.py')], {
  cwd: directory, env: {PATH: process.env.PATH ?? '/usr/bin:/bin', PYTHONIOENCODING: 'utf-8'}, stdio: ['pipe', 'pipe', 'pipe'],
});
type Reply = {id: number; result?: Record<string, unknown>; error?: string; python_pid: number; sequence: number};
let pending: {id: number; resolve: (value: Reply) => void; reject: (error: Error) => void} | null = null;
let sequence = 0;
let closed = false;
let busy = false;
let calls = 0;
let trainingHash: string | null = null;
function failWorker(message: string) {
  closed = true;
  pending?.reject(new Error(message));
  python.kill('SIGTERM');
}
const lines = createInterface({input: python.stdout});
lines.on('line', line => {
  try {
    if (line.length > 65536) throw new Error('Python response exceeds limit');
    const response = JSON.parse(line) as Reply;
    if (!pending || response.id !== pending.id) throw new Error('Python response sequence mismatch');
    pending.resolve(response);
  } catch {
    failWorker('Invalid Python response');
  }
});
python.stderr.on('data', () => log({event: 'python_stderr'}));
python.stdin.on('error', () => failWorker('Python input pipe closed'));
python.on('error', () => failWorker('Python worker failed to start'));
python.on('exit', (code, signal) => {
  closed = true;
  log({event: 'python_exit', python_pid: python.pid, code, signal});
  pending?.reject(new Error('Python worker exited'));
});
log({event: 'start', python_pid: python.pid, worker_sha256: workerDigest, server_sha256: serverDigest, expires_at: expires});

function checkGrant() {
  if (Date.now() >= expires) throw new Error('Capability lease expired');
  if (closed) throw new Error('Python worker is closed');
  if (calls >= 12) throw new Error('This task exhausted its 12-call allowance');
  if (busy) throw new Error('Wait for the current tool call to finish');
}

async function pythonCall(operation: string, input: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
  if (signal.aborted) throw new Error('Tool call cancelled');
  const id = ++sequence;
  let timer: NodeJS.Timeout;
  const abort = () => failWorker('Tool call cancelled');
  const response = await new Promise<Reply>((resolveReply, reject) => {
    pending = {id, resolve: resolveReply, reject};
    timer = setTimeout(() => failWorker('Python call exceeded five seconds'), 5000);
    signal.addEventListener('abort', abort, {once: true});
    python.stdin.write(JSON.stringify({id, operation, ...input}) + '\n');
  }).finally(() => {clearTimeout(timer!); signal.removeEventListener('abort', abort); pending = null;});
  if (response.error || !response.result) throw new Error(response.error ?? 'Missing Python result');
  log({event: 'python_result', operation, python_pid: response.python_pid, sequence: response.sequence});
  return {...response.result, python_pid: response.python_pid, sequence: response.sequence};
}

function readBounded(path: string) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 65536) throw new Error('Expected a regular file smaller than 64 KiB');
    return readFileSync(fd);
  } finally { closeSync(fd); }
}

const capabilitySchema = z.object({
  version: z.literal(1), kind: z.literal('duration_regression'), name: z.string().min(1).max(80),
  rationale: z.string().min(1).max(800), owner: z.literal('demo-creator'),
  expires_at: z.number().int().positive(), training_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  worker_sha256: z.string(), server_sha256: z.string(),
  parameters: z.object({mad_multiplier: z.number().min(3).max(8), minimum_regression: z.number().min(0.1).max(0.5)}).strict(),
  rules: z.record(z.string().min(1).max(80), z.object({baseline_seconds: z.number().positive().max(86400), threshold_seconds: z.number().positive().max(1000000)}).strict()),
}).strict();

function loadCapability() {
  if (!expected) throw new Error('This task has no admitted capability hash');
  const raw = readBounded(join(directory, `${expected}.json`));
  if (digest(raw) !== expected) throw new Error('Capability hash mismatch');
  const capability = capabilitySchema.parse(JSON.parse(raw.toString('utf8')));
  if (capability.expires_at <= Date.now()) throw new Error('Saved capability expired');
  if (capability.worker_sha256 !== workerDigest || capability.server_sha256 !== serverDigest) throw new Error('Capability implementation changed; review it again');
  return capability;
}

const server = new McpServer({name: 'whalenet-reuse-mcp-server', version: '0.1.0'});
async function execute(name: string, action: () => Promise<Record<string, unknown>>) {
  let acquired = false;
  try {
    checkGrant();
    calls += 1;
    busy = true;
    acquired = true;
    const result = await action();
    if (Date.now() >= expires) throw new Error('Capability lease expired during execution');
    log({event: 'tool_result', tool: name, result});
    return {content: [{type: 'text' as const, text: JSON.stringify(result)}], structuredContent: result};
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Tool failed';
    log({event: 'tool_error', tool: name, message});
    return {isError: true, content: [{type: 'text' as const, text: message}]};
  } finally { if (acquired) busy = false; }
}
const annotations = {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false};

if (role === 'creator') {
  server.registerTool('profile_training', {description: 'Use the persistent Python worker to summarize fixture build durations by job. Inspect before publishing a reusable detector.', inputSchema: z.object({}).strict(), annotations},
    async (_args, extra) => execute('profile_training', async () => {
      const raw = readBounded(join(here, 'training.json'));
      trainingHash = digest(raw);
      return {...await pythonCall('profile', {rows: JSON.parse(raw.toString('utf8'))}, extra.mcpReq.signal), training_sha256: trainingHash};
    }));
  server.registerTool('publish_detector', {
    description: 'Create an immutable, leased duration-regression capability for a later task. Python fits per-job thresholds from the previously inspected training state. Choose the rule name, sensitivity, and rationale.',
    inputSchema: z.object({name: z.string().min(1).max(80), rationale: z.string().min(1).max(800), mad_multiplier: z.number().min(3).max(8), minimum_regression: z.number().min(0.1).max(0.5)}).strict(),
    annotations: {...annotations, readOnlyHint: false, idempotentHint: false},
  }, async (args, extra) => execute('publish_detector', async () => {
    if (!trainingHash) throw new Error('Call profile_training first');
    const result = await pythonCall('fit', args, extra.mcpReq.signal);
    const capability = capabilitySchema.parse({version: 1, kind: 'duration_regression', name: args.name, rationale: args.rationale,
      owner: 'demo-creator', expires_at: expires, training_sha256: trainingHash, worker_sha256: workerDigest, server_sha256: serverDigest,
      parameters: {mad_multiplier: args.mad_multiplier, minimum_regression: args.minimum_regression}, rules: result.rules});
    if (extra.mcpReq.signal.aborted || Date.now() >= expires) throw new Error('Publication cancelled or lease expired');
    const raw = JSON.stringify(capability, null, 2) + '\n';
    const hash = digest(raw);
    writeFileSync(join(directory, `${hash}.json`), raw, {flag: 'wx', mode: 0o600});
    return {capability_sha256: hash, capability, python_pid: result.python_pid, sequence: result.sequence};
  }));
} else {
  server.registerTool('discover_capability', {description: 'Discover the single capability admitted to this later task. Validates its content hash, implementation hashes and expiry.', inputSchema: z.object({}).strict(), annotations},
    async () => execute('discover_capability', async () => ({capability_sha256: expected, capability: loadCapability()})));
  server.registerTool('apply_detector', {description: 'Apply the admitted capability to the held-out later build batch using a fresh Python worker. Returns measured durations, thresholds and regression decisions.', inputSchema: z.object({}).strict(), annotations},
    async (_args, extra) => execute('apply_detector', async () => {
      const capability = loadCapability();
      const raw = readBounded(join(here, 'later.json'));
      return {...await pythonCall('score', {rules: capability.rules, rows: JSON.parse(raw.toString('utf8'))}, extra.mcpReq.signal), capability_sha256: expected, input_sha256: digest(raw)};
    }));
}

const shutdown = () => {closed = true; python.stdin.end(); python.kill('SIGTERM'); setTimeout(() => python.kill('SIGKILL'), 1000).unref();};
process.on('SIGTERM', () => {shutdown(); void server.close();});
process.on('SIGINT', () => {shutdown(); void server.close();});
process.stdin.on('end', shutdown);
const leaseTimer = setTimeout(() => {log({event: 'lease_expired'}); shutdown(); void server.close();}, Math.max(0, Math.min(expires - Date.now(), 3600000)));
leaseTimer.unref();
await server.connect(new StdioServerTransport(process.stdin, process.stdout, {maxBufferSize: 65536}));
