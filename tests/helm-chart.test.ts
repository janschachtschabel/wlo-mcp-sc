/**
 * helm-chart.test.ts – The draft chart must keep the properties the service
 * depends on (work package D13).
 *
 * The chart is YAML nobody runs in CI, written for a platform team that will
 * edit it. The things pinned here are the ones an edit breaks without anything
 * failing: a second replica (every approval, plan and rate budget lives in
 * process memory), a probe on `/ready` (takes the only pod out of service
 * because the REPOSITORY is down), a grace period shorter than the server's own
 * drain, a credential in `values.yaml`, and a setting the compose deployment
 * carries that the chart quietly cannot.
 *
 * Read as text on purpose: no `helm` binary and no YAML dependency. That proves
 * what the files SAY, not what a cluster does with them.
 *
 * Every check reads the files WITHOUT their comments (`values`, `tpl`): a
 * comment may name what the YAML must not do, and — the other direction — a
 * line that only survives inside a comment must not satisfy a check.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SHUTDOWN_GRACE_MS } from '../src/shutdown.js';

const root = new URL('../', import.meta.url);
const read = (name: string) => readFileSync(fileURLToPath(new URL(name, root)), 'utf8');

const CHART = 'deploy/helm/wlo-mcp/';
const chart = (name: string) => read(CHART + name);
const templateNames = readdirSync(fileURLToPath(new URL(`${CHART}templates/`, root)));
const templates = new Map(templateNames.map(n => [n, chart(`templates/${n}`)]));

/**
 * A YAML file without its comments: whole comment lines, and a trailing
 * ` # …` after a value. A `#` inside quotes or without a space before it is
 * content, not a comment.
 */
function withoutComments(text: string): string {
  return text.split(/\r?\n/)
    .filter(l => !/^\s*#/.test(l))
    .map((line) => {
      let quote = '';
      for (let i = 0; i < line.length; i++) {
        const c = line[i]!;
        if (quote) { if (c === quote) quote = ''; continue; }
        if (c === '"' || c === "'") quote = c;
        else if (c === '#' && /\s/.test(line[i - 1] ?? '')) return line.slice(0, i).trimEnd();
      }
      return line;
    })
    .join('\n');
}

/** values.yaml and one template, comment-free — what every check below reads. */
const values = withoutComments(chart('values.yaml'));
const tpl = (name: string): string => {
  const text = templates.get(name);
  assert.ok(text !== undefined, `templates/${name} is missing`);
  return withoutComments(text);
};

/** Names a variable must match to count as a credential, whatever list the chart keeps. */
const SECRET_LIKE = /PASSWORD|PRIVATE_KEY|API_KEY|TOKEN|SECRET|CLIENT_KEYS|SERVICE_USER/;

/** Words of a `define` block in _helpers.tpl. */
function helperList(name: string): string[] {
  const body = tpl('_helpers.tpl').match(new RegExp(`define "${name}" -\\}\\}\\s*([A-Z0-9_ ]+?)\\s*\\{\\{-? end`))?.[1];
  assert.ok(body, `_helpers.tpl must define ${name} as a list of variable names`);
  return body.trim().split(/\s+/);
}

/** Keys of the top-level `config:` map in values.yaml. */
function configKeys(): string[] {
  const lines = values.split('\n');
  const start = lines.findIndex(l => /^config:\s*$/.test(l));
  assert.notEqual(start, -1, 'values.yaml must have a config: map');
  const keys: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const key = line.match(/^ {2}([A-Z][A-Z0-9_]*):/)?.[1];
    if (key) keys.push(key);
  }
  return keys;
}

/** Variable names the compose service puts into the container (as in deploy-env-passthrough.test.ts). */
function composeVars(): string[] {
  const body = read('docker-compose.yml');
  const start = body.indexOf('environment:');
  assert.notEqual(start, -1, 'docker-compose.yml must declare an environment block');
  const names: string[] = [];
  for (const line of body.slice(start).split(/\r?\n/).slice(1)) {
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    const name = line.match(/^\s{6,}([A-Z][A-Z0-9_]*):/)?.[1];
    if (!name) break;
    names.push(name);
  }
  return names;
}

test('the chart runs exactly one replica and never two pods at once', () => {
  const deployment = tpl('deployment.yaml');
  assert.match(deployment, /^ {2}replicas: 1$/m, 'replicas must be the literal 1, not a value somebody can raise');
  assert.match(deployment, /^ {2}strategy:\n {4}type: Recreate$/m, 'RollingUpdate keeps two pods alive at once');
  assert.doesNotMatch(values, /^\s*replica(s|Count)\s*:/m, 'no value may offer a replica count');
});

test('there is no autoscaler', () => {
  for (const name of templates.keys()) {
    assert.doesNotMatch(tpl(name), /HorizontalPodAutoscaler|autoscaling\//, `${name} must not define an autoscaler`);
  }
  assert.doesNotMatch(values, /^\s*autoscaling\s*:/m);
});

test('both probes ask /health, liveness on the internal port and readiness on the public one', () => {
  const deployment = tpl('deployment.yaml');
  const probe = (kind: string) => deployment.match(new RegExp(`${kind}Probe:\\n\\s+httpGet:\\n\\s+path: (\\S+)\\n\\s+port: (\\S+)`));
  assert.deepEqual(probe('liveness')?.slice(1), ['/health', 'internal']);
  // The internal port keeps answering while the public listener drains — a
  // readiness probe there would keep traffic coming to a port that refuses it.
  assert.deepEqual(probe('readiness')?.slice(1), ['/health', 'http']);
  assert.equal(deployment.match(/Probe:/g)?.length, 2, 'a third probe needs its own decision about /ready');
});

test('nothing in templates/ probes or routes to /ready', () => {
  // /ready answers 503 while the REPOSITORY is unreachable: as a probe it takes
  // the only pod out of service for a fault that is not its own. Matched as a
  // `path:` — prose (NOTES, an alert's description) may name the endpoint.
  for (const name of templates.keys()) {
    assert.doesNotMatch(tpl(name), /path:\s*["']?\/ready\b/, `${name} must not use /ready as a path`);
  }
  const paths = [...tpl('deployment.yaml').matchAll(/^\s*path:\s*(\S+)/gm)].map(m => m[1]);
  assert.deepEqual(paths, ['/health', '/health']);
});

test('the pod gets longer to stop than the server takes to drain', () => {
  const seconds = Number(values.match(/^terminationGracePeriodSeconds:\s*(\d+)\s*$/m)?.[1]);
  assert.ok(Number.isFinite(seconds), 'values.yaml must set terminationGracePeriodSeconds');
  assert.ok(seconds * 1000 > SHUTDOWN_GRACE_MS,
    `${seconds}s must exceed SHUTDOWN_GRACE_MS (${SHUTDOWN_GRACE_MS} ms) or the kubelet kills a write the server is still waiting for`);
  const compose = Number(read('docker-compose.yml').match(/^\s*stop_grace_period:\s*(\d+)s/m)?.[1]);
  assert.ok(seconds >= compose, `not below the compose file's stop_grace_period (${compose}s)`);
  assert.match(tpl('deployment.yaml'), /terminationGracePeriodSeconds: \{\{ \.Values\.terminationGracePeriodSeconds \}\}/,
    'the deployment must actually use the value');
});

test('appVersion is the package version, and no image repository is preset', () => {
  const version = (JSON.parse(read('package.json')) as { version: string }).version;
  assert.equal(withoutComments(chart('Chart.yaml')).match(/^appVersion:\s*"?([^"\s]+)"?\s*$/m)?.[1], version);
  assert.match(values, /^image:\n\s+repository: ""$/m, 'no registry is decided — the repository has no default');
  assert.match(values, /^repositoryUrl: ""$/m, 'one MCP per repository — the address has no default');
});

test('no credential can be given in values.yaml or lands in the ConfigMap', () => {
  const secretKeys = helperList('wlo-mcp.secretKeys');
  for (const file of ['values.yaml', 'templates/configmap.yaml']) {
    const body = withoutComments(chart(file));
    for (const line of body.split('\n')) {
      const m = line.match(/^\s*([A-Z][A-Z0-9_]*):\s*(.*)$/);
      if (!m) continue;
      assert.ok(!SECRET_LIKE.test(m[1]!), `${file}: ${m[1]} is a credential and must come from existingSecret`);
      assert.ok(!secretKeys.includes(m[1]!), `${file}: ${m[1]} is in the chart's own secret list`);
    }
  }
  assert.match(values, /^existingSecret: ""$/m);
  for (const name of templates.keys()) {
    assert.doesNotMatch(tpl(name), /^kind:\s*Secret\s*$/m, `${name}: the chart must not create a Secret`);
  }
  // The guard that makes `--set config.METRICS_TOKEN=…` fail instead of render.
  assert.match(tpl('configmap.yaml'), /has \$name \$secret[\s\S]*?fail/);
});

test('every credential-like variable of the compose file comes from the existing Secret', () => {
  const secretKeys = helperList('wlo-mcp.secretKeys');
  const expected = composeVars().filter(n => SECRET_LIKE.test(n));
  assert.ok(expected.length >= 6, 'the compose file should name the six known credentials');
  assert.deepEqual([...secretKeys].sort(), [...expected].sort());
  assert.match(tpl('deployment.yaml'), /secretKeyRef:\n\s+name: \{\{ \$\.Values\.existingSecret/);
});

test('every variable docker-compose.yml passes to the container can be set through the chart', () => {
  const settable = new Set([
    ...configKeys(),
    ...helperList('wlo-mcp.secretKeys'),
    // Set by the chart itself in configmap.yaml — and really there, not only listed.
    ...helperList('wlo-mcp.fixedKeys').filter(n => new RegExp(`^ {2}${n}: `, 'm').test(tpl('configmap.yaml'))),
  ]);
  // The escape hatch: a row in the README's "Deliberately not in the chart" table.
  const omittedSection = chart('README.md').split(/^## /m).find(s => s.startsWith('Deliberately not in the chart')) ?? '';
  assert.ok(omittedSection, 'the chart README must keep its "Deliberately not in the chart" section');
  const omitted = new Set([...omittedSection.matchAll(/`([A-Z][A-Z0-9_]*)`/g)].map(m => m[1]!));

  const compose = composeVars();
  assert.ok(compose.length > 40, 'the compose list was not read');
  assert.deepEqual(
    compose.filter(n => !settable.has(n) && !omitted.has(n)),
    [],
    'passed by docker-compose.yml but neither settable through the chart nor listed in its README as left out',
  );
  // The other direction: a config key the server does not know is a typo that sets nothing.
  assert.deepEqual(configKeys().filter(n => !compose.includes(n)), [], 'config keys docker-compose.yml does not know');
});

test('the internal port is set, has its own ClusterIP service and stays off the Ingress', () => {
  assert.match(tpl('configmap.yaml'), /^ {2}INTERNAL_PORT: \{\{ \.Values\.service\.internal\.port/m);
  const services = tpl('service.yaml').split(/^---$/m);
  assert.equal(services.length, 2, 'one public and one internal service');
  assert.match(services[1]!, /type: ClusterIP[\s\S]*targetPort: internal/);
  const ingress = tpl('ingress.yaml');
  assert.doesNotMatch(ingress, /internal/i, 'the Ingress must not reference the internal service or port');
});

test('the container is hardened like the compose service', () => {
  // Dockerfile: USER node (uid 1000). compose: read_only, no-new-privileges, cap_drop ALL, tmpfs /tmp, volume /data.
  assert.match(read('Dockerfile'), /^USER node$/m);
  for (const line of ['runAsNonRoot: true', 'runAsUser: 1000', 'allowPrivilegeEscalation: false', 'readOnlyRootFilesystem: true', 'drop: ["ALL"]']) {
    assert.ok(values.split('\n').some(l => l.trim() === line), `values.yaml must keep "${line}" as a setting, not in a comment`);
  }
  const deployment = tpl('deployment.yaml');
  assert.match(deployment, /mountPath: \/tmp/);
  assert.match(values, /accessMode: ReadWriteOnce/);
});

test('the registry file lies in the directory the claim is mounted at', () => {
  // The access registry is the one file on disk. A mount at another path than
  // the file's directory leaves it on the read-only root filesystem (the server
  // then cannot write it) — or, were that writable, in the container layer,
  // gone with every restart.
  const registryPath = tpl('configmap.yaml').match(/^ {2}WLO_AUTH_REGISTRY_PATH: "([^"]+)"$/m)?.[1];
  assert.ok(registryPath, 'configmap.yaml must set WLO_AUTH_REGISTRY_PATH to a literal path');
  const deployment = tpl('deployment.yaml');
  const mounts = new Map([...deployment.matchAll(/- name: (\S+)\n\s+mountPath: (\S+)/g)].map(m => [m[2]!, m[1]!]));
  const volume = mounts.get(posix.dirname(registryPath));
  assert.ok(volume, `no volume is mounted at ${posix.dirname(registryPath)} (mounts: ${[...mounts.keys()].join(', ')})`);
  // …and that volume is the one backed by the claim.
  assert.match(deployment, new RegExp(`- name: ${volume}\\n(?:\\s+\\{\\{.*\\n)*\\s+persistentVolumeClaim:`),
    `the volume "${volume}" must be the PersistentVolumeClaim`);
});

test('the NetworkPolicy is off by default and does not guess a namespace', () => {
  // It admits traffic by namespace NAME. A guessed name cuts the ingress and
  // the scrape silently, so: off, no default, and a render that fails without both.
  const block = values.match(/^networkPolicy:\n((?: {2}.*\n)+)/m)?.[1];
  assert.ok(block, 'values.yaml must have a networkPolicy: map');
  assert.match(block, /^ {2}enabled: false$/m, 'the NetworkPolicy must be off by default');
  assert.match(block, /^ {2}ingressNamespace: ""$/m, 'no guessed ingress namespace');
  assert.match(block, /^ {2}monitoringNamespace: ""$/m, 'no guessed monitoring namespace');
  const policy = tpl('networkpolicy.yaml');
  assert.match(policy, /^\{\{- if \.Values\.networkPolicy\.enabled \}\}/, 'the whole template hangs on the switch');
  for (const name of ['ingressNamespace', 'monitoringNamespace']) {
    assert.match(policy, new RegExp(`required "[^"]*" \\.Values\\.networkPolicy\\.${name} `), `${name} must be required when enabled`);
    // Used only through the checked variable — a direct read would bypass `required`.
    assert.equal(policy.split(`.Values.networkPolicy.${name}`).length - 1, 1, `${name} is read once, by \`required\``);
  }
  assert.match(block, /httpsCIDRs: \["0\.0\.0\.0\/0", "::\/0"\]/, 'egress default covers both address families');
});

test('alert rules use only metrics the server exports', () => {
  const exported = new Set<string>(['up']);
  for (const file of ['src/metrics.ts', 'src/rest/metrics-route.ts']) {
    for (const m of read(file).matchAll(/\b((?:wlo|process|nodejs)_[a-z0-9_]+)\b/g)) exported.add(m[1]!);
  }
  const rules = tpl('prometheusrule.yaml');
  const used = [...rules.matchAll(/\b((?:wlo|process|nodejs|kube|container)_[a-z0-9_]+?)(?:_bucket)?\s*\{/g)].map(m => m[1]!);
  assert.ok(used.length >= 8, 'the rules were not read');
  assert.deepEqual(used.filter(n => !exported.has(n)), [], 'an alert on a series nobody exports never fires');
});

/**
 * The label values an alert expression asks for: `label="a"`, `label=~"a|b"`,
 * `label!="a"`, `label!~"a|b"` on one metric, alternatives split.
 */
function matcherValues(rules: string, metric: string, label: string): string[] {
  // The Helm selector include carries braces of its own.
  const flat = rules.replace(/\{\{-? *\$sel *-?\}\}/g, 'SEL');
  const out: string[] = [];
  for (const sel of flat.matchAll(new RegExp(`\\b${metric}(?:_bucket)?\\s*\\{([^}]*)\\}`, 'g'))) {
    for (const m of sel[1]!.matchAll(new RegExp(`\\b${label}\\s*(?:=~|!~|!=|=)\\s*"([^"]*)"`, 'g'))) out.push(...m[1]!.split('|'));
  }
  return out;
}

test('alert rules name only label values the source emits', () => {
  // A matcher on a value nobody emits selects nothing: the alert never fires,
  // or — on the excluding side — excludes nothing.
  const rules = tpl('prometheusrule.yaml');

  // wlo_tool_calls_total{outcome}: the three literals in the one seam (src/apps/register.ts).
  const register = read('src/apps/register.ts');
  const seam = register.slice(register.indexOf("let outcome = '"), register.indexOf("count('wlo_tool_calls_total'"));
  const toolOutcomes = new Set([...seam.matchAll(/'([a-z]+)'/g)].map(m => m[1]!));
  assert.deepEqual([...toolOutcomes].sort(), ['error', 'ok', 'thrown'], 'the tool outcomes were not read from register.ts');

  // wlo_upstream_requests_total{outcome}: the literals wlo-fetch.ts counts, plus the status classes it builds.
  const wloFetch = read('src/wlo-fetch.ts');
  const upstreamOutcomes = new Set<string>();
  for (const m of wloFetch.matchAll(/outcome: '([a-z]+)'/g)) upstreamOutcomes.add(m[1]!);
  for (const m of wloFetch.matchAll(/\btimed\(([^,]*),/g)) for (const lit of m[1]!.matchAll(/'([a-z]+)'/g)) upstreamOutcomes.add(lit[1]!);
  assert.match(wloFetch, /timed\(`\$\{Math\.floor\(res\.status \/ 100\)\}xx`/, 'wlo-fetch.ts no longer counts by status class');
  for (const cls of ['1xx', '2xx', '3xx', '4xx', '5xx']) upstreamOutcomes.add(cls);
  for (const expected of ['shed', 'error', 'cancelled']) assert.ok(upstreamOutcomes.has(expected), `"${expected}" was not read from wlo-fetch.ts`);

  // wlo_http_*{route}: what routeClass returns (src/http-app.ts).
  const app = read('src/http-app.ts');
  const start = app.indexOf('export function routeClass(');
  assert.notEqual(start, -1, 'http-app.ts has no routeClass');
  const routes = new Set([...app.slice(start, app.indexOf('\n}', start)).matchAll(/return '([a-z]+)'/g)].map(m => m[1]!));
  assert.ok(routes.has('ready') && routes.has('mcp') && routes.size >= 6, 'the route classes were not read');

  const check = (metric: string, label: string, emitted: Set<string>, atLeast: number) => {
    const asked = matcherValues(rules, metric, label);
    assert.ok(asked.length >= atLeast, `${metric}{${label}}: only ${asked.length} matcher values were read`);
    assert.deepEqual(asked.filter(v => !emitted.has(v)), [], `${metric}{${label}=…} names a value the source never emits`);
  };
  check('wlo_tool_calls_total', 'outcome', toolOutcomes, 3);
  check('wlo_upstream_requests_total', 'outcome', upstreamOutcomes, 4);
  check('wlo_http_requests_total', 'route', routes, 2);
  check('wlo_http_request_duration_seconds', 'route', routes, 1);

  // The 5xx alert must not fire for the repository's state: /ready answers 503 by design.
  const serverErrors = rules.slice(rules.indexOf('alert: WloMcpServerErrors'), rules.indexOf('alert: WloMcpSlowRequests'));
  assert.match(serverErrors, /route!~"[^"]*\bready\b[^"]*"/, 'WloMcpServerErrors must exclude route="ready"');
});

test('the memory alert is 85 % of the memory limit', () => {
  const limit = values.match(/^resources:\n(?: {2}.*\n)*? {2}limits:\n(?: {4}.*\n)*? {4}memory: (\d+)Mi$/m)?.[1];
  assert.ok(limit, 'values.yaml must set resources.limits.memory in Mi');
  const threshold = values.match(/^ {6}memoryBytes: "(\d+)"$/m)?.[1];
  assert.equal(Number(threshold), Math.floor(Number(limit) * 1024 * 1024 * 0.85));
});
