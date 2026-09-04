var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// node_modules/unenv/dist/runtime/_internal/utils.mjs
// @__NO_SIDE_EFFECTS__
function createNotImplementedError(name) {
  return new Error(`[unenv] ${name} is not implemented yet!`);
}
__name(createNotImplementedError, "createNotImplementedError");
// @__NO_SIDE_EFFECTS__
function notImplemented(name) {
  const fn = /* @__PURE__ */ __name(() => {
    throw /* @__PURE__ */ createNotImplementedError(name);
  }, "fn");
  return Object.assign(fn, { __unenv__: true });
}
__name(notImplemented, "notImplemented");
// @__NO_SIDE_EFFECTS__
function notImplementedClass(name) {
  return class {
    __unenv__ = true;
    constructor() {
      throw new Error(`[unenv] ${name} is not implemented yet!`);
    }
  };
}
__name(notImplementedClass, "notImplementedClass");

// node_modules/unenv/dist/runtime/node/internal/perf_hooks/performance.mjs
var _timeOrigin = globalThis.performance?.timeOrigin ?? Date.now();
var _performanceNow = globalThis.performance?.now ? globalThis.performance.now.bind(globalThis.performance) : () => Date.now() - _timeOrigin;
var nodeTiming = {
  name: "node",
  entryType: "node",
  startTime: 0,
  duration: 0,
  nodeStart: 0,
  v8Start: 0,
  bootstrapComplete: 0,
  environment: 0,
  loopStart: 0,
  loopExit: 0,
  idleTime: 0,
  uvMetricsInfo: {
    loopCount: 0,
    events: 0,
    eventsWaiting: 0
  },
  detail: void 0,
  toJSON() {
    return this;
  }
};
var PerformanceEntry = class {
  static {
    __name(this, "PerformanceEntry");
  }
  __unenv__ = true;
  detail;
  entryType = "event";
  name;
  startTime;
  constructor(name, options) {
    this.name = name;
    this.startTime = options?.startTime || _performanceNow();
    this.detail = options?.detail;
  }
  get duration() {
    return _performanceNow() - this.startTime;
  }
  toJSON() {
    return {
      name: this.name,
      entryType: this.entryType,
      startTime: this.startTime,
      duration: this.duration,
      detail: this.detail
    };
  }
};
var PerformanceMark = class PerformanceMark2 extends PerformanceEntry {
  static {
    __name(this, "PerformanceMark");
  }
  entryType = "mark";
  constructor() {
    super(...arguments);
  }
  get duration() {
    return 0;
  }
};
var PerformanceMeasure = class extends PerformanceEntry {
  static {
    __name(this, "PerformanceMeasure");
  }
  entryType = "measure";
};
var PerformanceResourceTiming = class extends PerformanceEntry {
  static {
    __name(this, "PerformanceResourceTiming");
  }
  entryType = "resource";
  serverTiming = [];
  connectEnd = 0;
  connectStart = 0;
  decodedBodySize = 0;
  domainLookupEnd = 0;
  domainLookupStart = 0;
  encodedBodySize = 0;
  fetchStart = 0;
  initiatorType = "";
  name = "";
  nextHopProtocol = "";
  redirectEnd = 0;
  redirectStart = 0;
  requestStart = 0;
  responseEnd = 0;
  responseStart = 0;
  secureConnectionStart = 0;
  startTime = 0;
  transferSize = 0;
  workerStart = 0;
  responseStatus = 0;
};
var PerformanceObserverEntryList = class {
  static {
    __name(this, "PerformanceObserverEntryList");
  }
  __unenv__ = true;
  getEntries() {
    return [];
  }
  getEntriesByName(_name, _type) {
    return [];
  }
  getEntriesByType(type) {
    return [];
  }
};
var Performance = class {
  static {
    __name(this, "Performance");
  }
  __unenv__ = true;
  timeOrigin = _timeOrigin;
  eventCounts = /* @__PURE__ */ new Map();
  _entries = [];
  _resourceTimingBufferSize = 0;
  navigation = void 0;
  timing = void 0;
  timerify(_fn, _options) {
    throw createNotImplementedError("Performance.timerify");
  }
  get nodeTiming() {
    return nodeTiming;
  }
  eventLoopUtilization() {
    return {};
  }
  markResourceTiming() {
    return new PerformanceResourceTiming("");
  }
  onresourcetimingbufferfull = null;
  now() {
    if (this.timeOrigin === _timeOrigin) {
      return _performanceNow();
    }
    return Date.now() - this.timeOrigin;
  }
  clearMarks(markName) {
    this._entries = markName ? this._entries.filter((e) => e.name !== markName) : this._entries.filter((e) => e.entryType !== "mark");
  }
  clearMeasures(measureName) {
    this._entries = measureName ? this._entries.filter((e) => e.name !== measureName) : this._entries.filter((e) => e.entryType !== "measure");
  }
  clearResourceTimings() {
    this._entries = this._entries.filter((e) => e.entryType !== "resource" || e.entryType !== "navigation");
  }
  getEntries() {
    return this._entries;
  }
  getEntriesByName(name, type) {
    return this._entries.filter((e) => e.name === name && (!type || e.entryType === type));
  }
  getEntriesByType(type) {
    return this._entries.filter((e) => e.entryType === type);
  }
  mark(name, options) {
    const entry = new PerformanceMark(name, options);
    this._entries.push(entry);
    return entry;
  }
  measure(measureName, startOrMeasureOptions, endMark) {
    let start;
    let end;
    if (typeof startOrMeasureOptions === "string") {
      start = this.getEntriesByName(startOrMeasureOptions, "mark")[0]?.startTime;
      end = this.getEntriesByName(endMark, "mark")[0]?.startTime;
    } else {
      start = Number.parseFloat(startOrMeasureOptions?.start) || this.now();
      end = Number.parseFloat(startOrMeasureOptions?.end) || this.now();
    }
    const entry = new PerformanceMeasure(measureName, {
      startTime: start,
      detail: {
        start,
        end
      }
    });
    this._entries.push(entry);
    return entry;
  }
  setResourceTimingBufferSize(maxSize) {
    this._resourceTimingBufferSize = maxSize;
  }
  addEventListener(type, listener, options) {
    throw createNotImplementedError("Performance.addEventListener");
  }
  removeEventListener(type, listener, options) {
    throw createNotImplementedError("Performance.removeEventListener");
  }
  dispatchEvent(event) {
    throw createNotImplementedError("Performance.dispatchEvent");
  }
  toJSON() {
    return this;
  }
};
var PerformanceObserver = class {
  static {
    __name(this, "PerformanceObserver");
  }
  __unenv__ = true;
  static supportedEntryTypes = [];
  _callback = null;
  constructor(callback) {
    this._callback = callback;
  }
  takeRecords() {
    return [];
  }
  disconnect() {
    throw createNotImplementedError("PerformanceObserver.disconnect");
  }
  observe(options) {
    throw createNotImplementedError("PerformanceObserver.observe");
  }
  bind(fn) {
    return fn;
  }
  runInAsyncScope(fn, thisArg, ...args) {
    return fn.call(thisArg, ...args);
  }
  asyncId() {
    return 0;
  }
  triggerAsyncId() {
    return 0;
  }
  emitDestroy() {
    return this;
  }
};
var performance = globalThis.performance && "addEventListener" in globalThis.performance ? globalThis.performance : new Performance();

// node_modules/@cloudflare/unenv-preset/dist/runtime/polyfill/performance.mjs
if (!("__unenv__" in performance)) {
  const proto = Performance.prototype;
  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key !== "constructor" && !(key in performance)) {
      const desc = Object.getOwnPropertyDescriptor(proto, key);
      if (desc) {
        Object.defineProperty(performance, key, desc);
      }
    }
  }
}
globalThis.performance = performance;
globalThis.Performance = Performance;
globalThis.PerformanceEntry = PerformanceEntry;
globalThis.PerformanceMark = PerformanceMark;
globalThis.PerformanceMeasure = PerformanceMeasure;
globalThis.PerformanceObserver = PerformanceObserver;
globalThis.PerformanceObserverEntryList = PerformanceObserverEntryList;
globalThis.PerformanceResourceTiming = PerformanceResourceTiming;

// node_modules/unenv/dist/runtime/node/console.mjs
import { Writable } from "node:stream";

// node_modules/unenv/dist/runtime/mock/noop.mjs
var noop_default = Object.assign(() => {
}, { __unenv__: true });

// node_modules/unenv/dist/runtime/node/console.mjs
var _console = globalThis.console;
var _ignoreErrors = true;
var _stderr = new Writable();
var _stdout = new Writable();
var log = _console?.log ?? noop_default;
var info = _console?.info ?? log;
var trace = _console?.trace ?? info;
var debug = _console?.debug ?? log;
var table = _console?.table ?? log;
var error = _console?.error ?? log;
var warn = _console?.warn ?? error;
var createTask = _console?.createTask ?? /* @__PURE__ */ notImplemented("console.createTask");
var clear = _console?.clear ?? noop_default;
var count = _console?.count ?? noop_default;
var countReset = _console?.countReset ?? noop_default;
var dir = _console?.dir ?? noop_default;
var dirxml = _console?.dirxml ?? noop_default;
var group = _console?.group ?? noop_default;
var groupEnd = _console?.groupEnd ?? noop_default;
var groupCollapsed = _console?.groupCollapsed ?? noop_default;
var profile = _console?.profile ?? noop_default;
var profileEnd = _console?.profileEnd ?? noop_default;
var time = _console?.time ?? noop_default;
var timeEnd = _console?.timeEnd ?? noop_default;
var timeLog = _console?.timeLog ?? noop_default;
var timeStamp = _console?.timeStamp ?? noop_default;
var Console = _console?.Console ?? /* @__PURE__ */ notImplementedClass("console.Console");
var _times = /* @__PURE__ */ new Map();
var _stdoutErrorHandler = noop_default;
var _stderrErrorHandler = noop_default;

// node_modules/@cloudflare/unenv-preset/dist/runtime/node/console.mjs
var workerdConsole = globalThis["console"];
var {
  assert,
  clear: clear2,
  // @ts-expect-error undocumented public API
  context,
  count: count2,
  countReset: countReset2,
  // @ts-expect-error undocumented public API
  createTask: createTask2,
  debug: debug2,
  dir: dir2,
  dirxml: dirxml2,
  error: error2,
  group: group2,
  groupCollapsed: groupCollapsed2,
  groupEnd: groupEnd2,
  info: info2,
  log: log2,
  profile: profile2,
  profileEnd: profileEnd2,
  table: table2,
  time: time2,
  timeEnd: timeEnd2,
  timeLog: timeLog2,
  timeStamp: timeStamp2,
  trace: trace2,
  warn: warn2
} = workerdConsole;
Object.assign(workerdConsole, {
  Console,
  _ignoreErrors,
  _stderr,
  _stderrErrorHandler,
  _stdout,
  _stdoutErrorHandler,
  _times
});
var console_default = workerdConsole;

// node_modules/wrangler/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-console
globalThis.console = console_default;

// node_modules/unenv/dist/runtime/node/internal/process/hrtime.mjs
var hrtime = /* @__PURE__ */ Object.assign(/* @__PURE__ */ __name(function hrtime2(startTime) {
  const now = Date.now();
  const seconds = Math.trunc(now / 1e3);
  const nanos = now % 1e3 * 1e6;
  if (startTime) {
    let diffSeconds = seconds - startTime[0];
    let diffNanos = nanos - startTime[0];
    if (diffNanos < 0) {
      diffSeconds = diffSeconds - 1;
      diffNanos = 1e9 + diffNanos;
    }
    return [diffSeconds, diffNanos];
  }
  return [seconds, nanos];
}, "hrtime"), { bigint: /* @__PURE__ */ __name(function bigint() {
  return BigInt(Date.now() * 1e6);
}, "bigint") });

// node_modules/unenv/dist/runtime/node/internal/process/process.mjs
import { EventEmitter } from "node:events";

// node_modules/unenv/dist/runtime/node/internal/tty/read-stream.mjs
var ReadStream = class {
  static {
    __name(this, "ReadStream");
  }
  fd;
  isRaw = false;
  isTTY = false;
  constructor(fd) {
    this.fd = fd;
  }
  setRawMode(mode) {
    this.isRaw = mode;
    return this;
  }
};

// node_modules/unenv/dist/runtime/node/internal/tty/write-stream.mjs
var WriteStream = class {
  static {
    __name(this, "WriteStream");
  }
  fd;
  columns = 80;
  rows = 24;
  isTTY = false;
  constructor(fd) {
    this.fd = fd;
  }
  clearLine(dir3, callback) {
    callback && callback();
    return false;
  }
  clearScreenDown(callback) {
    callback && callback();
    return false;
  }
  cursorTo(x, y, callback) {
    callback && typeof callback === "function" && callback();
    return false;
  }
  moveCursor(dx, dy, callback) {
    callback && callback();
    return false;
  }
  getColorDepth(env2) {
    return 1;
  }
  hasColors(count3, env2) {
    return false;
  }
  getWindowSize() {
    return [this.columns, this.rows];
  }
  write(str, encoding, cb) {
    if (str instanceof Uint8Array) {
      str = new TextDecoder().decode(str);
    }
    try {
      console.log(str);
    } catch {
    }
    cb && typeof cb === "function" && cb();
    return false;
  }
};

// node_modules/unenv/dist/runtime/node/internal/process/node-version.mjs
var NODE_VERSION = "22.14.0";

// node_modules/unenv/dist/runtime/node/internal/process/process.mjs
var Process = class _Process extends EventEmitter {
  static {
    __name(this, "Process");
  }
  env;
  hrtime;
  nextTick;
  constructor(impl) {
    super();
    this.env = impl.env;
    this.hrtime = impl.hrtime;
    this.nextTick = impl.nextTick;
    for (const prop of [...Object.getOwnPropertyNames(_Process.prototype), ...Object.getOwnPropertyNames(EventEmitter.prototype)]) {
      const value = this[prop];
      if (typeof value === "function") {
        this[prop] = value.bind(this);
      }
    }
  }
  // --- event emitter ---
  emitWarning(warning, type, code) {
    console.warn(`${code ? `[${code}] ` : ""}${type ? `${type}: ` : ""}${warning}`);
  }
  emit(...args) {
    return super.emit(...args);
  }
  listeners(eventName) {
    return super.listeners(eventName);
  }
  // --- stdio (lazy initializers) ---
  #stdin;
  #stdout;
  #stderr;
  get stdin() {
    return this.#stdin ??= new ReadStream(0);
  }
  get stdout() {
    return this.#stdout ??= new WriteStream(1);
  }
  get stderr() {
    return this.#stderr ??= new WriteStream(2);
  }
  // --- cwd ---
  #cwd = "/";
  chdir(cwd2) {
    this.#cwd = cwd2;
  }
  cwd() {
    return this.#cwd;
  }
  // --- dummy props and getters ---
  arch = "";
  platform = "";
  argv = [];
  argv0 = "";
  execArgv = [];
  execPath = "";
  title = "";
  pid = 200;
  ppid = 100;
  get version() {
    return `v${NODE_VERSION}`;
  }
  get versions() {
    return { node: NODE_VERSION };
  }
  get allowedNodeEnvironmentFlags() {
    return /* @__PURE__ */ new Set();
  }
  get sourceMapsEnabled() {
    return false;
  }
  get debugPort() {
    return 0;
  }
  get throwDeprecation() {
    return false;
  }
  get traceDeprecation() {
    return false;
  }
  get features() {
    return {};
  }
  get release() {
    return {};
  }
  get connected() {
    return false;
  }
  get config() {
    return {};
  }
  get moduleLoadList() {
    return [];
  }
  constrainedMemory() {
    return 0;
  }
  availableMemory() {
    return 0;
  }
  uptime() {
    return 0;
  }
  resourceUsage() {
    return {};
  }
  // --- noop methods ---
  ref() {
  }
  unref() {
  }
  // --- unimplemented methods ---
  umask() {
    throw createNotImplementedError("process.umask");
  }
  getBuiltinModule() {
    return void 0;
  }
  getActiveResourcesInfo() {
    throw createNotImplementedError("process.getActiveResourcesInfo");
  }
  exit() {
    throw createNotImplementedError("process.exit");
  }
  reallyExit() {
    throw createNotImplementedError("process.reallyExit");
  }
  kill() {
    throw createNotImplementedError("process.kill");
  }
  abort() {
    throw createNotImplementedError("process.abort");
  }
  dlopen() {
    throw createNotImplementedError("process.dlopen");
  }
  setSourceMapsEnabled() {
    throw createNotImplementedError("process.setSourceMapsEnabled");
  }
  loadEnvFile() {
    throw createNotImplementedError("process.loadEnvFile");
  }
  disconnect() {
    throw createNotImplementedError("process.disconnect");
  }
  cpuUsage() {
    throw createNotImplementedError("process.cpuUsage");
  }
  setUncaughtExceptionCaptureCallback() {
    throw createNotImplementedError("process.setUncaughtExceptionCaptureCallback");
  }
  hasUncaughtExceptionCaptureCallback() {
    throw createNotImplementedError("process.hasUncaughtExceptionCaptureCallback");
  }
  initgroups() {
    throw createNotImplementedError("process.initgroups");
  }
  openStdin() {
    throw createNotImplementedError("process.openStdin");
  }
  assert() {
    throw createNotImplementedError("process.assert");
  }
  binding() {
    throw createNotImplementedError("process.binding");
  }
  // --- attached interfaces ---
  permission = { has: /* @__PURE__ */ notImplemented("process.permission.has") };
  report = {
    directory: "",
    filename: "",
    signal: "SIGUSR2",
    compact: false,
    reportOnFatalError: false,
    reportOnSignal: false,
    reportOnUncaughtException: false,
    getReport: /* @__PURE__ */ notImplemented("process.report.getReport"),
    writeReport: /* @__PURE__ */ notImplemented("process.report.writeReport")
  };
  finalization = {
    register: /* @__PURE__ */ notImplemented("process.finalization.register"),
    unregister: /* @__PURE__ */ notImplemented("process.finalization.unregister"),
    registerBeforeExit: /* @__PURE__ */ notImplemented("process.finalization.registerBeforeExit")
  };
  memoryUsage = Object.assign(() => ({
    arrayBuffers: 0,
    rss: 0,
    external: 0,
    heapTotal: 0,
    heapUsed: 0
  }), { rss: /* @__PURE__ */ __name(() => 0, "rss") });
  // --- undefined props ---
  mainModule = void 0;
  domain = void 0;
  // optional
  send = void 0;
  exitCode = void 0;
  channel = void 0;
  getegid = void 0;
  geteuid = void 0;
  getgid = void 0;
  getgroups = void 0;
  getuid = void 0;
  setegid = void 0;
  seteuid = void 0;
  setgid = void 0;
  setgroups = void 0;
  setuid = void 0;
  // internals
  _events = void 0;
  _eventsCount = void 0;
  _exiting = void 0;
  _maxListeners = void 0;
  _debugEnd = void 0;
  _debugProcess = void 0;
  _fatalException = void 0;
  _getActiveHandles = void 0;
  _getActiveRequests = void 0;
  _kill = void 0;
  _preload_modules = void 0;
  _rawDebug = void 0;
  _startProfilerIdleNotifier = void 0;
  _stopProfilerIdleNotifier = void 0;
  _tickCallback = void 0;
  _disconnect = void 0;
  _handleQueue = void 0;
  _pendingMessage = void 0;
  _channel = void 0;
  _send = void 0;
  _linkedBinding = void 0;
};

// node_modules/@cloudflare/unenv-preset/dist/runtime/node/process.mjs
var globalProcess = globalThis["process"];
var getBuiltinModule = globalProcess.getBuiltinModule;
var workerdProcess = getBuiltinModule("node:process");
var unenvProcess = new Process({
  env: globalProcess.env,
  hrtime,
  // `nextTick` is available from workerd process v1
  nextTick: workerdProcess.nextTick
});
var { exit, features, platform } = workerdProcess;
var {
  _channel,
  _debugEnd,
  _debugProcess,
  _disconnect,
  _events,
  _eventsCount,
  _exiting,
  _fatalException,
  _getActiveHandles,
  _getActiveRequests,
  _handleQueue,
  _kill,
  _linkedBinding,
  _maxListeners,
  _pendingMessage,
  _preload_modules,
  _rawDebug,
  _send,
  _startProfilerIdleNotifier,
  _stopProfilerIdleNotifier,
  _tickCallback,
  abort,
  addListener,
  allowedNodeEnvironmentFlags,
  arch,
  argv,
  argv0,
  assert: assert2,
  availableMemory,
  binding,
  channel,
  chdir,
  config,
  connected,
  constrainedMemory,
  cpuUsage,
  cwd,
  debugPort,
  disconnect,
  dlopen,
  domain,
  emit,
  emitWarning,
  env,
  eventNames,
  execArgv,
  execPath,
  exitCode,
  finalization,
  getActiveResourcesInfo,
  getegid,
  geteuid,
  getgid,
  getgroups,
  getMaxListeners,
  getuid,
  hasUncaughtExceptionCaptureCallback,
  hrtime: hrtime3,
  initgroups,
  kill,
  listenerCount,
  listeners,
  loadEnvFile,
  mainModule,
  memoryUsage,
  moduleLoadList,
  nextTick,
  off,
  on,
  once,
  openStdin,
  permission,
  pid,
  ppid,
  prependListener,
  prependOnceListener,
  rawListeners,
  reallyExit,
  ref,
  release,
  removeAllListeners,
  removeListener,
  report,
  resourceUsage,
  send,
  setegid,
  seteuid,
  setgid,
  setgroups,
  setMaxListeners,
  setSourceMapsEnabled,
  setuid,
  setUncaughtExceptionCaptureCallback,
  sourceMapsEnabled,
  stderr,
  stdin,
  stdout,
  throwDeprecation,
  title,
  traceDeprecation,
  umask,
  unref,
  uptime,
  version,
  versions
} = unenvProcess;
var _process = {
  abort,
  addListener,
  allowedNodeEnvironmentFlags,
  hasUncaughtExceptionCaptureCallback,
  setUncaughtExceptionCaptureCallback,
  loadEnvFile,
  sourceMapsEnabled,
  arch,
  argv,
  argv0,
  chdir,
  config,
  connected,
  constrainedMemory,
  availableMemory,
  cpuUsage,
  cwd,
  debugPort,
  dlopen,
  disconnect,
  emit,
  emitWarning,
  env,
  eventNames,
  execArgv,
  execPath,
  exit,
  finalization,
  features,
  getBuiltinModule,
  getActiveResourcesInfo,
  getMaxListeners,
  hrtime: hrtime3,
  kill,
  listeners,
  listenerCount,
  memoryUsage,
  nextTick,
  on,
  off,
  once,
  pid,
  platform,
  ppid,
  prependListener,
  prependOnceListener,
  rawListeners,
  release,
  removeAllListeners,
  removeListener,
  report,
  resourceUsage,
  setMaxListeners,
  setSourceMapsEnabled,
  stderr,
  stdin,
  stdout,
  title,
  throwDeprecation,
  traceDeprecation,
  umask,
  uptime,
  version,
  versions,
  // @ts-expect-error old API
  domain,
  initgroups,
  moduleLoadList,
  reallyExit,
  openStdin,
  assert: assert2,
  binding,
  send,
  exitCode,
  channel,
  getegid,
  geteuid,
  getgid,
  getgroups,
  getuid,
  setegid,
  seteuid,
  setgid,
  setgroups,
  setuid,
  permission,
  mainModule,
  _events,
  _eventsCount,
  _exiting,
  _maxListeners,
  _debugEnd,
  _debugProcess,
  _fatalException,
  _getActiveHandles,
  _getActiveRequests,
  _kill,
  _preload_modules,
  _rawDebug,
  _startProfilerIdleNotifier,
  _stopProfilerIdleNotifier,
  _tickCallback,
  _disconnect,
  _handleQueue,
  _pendingMessage,
  _channel,
  _send,
  _linkedBinding
};
var process_default = _process;

// node_modules/wrangler/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-process
globalThis.process = process_default;

// src/shared/heartbeat.ts
var STALE_MS = 2 * 60 * 1e3;
async function getHeartbeat(env2) {
  try {
    const row = await env2.AVA_HEARTBEAT_DB.prepare("SELECT ts FROM ava_heartbeat WHERE host = 'ava-core' LIMIT 1").first();
    if (!row?.ts) return null;
    const ageMs = Date.now() - new Date(row.ts).getTime();
    return { ts: row.ts, ageMs, fresh: ageMs < STALE_MS };
  } catch {
    return null;
  }
}
__name(getHeartbeat, "getHeartbeat");
async function avaIsAwake(env2) {
  return (await getHeartbeat(env2))?.fresh ?? false;
}
__name(avaIsAwake, "avaIsAwake");
async function initHeartbeatTable(env2) {
  await env2.AVA_HEARTBEAT_DB.exec(
    `CREATE TABLE IF NOT EXISTS ava_heartbeat (
      host TEXT PRIMARY KEY,
      ts   TEXT NOT NULL
    )`
  );
  await env2.AVA_HEARTBEAT_DB.exec(
    `CREATE TABLE IF NOT EXISTS ava_offline_inbox (
      id TEXT PRIMARY KEY,
      at INTEGER NOT NULL,
      iso TEXT NOT NULL,
      surface TEXT NOT NULL,
      channel_id TEXT,
      message_id TEXT,
      author_id TEXT,
      author_name TEXT,
      kind TEXT,
      content TEXT,
      read_at INTEGER
    )`
  );
  await env2.AVA_HEARTBEAT_DB.exec(
    `CREATE TABLE IF NOT EXISTS ava_ecoflow (
      host TEXT PRIMARY KEY,
      ts TEXT NOT NULL,
      json TEXT NOT NULL
    )`
  );
}
__name(initHeartbeatTable, "initHeartbeatTable");

// src/shared/maintenancePage.ts
var UPTIME_PLACEHOLDER = '{"last_up_ms":null,"avg_recovery_s":null,"outages":0}';
function maintenanceHtml(facts) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex">
  <title>RootRecord \u2014 We\u2019ll be back</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; }
    body {
      font-family: Georgia, "Iowan Old Style", "Segoe UI", serif;
      color: #f4efe6;
      background: #0a1016;
      line-height: 1.55;
    }
    main {
      max-width: 40rem;
      margin: 0 auto;
      padding: 3.5rem 1.25rem 4.5rem;
    }
    .brand {
      letter-spacing: 0.12em;
      text-transform: uppercase;
      font-size: 0.72rem;
      font-weight: 700;
      font-family: "Segoe UI", system-ui, sans-serif;
      color: #ff6a2a;
      text-decoration: none;
    }
    h1 {
      font-weight: 500;
      font-size: clamp(1.85rem, 5vw, 2.6rem);
      line-height: 1.15;
      letter-spacing: -0.03em;
      margin: 1.4rem 0 0.85rem;
    }
    h2 {
      font-family: "Segoe UI", system-ui, sans-serif;
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #7d8a96;
      margin: 2.1rem 0 0.7rem;
    }
    p { margin: 0 0 1rem; color: #c5ced6; }
    .lede { font-size: 1.05rem; color: #e4ddd2; }
    .card {
      border: 1px solid #1c2a36;
      background: #0d151c;
      border-radius: 0.7rem;
      padding: 1rem 1.05rem 0.85rem;
      margin: 0 0 0.75rem;
    }
    .card h3 {
      font-family: "Segoe UI", system-ui, sans-serif;
      font-size: 0.95rem;
      font-weight: 650;
      margin: 0 0 0.35rem;
      color: #f4efe6;
    }
    .card p { margin: 0; font-size: 0.95rem; }
    .up h3 { color: #3ee0c6; }
    .held h3 { color: #d4a574; }
    .pills {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      margin: 0.85rem 0 0;
    }
    .pills span {
      font-family: "Segoe UI", system-ui, sans-serif;
      font-size: 0.75rem;
      letter-spacing: 0.02em;
      border: 1px solid #2a3d4c;
      color: #c5ced6;
      border-radius: 999px;
      padding: 0.22rem 0.65rem;
    }
    .links { display: flex; flex-wrap: wrap; gap: 0.85rem 1.2rem; margin-top: 1.7rem; }
    a { color: #3ee0c6; }
    .seen { margin: 1.5rem 0 0; }
    .seen h3 { color: #d4a574; }
    .seen .big {
      font-family: "Segoe UI", system-ui, sans-serif;
      font-variant-numeric: tabular-nums;
      font-size: 1.35rem;
      font-weight: 650;
      color: #f4efe6;
      margin: 0.35rem 0 0.2rem;
      letter-spacing: -0.01em;
    }
    .clock { color: #7d8a96; font-size: 0.85rem; font-family: "Segoe UI", system-ui, sans-serif; margin-top: 2rem; }
  </style>
</head>
<body>
  <main>
    <a class="brand" href="https://rootrecord.cloud">RootRecord</a>
    <h1>The desk is dark right now.</h1>
    <p class="lede">This page is the public door. The HI Pacific Solar Root Server is on. Minecraft is still up.</p>

    <div class="card seen">
      <h3 id="seenWhen">Last known time is not recorded yet.</h3>
      <p class="big" id="seenBack">&nbsp;</p>
      <p id="seenNote">This page fills in once the door has watched the desk go dark and come back.</p>
    </div>
    <script id="ava-uptime" type="application/json">{"last_up_ms":null,"avg_recovery_s":null,"outages":0}<\/script>

    <h2>What happened</h2>
    <p>On Tuesday, August 25, the solar server died. The board failed.</p>
    <p>Work moved to the HI Pacific Solar Root Server on the same island: 16 GB of memory, 512 GB of storage.</p>
    <div class="pills">
      <span>Root Server</span>
      <span>16 GB</span>
      <span>512 GB</span>
      <span>Hawai\u02BBi</span>
    </div>

    <h2>What's up</h2>
    <div class="card up">
      <h3>RootMC</h3>
      <p>Minecraft is up at play.rootmc.net. The RootMC website is held.</p>
    </div>
    <div class="card held">
      <h3>K\u012Blauea Alerts</h3>
      <p>Held on the public web. The volcano feed is running on the root server.</p>
    </div>
    <div class="card held">
      <h3>Weather Manager</h3>
      <p>Held on the public web. Weather is running on the root server.</p>
    </div>
    <div class="card held">
      <h3>Business Manager</h3>
      <p>Held on the public web. Money pages stay hidden.</p>
    </div>
    <div class="card held">
      <h3>Sign-in and dashboards</h3>
      <p>Account pages stay off. No public goals. No wallets.</p>
    </div>

    <p>The public web shows this page. Local tools stay on the root server.</p>
    <div class="links">
      <a href="https://play.rootmc.net">play.rootmc.net</a>
      <a href=".">Retry</a>
    </div>
    <p class="clock" id="hst">Hawai\u02BBi time</p>
  </main>
  <script>
    function tick() {
      const el = document.getElementById("hst");
      if (!el) return;
      const t = new Intl.DateTimeFormat("en-US", {
        timeZone: "Pacific/Honolulu",
        weekday: "short", hour: "numeric", minute: "2-digit", hour12: true
      }).format(new Date());
      el.textContent = t + " HST";
    }
    tick();
    setInterval(tick, 15000);

    // Last known time + countdown to the measured average return.
    // Numbers come from the door's own up/down log. Nothing is estimated here.
    var UPTIME = (function () {
      var el = document.getElementById("ava-uptime");
      try { return JSON.parse((el && el.textContent) || "{}") || {}; }
      catch (e) { return {}; }
    })();

    function spanShort(sec) {
      sec = Math.max(0, Math.round(sec));
      var h = Math.floor(sec / 3600);
      var m = Math.floor((sec % 3600) / 60);
      var s = sec % 60;
      if (h > 0) return h + "h " + (m < 10 ? "0" : "") + m + "m";
      if (m > 0) return m + "m " + (s < 10 ? "0" : "") + s + "s";
      return s + "s";
    }

    function spanRough(sec) {
      sec = Math.max(0, Math.round(sec));
      var h = Math.floor(sec / 3600);
      var m = Math.round((sec % 3600) / 60);
      if (h > 0) return m > 0 ? h + "h " + m + "m" : h + " hours";
      if (m > 0) return m + " minutes";
      return sec + " seconds";
    }

    function spanAgo(sec) {
      sec = Math.round(sec);
      if (sec < 90) return sec + " seconds ago";
      var m = Math.round(sec / 60);
      if (m < 90) return m + " minutes ago";
      var h = Math.round(m / 60);
      if (h < 36) return h + " hours ago";
      return Math.round(h / 24) + " days ago";
    }

    function seenTick() {
      var when = document.getElementById("seenWhen");
      var back = document.getElementById("seenBack");
      var note = document.getElementById("seenNote");
      if (!when || !back || !note) return;

      var last = Number(UPTIME.last_up_ms) || 0;
      if (!last) return;

      var stamp = new Intl.DateTimeFormat("en-US", {
        timeZone: "Pacific/Honolulu",
        weekday: "short", hour: "numeric", minute: "2-digit", hour12: true
      }).format(new Date(last));
      var down = (Date.now() - last) / 1000;
      when.textContent = "Last online " + stamp + " HST, " + spanAgo(down) + ".";

      var avg = Number(UPTIME.avg_recovery_s) || 0;
      var runs = Number(UPTIME.outages) || 0;
      var basis = runs === 1 ? "one outage" : runs + " outages";

      if (!avg) {
        back.style.display = "none";
        note.textContent = "No average return time measured yet. It comes back when it works here.";
        return;
      }
      back.style.display = "";
      var left = avg - down;
      if (left > 0) {
        back.textContent = "Back in about " + spanShort(left);
        note.textContent = "It usually returns within " + spanRough(avg) + " of going dark, measured over " + basis + ".";
      } else {
        back.textContent = "Past the usual window";
        note.textContent = "It usually returns within " + spanRough(avg) + " of going dark, measured over " + basis + ". This one is taking longer. It comes back when it works here.";
      }
    }
    seenTick();
    setInterval(seenTick, 1000);
  <\/script>
</body>
</html>
`;
  if (!facts || !facts.last_up_ms) return html;
  return html.replace(UPTIME_PLACEHOLDER, JSON.stringify(facts));
}
__name(maintenanceHtml, "maintenanceHtml");
function maintenancePage(facts) {
  return new Response(maintenanceHtml(facts), {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": "120",
      "X-Ava-Fallback": "maintenance"
    }
  });
}
__name(maintenancePage, "maintenancePage");
function goalsHiddenPage() {
  return new Response(maintenanceHtml(), {
    status: 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Ava-Goals": "hidden"
    }
  });
}
__name(goalsHiddenPage, "goalsHiddenPage");

// src/shared/proxy.ts
function outboundHeaders(request) {
  const headers = new Headers(request.headers);
  for (const name of [
    "host",
    "cf-connecting-ip",
    "cf-ipcountry",
    "cf-ray",
    "cf-visitor",
    "cf-ew-via",
    "cf-worker",
    "x-forwarded-for",
    "x-forwarded-proto",
    "x-real-ip",
    "connection",
    "content-length"
  ]) {
    headers.delete(name);
  }
  return headers;
}
__name(outboundHeaders, "outboundHeaders");
async function fetchFrontend(request, frontendBase) {
  const url = new URL(request.url);
  const target = frontendBase.replace(/\/$/, "") + url.pathname + url.search;
  return fetch(target, {
    method: request.method,
    headers: outboundHeaders(request),
    body: request.method !== "GET" && request.method !== "HEAD" ? request.body : void 0,
    redirect: "follow"
  });
}
__name(fetchFrontend, "fetchFrontend");
async function proxyToOrigin(request, opts) {
  const { originUrl, offlineFallback, timeoutMs = 8e3, path } = opts;
  const url = new URL(request.url);
  const target = originUrl.replace(/\/$/, "") + (path ?? url.pathname) + url.search;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(target, {
      method: request.method,
      headers: outboundHeaders(request),
      body: request.method !== "GET" && request.method !== "HEAD" ? request.body : void 0,
      signal: controller.signal,
      redirect: "manual"
    });
    clearTimeout(timer);
    if ([502, 503, 522, 523, 524, 530].includes(res.status)) {
      return await offlineFallback?.() ?? offlineResponse();
    }
    return res;
  } catch {
    clearTimeout(timer);
    return await offlineFallback?.() ?? offlineResponse();
  }
}
__name(proxyToOrigin, "proxyToOrigin");
function offlineResponse() {
  return maintenancePage();
}
__name(offlineResponse, "offlineResponse");

// src/shared/statusPage.ts
async function statusJson(env2) {
  const hb = await getHeartbeat(env2);
  const body = {
    host: "ava-core",
    online: hb?.fresh ?? false,
    last_seen: hb?.ts ?? null,
    age_seconds: hb ? Math.round(hb.ageMs / 1e3) : null,
    reason: hb === null ? "no_heartbeat" : hb.fresh ? "ok" : "heartbeat_stale"
  };
  return new Response(JSON.stringify(body, null, 2), {
    status: body.online ? 200 : 503,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
__name(statusJson, "statusJson");

// src/shared/publicPaths.ts
var PUBLIC_EXACT = /* @__PURE__ */ new Set([
  "/health",
  "/api/status",
  "/api/live",
  "/api/solar",
  "/api/solar/history",
  "/api/solar/rollups",
  "/api/desk/notifications",
  "/api/disruption-banner",
  "/api/ops-schedule-banner",
  "/api/kilauea",
  "/api/weather",
  "/api/dashboard",
  "/api/air-quality/current",
  "/api/photos/gallery",
  "/api/mobile/kilauea-live-streams",
  "/api/mobile/kilauea-situation",
  "/api/mobile/kilauea-ai-analyses",
  "/api/earthquakes/global",
  "/api/news/global",
  "/api/site-config",
  "/api/site-config.json"
]);
var PUBLIC_PREFIX = [
  "/api/site-backgrounds/",
  "/api/obs/",
  "/api/mobile/",
  "/api/photos/file/",
  "/api/geography/",
  "/api/media/public",
  "/earthquakes/",
  "/weather/",
  "/news/",
  "/states/",
  "/charts/",
  "/wiki/",
  "/css/",
  "/js/",
  "/assets/"
];
var PRIVATE_PREFIX = [
  "/ops",
  "/api/ops",
  "/api/business",
  "/business",
  "/api/finance",
  "/finance",
  "/api/biz",
  "/api/local",
  "/api/crons",
  "/api/cron",
  "/api/brain",
  // /api/media except /api/media/public* (see isPrivatePath)
  "/api/reports",
  "/api/minecraft",
  "/identities",
  // /media is the Ava Pages public library — not private.
  "/system",
  "/host",
  "/ecoflow",
  "/minecraft"
];
function hits(path, prefixes) {
  return prefixes.some((p) => path === p || path.startsWith(p + "/") || path.startsWith(p + "?"));
}
__name(hits, "hits");
function isPrivatePath(path) {
  if (path === "/api/media/public" || path.startsWith("/api/media/public/") || path.startsWith("/api/media/public?")) {
    return false;
  }
  if (path === "/api/media" || path.startsWith("/api/media/") || path.startsWith("/api/media?")) {
    return true;
  }
  return hits(path, PRIVATE_PREFIX);
}
__name(isPrivatePath, "isPrivatePath");
function isPublicData(path) {
  if (PUBLIC_EXACT.has(path)) return true;
  return PUBLIC_PREFIX.some((p) => path.startsWith(p));
}
__name(isPublicData, "isPublicData");
function isReadMethod(method) {
  return method === "GET" || method === "HEAD";
}
__name(isReadMethod, "isReadMethod");
function isPublicWrite(method, path) {
  if (method !== "POST") return false;
  return path === "/feedback" || path === "/api/feedback" || path === "/api/chat";
}
__name(isPublicWrite, "isPublicWrite");

// src/shared/offlineInbox.ts
async function storeOfflineFeedback(env2, payload) {
  await initHeartbeatTable(env2);
  const id = crypto.randomUUID();
  const message = String(payload.message || payload.content || "").trim();
  if (!message) {
    throw new Error("message required");
  }
  const body = JSON.stringify({
    type: payload.type || payload.kind || "general",
    message,
    reply_email: payload.reply_email || payload.email || null,
    name: payload.name || "",
    surface: payload.surface || payload.app_id || "web",
    app_id: payload.app_id || null
  });
  await env2.AVA_HEARTBEAT_DB.prepare(
    `INSERT INTO ava_offline_inbox
      (id, at, iso, surface, channel_id, message_id, author_id, author_name, kind, content, read_at)
     VALUES (?1, ?2, ?3, ?4, NULL, NULL, NULL, ?5, 'feedback', ?6, NULL)`
  ).bind(
    id,
    Date.now(),
    (/* @__PURE__ */ new Date()).toISOString(),
    String(payload.surface || payload.app_id || "web").slice(0, 80),
    String(payload.name || "").slice(0, 120),
    body
  ).run();
  return { ok: true, id };
}
__name(storeOfflineFeedback, "storeOfflineFeedback");

// src/shared/feedbackPage.ts
function feedbackPageHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Feedback \u2014 RootRecord</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: Georgia, "Iowan Old Style", "Segoe UI", serif; color:#f4efe6; background:#0a1016; margin:0; }
  main { max-width:40rem; margin:0 auto; padding:2.4rem 1.25rem; }
  h1 { font-weight:500; }
  label { display:block; font-family:"Segoe UI",system-ui,sans-serif; font-size:.78rem; letter-spacing:.08em; text-transform:uppercase; color:#7d8a96; }
  input, textarea, select { width:100%; margin:0 0 1rem; padding:.65rem; border:1px solid #1c2a36; border-radius:.45rem; background:#0d151c; color:#f4efe6; }
  textarea { min-height:8rem; }
  button { background:#ff6a2a; color:#140a06; border:0; border-radius:.45rem; padding:.7rem 1.1rem; font-weight:700; }
  .ok { color:#3ee0c6; } .err { color:#fb7185; }
  a { color:#3ee0c6; }
</style>
</head>
<body>
<main>
  <p><a href="https://rootrecord.cloud/">RootRecord</a></p>
  <h1>Feedback</h1>
  <p>The desk is dark. This still reaches us.</p>
  <form id="f">
    <label for="kind">Type</label>
    <select id="kind"><option value="general">General</option><option value="bug">Bug</option><option value="feature">Feature</option></select>
    <label for="message">Message</label>
    <textarea id="message" required></textarea>
    <label for="email">Reply email (optional)</label>
    <input id="email" type="email"/>
    <button type="submit">Send</button>
  </form>
  <p id="out"></p>
</main>
<script>
document.getElementById("f").addEventListener("submit", async (e) => {
  e.preventDefault();
  const out = document.getElementById("out");
  out.textContent = "Sending\u2026";
  try {
    const r = await fetch("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: document.getElementById("kind").value,
        message: document.getElementById("message").value,
        reply_email: document.getElementById("email").value || null,
        surface: location.hostname,
      }),
    });
    const d = await r.json().catch(() => ({}));
    out.className = r.ok ? "ok" : "err";
    out.textContent = r.ok ? "Got it. Thank you." : (d.detail || "Could not send.");
    if (r.ok) document.getElementById("message").value = "";
  } catch (_) {
    out.className = "err";
    out.textContent = "Could not send.";
  }
});
<\/script>
</body>
</html>`;
}
__name(feedbackPageHtml, "feedbackPageHtml");
function feedbackPage() {
  return new Response(feedbackPageHtml(), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }
  });
}
__name(feedbackPage, "feedbackPage");

// src/shared/uptime.ts
var NO_UPTIME = {
  last_up_ms: null,
  avg_recovery_s: null,
  outages: 0
};
var AVG_WINDOW = 20;
var KEEP_ROWS = 200;
var HOST = "ava-core";
async function ensureTables(db) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS ava_uptime (
         host       TEXT PRIMARY KEY,
         last_up    INTEGER,
         down_since INTEGER
       )`
  ).run();
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS ava_outages (
         started_at INTEGER PRIMARY KEY,
         ended_at   INTEGER NOT NULL,
         seconds    INTEGER NOT NULL
       )`
  ).run();
}
__name(ensureTables, "ensureTables");
async function state(db) {
  const row = await db.prepare("SELECT last_up, down_since FROM ava_uptime WHERE host = ?").bind(HOST).first();
  return { last_up: row?.last_up ?? null, down_since: row?.down_since ?? null };
}
__name(state, "state");
async function recordOriginUp(env2, now = Date.now()) {
  const db = env2.AVA_HEARTBEAT_DB;
  if (!db) return;
  try {
    await ensureTables(db);
    const prev = await state(db);
    if (prev.down_since && now > prev.down_since) {
      const seconds = Math.round((now - prev.down_since) / 1e3);
      await db.prepare(
        `INSERT OR REPLACE INTO ava_outages (started_at, ended_at, seconds)
           VALUES (?, ?, ?)`
      ).bind(prev.down_since, now, seconds).run();
      await db.prepare(
        `DELETE FROM ava_outages WHERE started_at NOT IN (
             SELECT started_at FROM ava_outages ORDER BY started_at DESC LIMIT ?
           )`
      ).bind(KEEP_ROWS).run();
    }
    await db.prepare(
      `INSERT INTO ava_uptime (host, last_up, down_since) VALUES (?, ?, NULL)
         ON CONFLICT(host) DO UPDATE SET last_up = excluded.last_up, down_since = NULL`
    ).bind(HOST, now).run();
  } catch {
  }
}
__name(recordOriginUp, "recordOriginUp");
async function recordOriginDown(env2, now = Date.now()) {
  const db = env2.AVA_HEARTBEAT_DB;
  if (!db) return;
  try {
    await ensureTables(db);
    const prev = await state(db);
    if (prev.down_since) return;
    await db.prepare(
      `INSERT INTO ava_uptime (host, last_up, down_since) VALUES (?, NULL, ?)
         ON CONFLICT(host) DO UPDATE SET down_since = excluded.down_since`
    ).bind(HOST, prev.last_up ?? now, now).run();
  } catch {
  }
}
__name(recordOriginDown, "recordOriginDown");
async function readUptime(env2) {
  const db = env2.AVA_HEARTBEAT_DB;
  if (!db) return NO_UPTIME;
  try {
    await ensureTables(db);
    const cur = await state(db);
    const agg = await db.prepare(
      `SELECT COUNT(*) AS n, AVG(seconds) AS avg_s FROM (
           SELECT seconds FROM ava_outages ORDER BY started_at DESC LIMIT ?
         )`
    ).bind(AVG_WINDOW).first();
    const n = Number(agg?.n ?? 0);
    const avg = agg?.avg_s == null ? null : Math.round(Number(agg.avg_s));
    return {
      last_up_ms: cur.last_up ?? null,
      avg_recovery_s: n > 0 && avg && avg > 0 ? avg : null,
      outages: n
    };
  } catch {
    return NO_UPTIME;
  }
}
__name(readUptime, "readUptime");
async function probeOrigin(env2, originUrl, timeoutMs = 6e3) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let ok = false;
  try {
    const res = await fetch(originUrl.replace(/\/$/, "") + "/health", {
      signal: controller.signal,
      redirect: "manual"
    });
    ok = res.ok;
  } catch {
    ok = false;
  } finally {
    clearTimeout(timer);
  }
  if (ok) await recordOriginUp(env2);
  else await recordOriginDown(env2);
  return ok;
}
__name(probeOrigin, "probeOrigin");

// src/shared/ecoflow.ts
var DEFAULT_BASE = "https://api-a.ecoflow.com";
var SN_LABELS = {
  R331ZAB5SG6S2858: "DELTA 2",
  R621ZA16XH6K1155: "RIVER 2 Pro"
};
var HIDDEN_SN = /* @__PURE__ */ new Set(["R331ZAB5SG755642"]);
function normSn(sn) {
  return String(sn || "").trim().toUpperCase();
}
__name(normSn, "normSn");
function publicSn(sn) {
  const key = normSn(sn);
  return Boolean(key) && Boolean(SN_LABELS[key]) && !HIDDEN_SN.has(key);
}
__name(publicSn, "publicSn");
async function hmacSha256Hex(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const buf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hmacSha256Hex, "hmacSha256Hex");
function qstring(obj) {
  return Object.keys(obj).sort().map((k) => `${k}=${obj[k]}`).join("&");
}
__name(qstring, "qstring");
async function ecoflowGet(env2, apiPath, params = {}) {
  const key = String(env2.AVA_ECOFLOW_ACCESS_KEY || "").trim();
  const secret = String(env2.AVA_ECOFLOW_SECRET_KEY || "").trim();
  const base = String(env2.AVA_ECOFLOW_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
  if (!key || !secret) return { ok: false, json: null };
  const nonce = String(Math.floor(1e5 + Math.random() * 9e5));
  const timestamp = String(Date.now());
  const signHeaders = { accessKey: key, nonce, timestamp };
  const paramQs = qstring(params);
  const signStr = (paramQs ? `${paramQs}&` : "") + qstring(signHeaders);
  const sign = await hmacSha256Hex(secret, signStr);
  const url = paramQs ? `${base}${apiPath}?${paramQs}` : `${base}${apiPath}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      accessKey: key,
      nonce,
      timestamp,
      sign,
      Accept: "application/json",
      "User-Agent": "AvaIvy/2.0 (CF EcoFlow)"
    }
  });
  const json = await res.json().catch(() => null);
  const code = json?.code != null ? String(json.code) : "0";
  return { ok: res.ok && code === "0", json };
}
__name(ecoflowGet, "ecoflowGet");
function num(data, ...keys) {
  for (const k of keys) {
    const v = data[k];
    if (v != null && v !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}
__name(num, "num");
function wattsOf(data, ...keys) {
  const v = num(data, ...keys);
  if (v == null) return 0;
  const n = Math.abs(v) >= 1e4 ? v / 1e3 : v;
  return Math.max(0, Math.round(n * 10) / 10);
}
__name(wattsOf, "wattsOf");
var APPLIANCE_AC_W = 1e3;
var STARLINK_BAND_LO = 40;
var STARLINK_BAND_HI = 250;
function packPower(data) {
  const pv = wattsOf(data, "mppt.inWatts", "mppt.pv1InWatts", "mppt.pv2InWatts");
  const acIn = wattsOf(data, "inv.inputWatts", "inv.acInWatts");
  const acOut = wattsOf(data, "inv.outputWatts", "inv.outWatts");
  const pdIn = wattsOf(data, "pd.wattsInSum", "pd.inputWatts");
  const pdOut = wattsOf(data, "pd.wattsOutSum", "pd.outputWatts");
  const usb = ["pd.usb1Watts", "pd.usb2Watts", "pd.qcUsb1Watts", "pd.typec1Watts", "pd.typec2Watts"].reduce((s, k) => s + wattsOf(data, k), 0);
  const car = ["pd.carWatts", "mppt.carOutWatts", "mppt.dcdc12vWatts"].reduce((s, k) => s + wattsOf(data, k), 0);
  const leftover = Math.max(0, pdOut - acOut - car);
  const dcOut = Math.max(usb, leftover);
  const acCharge = Math.max(acIn, Math.max(0, pdIn - pv));
  const discharge = Math.max(acOut, pdOut);
  const dcIn = Math.max(0, pdIn - pv - acIn);
  return {
    pv_w: pv,
    ac_in_w: acIn,
    ac_out_w: acOut,
    ac_charge_w: Math.round(acCharge * 10) / 10,
    discharge_w: Math.round(discharge * 10) / 10,
    usb_w: Math.round(usb * 10) / 10,
    car_w: Math.round(car * 10) / 10,
    dc_out_w: Math.round(dcOut * 10) / 10,
    dc_in_w: Math.round(dcIn * 10) / 10,
    watts_in: pv,
    watts_out: Math.round(dcOut * 10) / 10
  };
}
__name(packPower, "packPower");
function isDelta(d) {
  const sn = normSn(String(d.sn || ""));
  const lab = String(d.label || "").toUpperCase();
  return sn === "R331ZAB5SG6S2858" || lab === "DELTA 2";
}
__name(isDelta, "isDelta");
function isRiver(d) {
  const sn = normSn(String(d.sn || ""));
  const lab = String(d.label || "").toUpperCase();
  return sn === "R621ZA16XH6K1155" || lab.includes("RIVER");
}
__name(isRiver, "isRiver");
function applyAcRoles(devices) {
  for (const d of devices) {
    d.ac_role = null;
    d.transfer_sure = false;
    delete d.transfer_w;
    delete d.appliance_w;
    delete d.starlink_w;
    delete d.emergency_w;
  }
  const delta = devices.find(isDelta);
  const river = devices.find(isRiver);
  let src;
  let dst;
  let transfer = 0;
  if (delta && river) {
    const dOut = Number(delta.ac_out_w || 0);
    const rOut = Number(river.ac_out_w || 0);
    const dIn = Math.max(Number(delta.ac_in_w || 0), Number(delta.ac_charge_w || 0));
    const rIn = Math.max(Number(river.ac_in_w || 0), Number(river.ac_charge_w || 0));
    if (dOut >= 20 && rIn >= 20) {
      src = delta;
      dst = river;
      transfer = Math.min(dOut, rIn);
    } else if (rOut >= 20 && dIn >= 20) {
      src = river;
      dst = delta;
      transfer = Math.min(rOut, dIn);
    }
    if (src && dst) {
      src.ac_role = "transfer_out";
      dst.ac_role = "transfer_in";
      src.transfer_sure = true;
      dst.transfer_sure = true;
      src.transfer_w = Math.round(transfer * 10) / 10;
      dst.transfer_w = Math.round(transfer * 10) / 10;
    }
  }
  const leftover = [];
  for (const d of devices) {
    const aco = Number(d.ac_out_w || 0);
    const house2 = d === src ? Math.max(0, aco - transfer) : aco;
    if (house2 < 20) continue;
    leftover.push({ d, w: house2 });
  }
  const kettle = leftover.filter((x) => x.w >= APPLIANCE_AC_W);
  const house = leftover.filter((x) => x.w < APPLIANCE_AC_W);
  for (const x of kettle) {
    x.d.ac_role = "appliances";
    x.d.appliance_w = Math.round(x.w * 10) / 10;
  }
  const inBand = house.filter((x) => x.w >= STARLINK_BAND_LO && x.w <= STARLINK_BAND_HI);
  let starlinkPick;
  if (inBand.length === 1) starlinkPick = inBand[0].d;
  else if (house.length) starlinkPick = house.reduce((a, b) => a.w >= b.w ? a : b).d;
  for (const x of house) {
    if (x.d === starlinkPick) {
      x.d.starlink_w = Math.round(x.w * 10) / 10;
      if (x.d.ac_role !== "transfer_out" && x.d.ac_role !== "transfer_in") {
        x.d.ac_role = "starlink_lights";
      }
    } else {
      x.d.emergency_w = Math.round(x.w * 10) / 10;
      if (x.d.ac_role !== "transfer_out" && x.d.ac_role !== "transfer_in") {
        x.d.ac_role = "emergency";
      }
    }
  }
}
__name(applyAcRoles, "applyAcRoles");
function sameWatts(a, b) {
  if (a < 20 || b < 20) return false;
  const slack = Math.max(40, 0.12 * Math.max(a, b));
  return Math.abs(a - b) <= slack;
}
__name(sameWatts, "sameWatts");
function isNightHst() {
  const h = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Pacific/Honolulu",
      hour: "numeric",
      hourCycle: "h23"
    }).format(/* @__PURE__ */ new Date())
  );
  return h >= 19 || h < 6;
}
__name(isNightHst, "isNightHst");
var EBATT_MIN_W = 20;
var EBATT_MAX_W = 225;
var EBATT_WH = 220;
function applyEbatt(devices) {
  for (const d of devices) {
    delete d.ebatt_w;
    d.input_kind = null;
  }
  if (!devices.length || !isNightHst()) return;
  const incoming = devices.reduce((s, d) => s + Number(d.pv_w || 0), 0);
  if (incoming < EBATT_MIN_W || incoming > EBATT_MAX_W) return;
  const delta = devices.find(isDelta);
  const deltaOut = delta ? Math.max(Number(delta.discharge_w || 0), Number(delta.ac_out_w || 0), Number(delta.out_w || 0)) : 0;
  if (sameWatts(incoming, deltaOut)) return;
  for (const d of devices) {
    const w = Number(d.pv_w || 0);
    if (w >= EBATT_MIN_W) {
      d.input_kind = "ebatt";
      d.ebatt_w = Math.round(w * 10) / 10;
    }
  }
}
__name(applyEbatt, "applyEbatt");
function solarInW(devices) {
  return Math.round(
    devices.reduce((s, d) => s + (d.input_kind === "ebatt" ? 0 : Number(d.pv_w || 0)), 0) * 10
  ) / 10;
}
__name(solarInW, "solarInW");
function ebattInW(devices) {
  return Math.round(
    devices.reduce(
      (s, d) => s + (d.input_kind === "ebatt" ? Number(d.ebatt_w || d.pv_w || 0) : 0),
      0
    ) * 10
  ) / 10;
}
__name(ebattInW, "ebattInW");
function loadCategories(devices) {
  let transfer = 0, appliances = 0, starlink = 0, emergency = 0, server = 0, drives = 0;
  for (const d of devices) {
    if (d.ac_role === "transfer_out") transfer += Number(d.transfer_w || 0);
    appliances += Number(d.appliance_w || 0);
    starlink += Number(d.starlink_w || 0);
    emergency += Number(d.emergency_w || 0);
    const car = Number(d.car_w || 0);
    if (car >= 5) drives += car;
    server += Math.max(0, Number(d.dc_out_w || 0));
  }
  return {
    server_mobile_w: Math.round(server * 10) / 10,
    starlink_lights_w: Math.round(starlink * 10) / 10,
    appliances_w: Math.round(appliances * 10) / 10,
    emergency_pack_w: Math.round(emergency * 10) / 10,
    hard_drives_12v_w: Math.round(drives * 10) / 10,
    transfer_w: Math.round(transfer * 10) / 10
  };
}
__name(loadCategories, "loadCategories");
function pickSoc(data) {
  for (const k of ["bms_bmsStatus.soc", "bmsMaster.soc", "pd.soc", "soc"]) {
    const v = num(data, k);
    if (v != null && v >= 0 && v <= 100) return Math.round(v * 10) / 10;
  }
  return null;
}
__name(pickSoc, "pickSoc");
async function ensureEcoflowTable(env2) {
  await env2.AVA_HEARTBEAT_DB.exec(
    `CREATE TABLE IF NOT EXISTS ava_ecoflow (
      host TEXT PRIMARY KEY,
      ts TEXT NOT NULL,
      json TEXT NOT NULL
    )`
  );
}
__name(ensureEcoflowTable, "ensureEcoflowTable");
async function readStoredEcoflow(env2) {
  try {
    const row = await env2.AVA_HEARTBEAT_DB.prepare("SELECT ts, json FROM ava_ecoflow WHERE host = 'ava-core' LIMIT 1").first();
    if (!row?.json) return null;
    const parsed = JSON.parse(row.json);
    if (Array.isArray(parsed.devices)) {
      parsed.devices = parsed.devices.filter((d) => publicSn(String(d?.sn || "")));
    }
    return { ...parsed, source: parsed.source || "ecoflow_cf", stored_at: row.ts };
  } catch {
    return null;
  }
}
__name(readStoredEcoflow, "readStoredEcoflow");
async function pollAndStoreEcoflow(env2) {
  const sns = String(env2.AVA_ECOFLOW_SN || "").split(/[,;\s]+/).map((s) => s.trim()).filter(publicSn);
  if (!sns.length || !env2.AVA_ECOFLOW_ACCESS_KEY) return null;
  await ensureEcoflowTable(env2);
  const devices = [];
  const banks = [];
  for (const sn of sns) {
    const q = await ecoflowGet(env2, "/iot-open/sign/device/quota/all", { sn });
    const data = q.json?.data && typeof q.json.data === "object" ? q.json.data : {};
    const soc = pickSoc(data);
    const pwr = packPower(data);
    const live = q.ok && Object.keys(data).length > 0;
    if (live && soc != null) banks.push(soc);
    devices.push({
      label: SN_LABELS[sn] || sn.slice(-6),
      sn,
      soc,
      online: live,
      ...pwr
    });
  }
  applyAcRoles(devices);
  applyEbatt(devices);
  const cats = loadCategories(devices);
  const battery = banks.length ? Math.round(banks.reduce((a, b) => a + b, 0) / banks.length * 10) / 10 : null;
  const solarW = solarInW(devices);
  const ebattW = ebattInW(devices);
  const inW = Math.round((solarW + ebattW) * 10) / 10;
  const dc = devices.reduce((s, d) => s + Number(d.dc_out_w || 0), 0);
  const acInSum = devices.reduce((s, d) => s + Number(d.ac_in_w || 0), 0);
  const acOutSum = devices.reduce((s, d) => s + Number(d.ac_out_w || 0), 0);
  const srcLab = devices.find((d) => d.ac_role === "transfer_out")?.label;
  const dstLab = devices.find((d) => d.ac_role === "transfer_in")?.label;
  const bits = [];
  if (cats.appliances_w >= 20) bits.push("appliances");
  if (srcLab && dstLab) bits.push(`transfer ${srcLab} \u2192 ${dstLab}`);
  else if (cats.transfer_w >= 20) bits.push("AC transfer");
  if (cats.starlink_lights_w >= 20) bits.push("Starlink + lights");
  if (cats.emergency_pack_w >= 20) bits.push("emergency pack");
  if (cats.hard_drives_12v_w >= 5) bits.push("hard drives 12V");
  if (ebattW >= 20) bits.push("E-Batt input");
  else if (solarW > 20) bits.push("PV charging");
  if (cats.server_mobile_w > 20) bits.push("server + mobile");
  const snap = {
    battery_pct: battery,
    bank_pct: battery,
    solar_in_w: solarW,
    ebatt_in_w: ebattW,
    load_w: Math.round(dc * 10) / 10,
    power_w: solarW,
    state: bits.join(" \xB7 ") || "idle",
    devices,
    totals: {
      solar_in_w: solarW,
      ebatt_in_w: ebattW,
      load_w: Math.round(dc * 10) / 10,
      dc_load_w: Math.round(dc * 10) / 10,
      ac_in_w: Math.round(acInSum * 10) / 10,
      ac_out_w: Math.round(acOutSum * 10) / 10,
      generator_w: 0,
      transfer_w: cats.transfer_w,
      appliance_w: cats.appliances_w,
      starlink_lights_w: cats.starlink_lights_w,
      emergency_pack_w: cats.emergency_pack_w,
      server_mobile_w: cats.server_mobile_w,
      hard_drives_12v_w: cats.hard_drives_12v_w,
      net_w: Math.round((inW - dc) * 10) / 10,
      bank_avg_pct: battery,
      packs: devices.length,
      categories: cats
    },
    source: "ecoflow_cf",
    updated_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  if (ebattW >= 20) {
    snap.ebatt = {
      in_w: ebattW,
      nameplate_wh: EBATT_WH,
      label: "E-Batt input"
    };
    snap.night_charge = {
      show: true,
      kind: "ebatt",
      title: "E-Batt input",
      detail: "Recycled Ninebot 220 Wh on the MPPT. EcoFlow calls this PV. Not solar. Nameplate only \u2014 no SOC.",
      in_w: ebattW,
      nameplate_wh: EBATT_WH
    };
  }
  await env2.AVA_HEARTBEAT_DB.prepare(
    "INSERT INTO ava_ecoflow (host, ts, json) VALUES (?1, ?2, ?3) ON CONFLICT(host) DO UPDATE SET ts = excluded.ts, json = excluded.json"
  ).bind("ava-core", snap.updated_at, JSON.stringify(snap)).run();
  return snap;
}
__name(pollAndStoreEcoflow, "pollAndStoreEcoflow");
function solarDeskFromStored(stored) {
  const base = stored && typeof stored === "object" ? { ...stored } : { detail: "no_snapshot" };
  const ageHint = typeof base.updated_at === "string" ? base.updated_at : typeof base.stored_at === "string" ? base.stored_at : null;
  const solar = {
    ...base,
    source: "ecoflow_cf_stored",
    fallback: true,
    updated_at: ageHint || base.updated_at
  };
  return new Response(
    JSON.stringify({
      ok: true,
      solar,
      host: { host: "cloudflare-fallback" },
      weather: {},
      kilauea: {},
      shutdown: {}
    }),
    { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
  );
}
__name(solarDeskFromStored, "solarDeskFromStored");

// src/ava-api/worker.ts
var ORIGIN = "https://origin.avaivy.cloud";
var VERCEL_FRONTEND = "https://6899e1ba.avaivy-cloud.pages.dev";
function isOpsPath(path) {
  return path === "/ops" || path.startsWith("/ops/") || path === "/api/ops" || path.startsWith("/api/ops/");
}
__name(isOpsPath, "isOpsPath");
function isOriginApi(path) {
  if (isOpsPath(path)) return false;
  return isPublicData(path);
}
__name(isOriginApi, "isOriginApi");
function isGoalsPath(path) {
  return path === "/goals" || path.startsWith("/goals/") || path === "/wallets" || path.startsWith("/wallets/") || path === "/status/goals" || path.startsWith("/status/goals");
}
__name(isGoalsPath, "isGoalsPath");
var worker_default = {
  async fetch(request, env2) {
    const url = new URL(request.url);
    if (url.hostname.toLowerCase() === "www.avaivy.cloud") {
      const dest = new URL(request.url);
      dest.protocol = "https:";
      dest.hostname = "avaivy.cloud";
      dest.port = "";
      return Response.redirect(dest.toString(), 301);
    }
    const path = url.pathname;
    if (isOpsPath(path) || path === "/ava/ops" || path.startsWith("/ava/ops") || isPrivatePath(path)) {
      return new Response(null, { status: 404 });
    }
    const origin = env2.AVA_ORIGIN_URL || ORIGIN;
    const urlPath = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
    if (isPublicWrite(request.method, urlPath === "/feedback" ? "/feedback" : urlPath)) {
      const chat = urlPath === "/api/chat";
      let snapshot = {};
      try {
        snapshot = await request.clone().json() || {};
      } catch {
        snapshot = {};
      }
      return proxyToOrigin(request, {
        originUrl: origin,
        timeoutMs: chat ? 6e4 : 8e3,
        offlineFallback: /* @__PURE__ */ __name(async () => {
          if (chat) {
            return Response.json({
              reply: "I am offline on the Root Server. Try again when the desk is up.",
              brain: "offline"
            });
          }
          try {
            const stored = await storeOfflineFeedback(env2, snapshot);
            return Response.json({ ok: true, stored: "offline", id: stored.id });
          } catch (err) {
            return Response.json(
              { ok: false, detail: err instanceof Error ? err.message : "inbox" },
              { status: 400 }
            );
          }
        }, "offlineFallback")
      });
    }
    if (!isReadMethod(request.method) && (path.startsWith("/api/") || path.startsWith("/obs/"))) {
      return new Response(null, { status: 405 });
    }
    if (isGoalsPath(path) || path.startsWith("/api/goals")) {
      return goalsHiddenPage();
    }
    if (path === "/ava/status.json") {
      return statusJson(env2);
    }
    const holdingPage = /* @__PURE__ */ __name(async () => maintenancePage(await readUptime(env2)), "holdingPage");
    if (path === "/solar" || path === "/solar/") {
      return Response.redirect(url.origin + "/status", 301);
    }
    if (path === "/kilauea" || path === "/kilauea/" || path === "/weather" || path === "/weather/" || path === "/rootmc" || path === "/rootmc/") {
      return Response.redirect("https://rootrecord.cloud" + path.replace(/\/$/, ""), 301);
    }
    if (path === "/status" || path === "/status/" || path === "/ava/status" || path === "/ava/status/" || path === "/ava" || path === "/ava/" || path === "/feedback" || path === "/feedback/") {
      return proxyToOrigin(request, {
        originUrl: origin,
        path: path.startsWith("/ava") ? "/status" : path.replace(/\/+$/, "") || "/status",
        timeoutMs: 8e3,
        offlineFallback: path.replace(/\/+$/, "") === "/feedback" ? () => feedbackPage() : holdingPage
      });
    }
    if (path === "/chat" || path === "/chat/") {
      return Response.redirect(url.origin + "/#talk", 302);
    }
    if (path.startsWith("/ava/")) {
      return proxyToOrigin(request, {
        originUrl: origin,
        path: path.slice("/ava".length),
        offlineFallback: holdingPage,
        timeoutMs: 8e3
      });
    }
    if (isOriginApi(path)) {
      const slowDesk = path.startsWith("/api/obs/solar-desk") || path.startsWith("/api/obs/solar") || path === "/api/solar";
      return proxyToOrigin(request, {
        originUrl: origin,
        timeoutMs: slowDesk ? 2e4 : 8e3,
        offlineFallback: /* @__PURE__ */ __name(async () => {
          if (path.startsWith("/api/obs/solar-desk") || path.startsWith("/api/obs/solar")) {
            const stored = await readStoredEcoflow(env2);
            if (!stored && env2.AVA_ECOFLOW_ACCESS_KEY) {
              const fresh = await pollAndStoreEcoflow(env2);
              return solarDeskFromStored(fresh);
            }
            return solarDeskFromStored(stored);
          }
          return holdingPage();
        }, "offlineFallback")
      });
    }
    try {
      return await fetchFrontend(request, VERCEL_FRONTEND);
    } catch {
      return holdingPage();
    }
  },
  async scheduled(_event, env2) {
    if (await probeOrigin(env2, env2.AVA_ORIGIN_URL || ORIGIN)) return;
    if (await avaIsAwake(env2)) return;
    await pollAndStoreEcoflow(env2);
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
