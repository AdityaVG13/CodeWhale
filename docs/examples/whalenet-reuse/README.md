# A capability that survives its first task

Two real Codewhale tasks use DeepSeek, a TypeScript MCP server and Python. The
first task inspects build-duration fixtures, chooses a detector's sensitivity
and publishes an immutable analysis rule. Its processes exit. A fresh task
discovers the admitted rule by content hash and uses it on a later batch.

Python retains the training profile between calls in the first task. The later
task starts a new Python process and restores the saved rule, not Python memory
or conversation history. TypeScript handles the MCP contract, validation,
publication and expiry. Codewhale's existing Rust Engine owns model turns,
provider routing, tool admission, session capture and usage receipts.

This is the smallest runnable example of a useful result becoming a capability
for future work. The agent chooses the rule's parameters, name and rationale;
the operator supplies the permitted statistical operations and resource limits.
It does not install agent-written executable code or establish emergent
behavior. The data is synthetic; the API calls and computations are real.

## Run

Use macOS or Linux, Python 3.11+, Node.js 22.18+ and a current Codewhale binary
with `exec --allowed-tools`, `--max-turns` and stream JSON support. Install the
pinned demo dependencies:

```sh
cd docs/examples/whalenet-reuse
npm ci --ignore-scripts
npm run check
python3 run.py --binary /absolute/path/to/codewhale --output /absolute/path/to/new-receipt-directory
```

This makes paid DeepSeek API calls. Supply `DEEPSEEK_API_KEY` in the launching
environment, or explicitly add `--codewhale-secret-store` with the path to an
existing private Codewhale secret store. The runner reads that key into memory
and passes it only to Codewhale. It never writes the key to demo files. The
Engine sanitizes the MCP child environment; the server refuses to start if the
DeepSeek key reaches it. No existing account configuration is modified.

Each task has a fresh workspace and Codewhale state directory. It permits only
its two MCP tools and eagerly loads their schemas: an allowlist without
ToolSearch must not leave the permitted tools deferred. The creator uses the
workspace-write posture and the consumer read-only. No shell, file, subagent or
general network tool is admitted to either model.

The server is operator-authored local code running with the user's OS identity.
MCP processes are not made hostile-code sandboxes by the model's tool allowlist
or the CLI's shell sandbox. The server itself confines its domain writes to the
explicit output directory and exposes no arbitrary path, code or command input.
It writes audit logs there in both roles. Review this code before admitting it
to an account; it is not an automatically trusted extension or plugin.

## Read the result

`summary.json` names the binary and source hashes, both terminal receipts, the
capability hash and later measurements. `creator-stream.jsonl` and
`consumer-stream.jsonl` preserve actual model/tool events and session capture
IDs. The role-specific MCP logs record Node and Python PIDs, Python call
sequence numbers and capability publication/use. The capability is the JSON
file whose name is its SHA-256 digest.

A successful run verifies that the creator used one Python process across
multiple calls, both creator processes stopped, the consumer started a fresh
session and worker, and the consumer reused the same hash to flag the 142-second
compile and 280-second integration samples. The 60-second compile and
122-second integration samples remain below the selected thresholds. Failures
leave their receipts in place and do not trigger a paid retry.

Each task is limited to six model steps, two tool calls per step, 4,096 output
tokens per response and 180 seconds. The server admits twelve calls, gives
Python five seconds per operation, and expires after the shared one-hour lease.
Invalid parameters, missing training state, changed implementation hashes,
tampered capabilities and expired capabilities are refused. Consumer processes
do not register the publication tool. Cancellation closes the Python worker;
later calls require a new server process.

## Where WhaleNet fits

This demo uses local stdio. [Environment placement](../../ENVIRONMENTS.md#environment-aware-fleet-placement-preview)
selects where a Fleet task may execute; its Tailscale transport addresses an
explicitly enrolled peer by node identity. This example does not connect those
two paths into a distributed capability service. Cross-host discovery,
recipient consent, quotas and independent-owner isolation remain subsequent
work. ShannonNet is not a dependency.
