import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent


def sha(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def rows(path):
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def credential(args):
    key = os.environ.get('DEEPSEEK_API_KEY', '').strip()
    if not key and args.codewhale_secret_store:
        path = args.codewhale_secret_store.resolve()
        if path.stat().st_mode & 0o077:
            raise RuntimeError('Credential store must be private (0600)')
        key = json.loads(path.read_text())['entries']['deepseek'].strip()
    if not key:
        raise RuntimeError('Set DEEPSEEK_API_KEY or pass --codewhale-secret-store explicitly')
    return key


def task(args, role, capability, key, expires):
    directory = args.output
    state = directory / f'{role}-state'
    workspace = directory / f'{role}-workspace'
    state.mkdir(mode=0o700)
    workspace.mkdir(mode=0o700)
    runtime = directory / 'runtime'
    runtime.mkdir(exist_ok=True)
    mcp = state / 'mcp.json'
    tools = ['profile_training', 'publish_detector'] if role == 'creator' else ['discover_capability', 'apply_detector']
    mcp.write_text(json.dumps({'servers': {'whalenet': {
        'command': shutil.which('node'), 'args': [str(HERE / 'server.mts')], 'cwd': str(workspace),
        'env': {'WHALENET_ROLE': role, 'WHALENET_DIRECTORY': str(directory), 'WHALENET_EXPIRES_AT': str(expires),
                'WHALENET_PYTHON': sys.executable, **({'WHALENET_CAPABILITY': capability} if capability else {})},
        'disabled': False, 'connect_timeout': 10, 'execute_timeout': 10,
    }}}, indent=2) + '\n')
    config = state / 'config.toml'
    config.write_text('telemetry = false\nprovider = "deepseek"\nmodel = "deepseek-flash"\n'
                      'reasoning_effort = "off"\n'
                      '[providers.deepseek]\nbase_url = "https://api.deepseek.com"\n'
                      '[tools]\nalways_load = ' + json.dumps(['mcp_whalenet_' + tool for tool in tools]) + '\n'
                      '[retry]\nenabled = false\nmax_retries = 0\n'
                      '[stream_recovery]\nmax_resumes = 0\nmax_transparent_retries = 0\n')
    prompt = workspace / 'task.txt'
    if role == 'creator':
        text = ('Create a reusable detector for unusually slow build jobs from the supplied historical fixture. '
                'Use your admitted MCP tools to inspect the training profile, then choose and publish one sensible '
                'robust duration-regression capability. Choose its name, sensitivity and rationale yourself. '
                'Avoid fitting to individual noisy measurements. A later independent task must be able to apply '
                'the saved rule without your conversation or live Python state. Only the listed tools are admitted. '
                'Do not use shell, files, network, subagents or external coordination. Finish with the actual '
                'capability hash, thresholds and brief rationale from the tool result; do not invent results.')
    else:
        text = ('A previous task left a duration-regression capability admitted to this task. Discover it and '
                'apply it to the later held-out build batch using your MCP tools. Report which measurements '
                'exceed their saved thresholds and cite the capability hash. You have no access to the previous '
                'conversation and cannot publish or modify capabilities. Only the listed tools are admitted. '
                'Do not use shell, files, network, subagents or external coordination. Use actual tool results.')
    prompt.write_text(text + '\n')
    env = {name: os.environ[name] for name in ('PATH', 'SYSTEMROOT') if name in os.environ}
    env.update({'CODEWHALE_HOME': str(state), 'CODEWHALE_CONFIG_PATH': str(config),
                'CODEWHALE_MCP_CONFIG': str(mcp), 'CODEWHALE_RUNTIME_DIR': str(runtime),
                'CODEWHALE_MAX_OUTPUT_TOKENS': '4096', 'DEEPSEEK_API_KEY': key, 'NO_COLOR': '1', 'TERM': 'dumb'})
    command = [str(args.binary), 'exec', '--provider', 'deepseek', '--model', 'deepseek-flash',
               '--reasoning-effort', 'off', '--auto', '--sandbox', 'workspace-write' if role == 'creator' else 'read-only',
               '--allowed-tools', ','.join('mcp_whalenet_' + tool for tool in tools),
               '--max-turns', '6', '--max-tool-calls', '2', '--output-format', 'stream-json', '--prompt-file', str(prompt)]
    (directory / f'{role}-launch.json').write_text(json.dumps({'command': command, 'workspace': str(workspace),
        'config_sha256': sha(config), 'mcp_config_sha256': sha(mcp), 'prompt_sha256': sha(prompt),
        'max_seconds': 180, 'max_turns': 6, 'max_calls_per_turn': 2, 'max_output_tokens_per_call': 4096}, indent=2) + '\n')
    print(f'Starting real DeepSeek {role} task', flush=True)
    started = time.monotonic()
    with (directory / f'{role}-stream.jsonl').open('w') as stdout, (directory / f'{role}-stderr.log').open('w') as stderr:
        process = subprocess.Popen(command, cwd=workspace, env=env, stdout=stdout, stderr=stderr, start_new_session=True)
        try:
            code = process.wait(timeout=180)
        except BaseException:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            raise
    stream = []
    for line in (directory / f'{role}-stream.jsonl').read_text().splitlines():
        try:
            stream.append(json.loads(line))
        except ValueError:
            pass
    terminal = [event['meta'] for event in stream if event.get('type') == 'metadata' and event.get('meta', {}).get('receipt_kind') == 'terminal']
    receipt = {'role': role, 'exit_code': code, 'duration_seconds': round(time.monotonic() - started, 2), 'terminal': terminal}
    (directory / f'{role}-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    if code != 0 or len(terminal) != 1 or terminal[0].get('provider') != 'deepseek':
        raise RuntimeError(f'{role} did not return one successful DeepSeek terminal receipt; inspect retained logs')
    events = rows(directory / f'{role}.jsonl')
    starts = [event for event in events if event['event'] == 'start']
    if len(starts) != 1:
        raise RuntimeError(f'{role} did not use exactly one TypeScript/Python worker')
    for field in ('node_pid', 'python_pid'):
        pid = starts[0][field]
        for _ in range(30):
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                break
            time.sleep(0.1)
        else:
            raise RuntimeError(f'{role} {field} remained alive after task completion')
    return terminal[0], events


def main():
    parser = argparse.ArgumentParser(description='Run two real DeepSeek Codewhale tasks with Python, TypeScript, MCP and durable reuse.')
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--codewhale-secret-store', type=Path)
    args = parser.parse_args()
    args.binary = args.binary.resolve(strict=True)
    args.output = args.output.resolve()
    if shutil.which('node') is None or not (HERE / 'node_modules/@modelcontextprotocol/server').is_dir():
        raise RuntimeError('Install Node.js 22.18+ and run npm ci --ignore-scripts in the demo directory')
    key = credential(args)
    args.output.mkdir(parents=True, exist_ok=False, mode=0o700)
    sources = {path.name: sha(path) for path in HERE.iterdir() if path.is_file()}
    summary = {'status': 'in_progress', 'binary': str(args.binary), 'binary_sha256': sha(args.binary), 'source_hashes': sources}
    summary_path = args.output / 'summary.json'
    summary_path.write_text(json.dumps(summary, indent=2) + '\n')
    try:
        expires = int(time.time() * 1000) + 3600000
        creator, creation = task(args, 'creator', None, key, expires)
        published = [e['result'] for e in creation if e['event'] == 'tool_result' and e['tool'] == 'publish_detector']
        if len(published) != 1:
            raise RuntimeError('Creator did not publish exactly one capability')
        capability = published[0]['capability_sha256']
        if sha(args.output / f'{capability}.json') != capability:
            raise RuntimeError('Published capability digest mismatch')
        summary.update({'capability_sha256': capability, 'creator': creator})
        summary_path.write_text(json.dumps(summary, indent=2) + '\n')
        consumer, consumption = task(args, 'consumer', capability, key, expires)
        applied = [e['result'] for e in consumption if e['event'] == 'tool_result' and e['tool'] == 'apply_detector']
        if len(applied) != 1 or applied[0]['capability_sha256'] != capability:
            raise RuntimeError('Later task did not reuse the admitted capability')
        fitted = [e for e in creation if e['event'] == 'python_result']
        scored = [e for e in consumption if e['event'] == 'python_result']
        if len(fitted) < 2 or fitted[0]['python_pid'] != fitted[1]['python_pid'] or fitted[1]['sequence'] <= fitted[0]['sequence']:
            raise RuntimeError('Creator did not retain Python state across calls')
        if not scored or scored[0]['python_pid'] == fitted[0]['python_pid'] or consumer.get('session_id') == creator.get('session_id'):
            raise RuntimeError('Later task was not a fresh Codewhale session and Python worker')
        if [row['regression'] for row in applied[0]['results']] != [False, True, False, True]:
            raise RuntimeError('Saved detector did not identify the held-out regressions')
        if any(sha(HERE / name) != value for name, value in sources.items()):
            raise RuntimeError('Demo source changed during execution')
        summary.update({'status': 'passed', 'consumer': consumer, 'later_results': applied[0],
                        'persistent_python_within_first_task': True, 'fresh_worker_for_later_task': True,
                        'children_stopped_between_tasks': True, 'fixture_data': True, 'transport': 'local_stdio'})
    except BaseException as error:
        summary.update({'status': 'failed', 'error_type': type(error).__name__, 'error': str(error)})
        raise
    finally:
        summary_path.write_text(json.dumps(summary, indent=2) + '\n')
        print(f'Receipt: {summary_path}', flush=True)


if __name__ == '__main__':
    main()
