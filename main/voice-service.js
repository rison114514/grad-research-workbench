'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const store = require('./store');
const ai = require('./ai-service');
const {
  parseNormalizeResponse,
  validateEditorResult,
  editorRepairInstruction,
  sanitizeSpeechText,
  speechTextForEvent
} = require('./voice-utils');

const MAX_AUDIO_BYTES = 32 * 1024 * 1024;
const LOCAL_TTS_MODEL = 'mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit';
const WHISPER_MODEL_NAME = 'ggml-small-q5_1.bin';
const WHISPER_LARGE_MODEL_NAME = 'ggml-large-v3-turbo-q5_0.bin';
const WHISPER_VAD_NAME = 'ggml-silero-v6.2.0.bin';
const WHISPER_VAD_URL = `https://huggingface.co/ggml-org/whisper-vad/resolve/main/${WHISPER_VAD_NAME}`;
// Keep the legacy profile id and local speaker id for existing user data and
// fine-tuned checkpoints. Xaihi is the public-facing English name.
const BUILTIN_XAIHI_PROFILE_ID = 'builtin-Xaihi';
const BUILTIN_XAIHI_REFERENCE_TEXT = '经过这段时间的相处，我与管理员的关系越发亲近，这时我应该展现友好、亲和、信任的态度。';
// Use an immutable CDN URL here. Alibaba Cloud fetches this URL server-side and
// cannot reliably reach raw.githubusercontent.com from every region.
const BUILTIN_XAIHI_PUBLIC_URL = 'https://cdn.jsdelivr.net/gh/rison114514/grad-research-workbench@868726f/renderer/assets/voice/Xaihi-reference.wav';
const BUILTIN_XAIHI_REFERENCE_REVISION = 'long-11s-v1';

function builtinXaihiProfile() {
  return {
    id: BUILTIN_XAIHI_PROFILE_ID,
    name: 'Xaihi · 塞西内置参考音色',
    provider: 'local',
    builtIn: true,
    referencePath: path.join(__dirname, '..', 'renderer', 'assets', 'voice', 'Xaihi-reference.wav'),
    referenceText: BUILTIN_XAIHI_REFERENCE_TEXT,
    audioUrl: BUILTIN_XAIHI_PUBLIC_URL,
    referenceRevision: BUILTIN_XAIHI_REFERENCE_REVISION,
    model: LOCAL_TTS_MODEL
  };
}

function normalizeAsrModelName(value) {
  return value === WHISPER_LARGE_MODEL_NAME || value === 'large'
    ? WHISPER_LARGE_MODEL_NAME
    : WHISPER_MODEL_NAME;
}

function whisperModelUrl(name) {
  return `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${normalizeAsrModelName(name)}`;
}

let activeChildren = new Set();
let activeControllers = new Set();
let ttsWorker = null;
let ttsPort = null;
let ttsReadyPromise = null;
let ttsWorkerModel = '';
let microphonePermissionGranted = false;
let microphonePromptAttempted = false;

function electronApp() {
  return require('electron').app;
}

function defaults() {
  return {
    enabled: true,
    cleanupEnabled: true,
    cleanupConfirm: 'always',
    asr: {
      provider: 'local',
      fallbackEnabled: true,
      fallbackProvider: 'remote',
      language: 'zh',
      localModel: WHISPER_MODEL_NAME,
      remoteBaseUrl: '',
      remoteApiKey: '',
      remoteModel: 'gpt-4o-mini-transcribe'
    },
    tts: {
      agentReplyEnabled: false,
      provider: 'cosy',
      fallbackEnabled: true,
      fallbackProvider: 'local',
      localModel: LOCAL_TTS_MODEL,
      localMode: 'zero_shot',
      localSpeaker: 'Xaihi',
      localInstruct: '沉稳、温柔、清晰的中文女声',
      profileId: BUILTIN_XAIHI_PROFILE_ID,
      cosyBaseUrl: '',
      cosyWorkspaceId: '',
      cosyApiKey: '',
      cosyModel: 'cosyvoice-v2',
      cosyVoiceId: '',
      customBaseUrl: '',
      customApiKey: '',
      customModel: 'tts-1',
      customVoice: ''
    },
    playback: { speed: 1, volume: 1 }
  };
}

function mergeVoiceConfig(settings = store.getSettings()) {
  const base = defaults();
  const value = settings.voiceConfig || {};
  const tts = { ...base.tts, ...(value.tts || {}) };
  if (!tts.profileId || (String(tts.profileId).startsWith('builtin-') && tts.profileId !== BUILTIN_XAIHI_PROFILE_ID)) {
    tts.profileId = BUILTIN_XAIHI_PROFILE_ID;
  }
  return {
    ...base,
    ...value,
    asr: { ...base.asr, ...(value.asr || {}) },
    tts,
    playback: { ...base.playback, ...(value.playback || {}) }
  };
}

function voiceRoot() {
  const dir = path.join(electronApp().getPath('userData'), 'voice-runtime');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function tempDir() {
  const dir = path.join(voiceRoot(), 'tmp');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function profileDir() {
  const dir = path.join(voiceRoot(), 'profiles');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function asrDir() {
  const dir = path.join(voiceRoot(), 'asr');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cacheDir() {
  const dir = path.join(voiceRoot(), 'cache');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function statusCacheKey(type, provider, profileId, text) {
  const key = crypto.createHash('sha256').update([type, provider, profileId || '', text].join('|')).digest('hex');
  return { audio: path.join(cacheDir(), `${key}.audio`), meta: path.join(cacheDir(), `${key}.json`) };
}

function cleanupTempFiles({ all = false } = {}) {
  const dir = tempDir();
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const name of fs.readdirSync(dir)) {
    const fp = path.join(dir, name);
    try {
      const stat = fs.statSync(fp);
      if (stat.isFile() && (all || stat.mtimeMs < cutoff)) fs.unlinkSync(fp);
    } catch (e) { /* 文件已被其他清理流程删除 */ }
  }
}

function executableCandidates(name) {
  const candidates = [];
  for (const folder of String(process.env.PATH || '').split(path.delimiter)) {
    if (folder) candidates.push(path.join(folder, name));
  }
  candidates.push(`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, path.join(os.homedir(), '.local', 'bin', name));
  return [...new Set(candidates)];
}

function findExecutable(names) {
  const bundled = process.platform === 'darwin' && process.arch === 'arm64'
    ? path.join(process.resourcesPath || '', 'app', 'main', 'bin', 'darwin-arm64', 'whisper-cli')
    : '';
  try { if (bundled && fs.statSync(bundled).isFile()) return bundled; } catch (e) { /* use system candidate */ }
  for (const name of names) {
    for (const fp of executableCandidates(name)) {
      try { if (fs.statSync(fp).isFile()) return fp; } catch (e) { /* next */ }
    }
  }
  return '';
}

function sha256File(fp) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(fp, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let read = 0;
    do {
      read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (read) hash.update(buffer.subarray(0, read));
    } while (read);
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

function modelChecksum(modelPath) {
  const checksumPath = `${modelPath}.sha256`;
  try { return fs.readFileSync(checksumPath, 'utf8').trim(); } catch (e) { return ''; }
}

function runtimePaths(asrConfig = {}) {
  const root = voiceRoot();
  const venv = path.join(root, 'mlx-venv');
  const asrModelName = normalizeAsrModelName(asrConfig.localModel);
  return {
    root,
    whisper: findExecutable(['whisper-cli', 'whisper-cpp']),
    brew: findExecutable(['brew']),
    uv: findExecutable(['uv']),
    modelName: asrModelName,
    model: path.join(asrDir(), asrModelName),
    smallModel: path.join(asrDir(), WHISPER_MODEL_NAME),
    largeModel: path.join(asrDir(), WHISPER_LARGE_MODEL_NAME),
    vad: path.join(asrDir(), WHISPER_VAD_NAME),
    venv,
    python: path.join(venv, 'bin', 'python'),
    worker: path.join(__dirname, 'voice-worker.py'),
    hfHome: path.join(root, 'models')
  };
}

function hasMlxAudio(pythonPath) {
  if (!pythonPath || !fs.existsSync(pythonPath)) return false;
  const r = spawnSync(pythonPath, ['-c', 'import mlx_audio, soundfile'], { stdio: 'ignore', timeout: 15000 });
  return r.status === 0;
}

function runtimeStatus() {
  const voiceConfig = mergeVoiceConfig();
  const p = runtimePaths(voiceConfig.asr);
  const config = voiceConfig.tts;
  const localModel = String(config.localModel || LOCAL_TTS_MODEL).trim();
  const localModelValidation = validateLocalModel({ model: localModel, mode: config.localMode });
  return {
    platform: process.platform,
    appleSilicon: process.platform === 'darwin' && process.arch === 'arm64',
    asr: {
      executable: p.whisper,
      executableReady: !!p.whisper,
      selectedModel: p.modelName,
      modelPath: p.model,
      modelReady: fs.existsSync(p.model),
      modelSize: fs.existsSync(p.model) ? fs.statSync(p.model).size : 0,
      modelSha256: modelChecksum(p.model),
      smallModelReady: fs.existsSync(p.smallModel),
      largeModelReady: fs.existsSync(p.largeModel),
      vadPath: p.vad,
      vadReady: fs.existsSync(p.vad)
    },
    tts: {
      uv: p.uv,
      python: p.python,
      environmentReady: hasMlxAudio(p.python),
      workerRunning: !!(ttsWorker && ttsWorker.exitCode === null),
      model: localModel,
      modelValidation: localModelValidation,
      modelCache: p.hfHome
    }
  };
}

function runCommand(command, args, { onProgress, timeoutMs = 30 * 60 * 1000, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    activeChildren.add(child);
    let output = '';
    const push = (chunk) => {
      const text = String(chunk || '');
      output = (output + text).slice(-24000);
      if (onProgress) onProgress({ stage: 'command', detail: text.trim().slice(-400) });
    };
    child.stdout.on('data', push);
    child.stderr.on('data', push);
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer); activeChildren.delete(child); reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer); activeChildren.delete(child);
      if (code === 0) resolve(output);
      else reject(new Error(`${path.basename(command)} 执行失败(${code})：${output.slice(-800)}`));
    });
  });
}

function downloadFile(url, destination, onProgress, redirects = 0) {
  if (redirects > 5) return Promise.reject(new Error('模型下载重定向过多'));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const tmp = `${destination}.download`;
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'ResearchWorkbench/1.7' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        downloadFile(new URL(res.headers.location, url).toString(), destination, onProgress, redirects + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume(); reject(new Error(`模型下载失败：HTTP ${res.statusCode}`)); return;
      }
      const total = Number(res.headers['content-length']) || 0;
      let loaded = 0;
      const out = fs.createWriteStream(tmp);
      res.on('data', (chunk) => {
        loaded += chunk.length;
        if (onProgress) onProgress({ stage: 'download', loaded, total, progress: total ? Math.round(loaded / total * 100) : null });
      });
      res.pipe(out);
      out.once('finish', () => out.close(() => {
        fs.renameSync(tmp, destination);
        resolve(destination);
      }));
      out.once('error', reject);
    });
    request.setTimeout(120000, () => request.destroy(new Error('模型下载超时')));
    request.once('error', (error) => {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (e) { /* ignore */ }
      reject(error);
    });
  });
}

async function prepareRuntime(options = {}, onProgress) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('本地 MLX 语音环境仅支持 Apple Silicon Mac');
  const wantAsr = options.asr !== false;
  const wantTts = options.tts !== false;
  const voiceConfig = mergeVoiceConfig();
  let p = runtimePaths(voiceConfig.asr);
  if (wantAsr) {
    if (!p.whisper) {
      if (!p.brew) throw new Error('未找到 whisper.cpp 或 Homebrew，请先安装其中之一');
      onProgress?.({ stage: 'asr-install', detail: '正在通过 Homebrew 安装 whisper.cpp' });
      await runCommand(p.brew, ['install', 'whisper-cpp'], { onProgress });
      p = runtimePaths(voiceConfig.asr);
      if (!p.whisper) throw new Error('whisper.cpp 安装完成但未找到 whisper-cli');
    }
    if (!fs.existsSync(p.model)) {
      const modelLabel = p.modelName === WHISPER_LARGE_MODEL_NAME ? 'large-v3-turbo Q5 高精度模型' : 'small Q5 轻量模型';
      onProgress?.({ stage: 'asr-model', detail: `正在下载 Whisper ${modelLabel}` });
      await downloadFile(whisperModelUrl(p.modelName), p.model, onProgress);
    }
    if (!modelChecksum(p.model)) {
      onProgress?.({ stage: 'asr-checksum', detail: '正在计算 Whisper 模型 SHA-256 校验和' });
      fs.writeFileSync(`${p.model}.sha256`, `${sha256File(p.model)}\n`, 'utf8');
    }
    if (!fs.existsSync(p.vad)) {
      onProgress?.({ stage: 'asr-vad', detail: '正在下载 Silero VAD 模型' });
      await downloadFile(WHISPER_VAD_URL, p.vad, onProgress);
    }
  }
  if (wantTts) {
    if (!p.uv) throw new Error('未找到 uv；请先安装 uv 后再准备本地 TTS 环境');
    if (!fs.existsSync(p.python)) {
      onProgress?.({ stage: 'tts-venv', detail: '正在创建隔离的 MLX 运行环境' });
      await runCommand(p.uv, ['venv', p.venv, '--python', '3.11'], { onProgress });
    }
    if (!hasMlxAudio(p.python)) {
      onProgress?.({ stage: 'tts-install', detail: '正在安装 MLX-Audio 与声音处理组件' });
      await runCommand(p.uv, ['pip', 'install', '--python', p.python, 'mlx-audio>=0.3,<0.5', 'soundfile>=0.13,<1'], { onProgress });
    }
    fs.mkdirSync(p.hfHome, { recursive: true });
    if (options.preloadTts === true) {
      onProgress?.({ stage: 'tts-model', detail: '正在下载并校验 Qwen3-TTS 0.6B 模型' });
      const localModel = mergeVoiceConfig().tts.localModel || LOCAL_TTS_MODEL;
      await runCommand(p.python, [p.worker, '--preload', '--model', localModel], {
        onProgress,
        env: { HF_HOME: p.hfHome }
      });
    }
  }
  onProgress?.({ stage: 'ready', detail: '本地语音环境已准备' });
  return { ok: true, status: runtimeStatus() };
}

function assertWavBuffer(input) {
  const buffer = Buffer.from(input instanceof Uint8Array ? input : new Uint8Array(input || []));
  if (buffer.length < 44 || buffer.length > MAX_AUDIO_BYTES) throw new Error('录音数据大小无效');
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('录音格式必须为 WAV');
  return buffer;
}

function tempFile(ext = '.wav') {
  return path.join(tempDir(), `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
}

function spawnCapture(command, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const bundledBackendPath = path.join(path.dirname(command), 'libexec');
    // ggml scans the current directory for all compatible backend plugins.
    // Starting the bundled CLI here makes Metal/CPU/BLAS portable without
    // relying on the build machine's compiled-in Homebrew search path.
    const cwd = fs.existsSync(bundledBackendPath) ? bundledBackendPath : undefined;
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd });
    activeChildren.add(child);
    let stdout = '', stderr = '';
    child.stdout.on('data', (c) => { stdout = (stdout + c).slice(-200000); });
    child.stderr.on('data', (c) => { stderr = (stderr + c).slice(-24000); });
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.once('error', (error) => { clearTimeout(timer); activeChildren.delete(child); reject(error); });
    child.once('exit', (code) => {
      clearTimeout(timer); activeChildren.delete(child);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`本地转写失败(${code})：${stderr.slice(-800)}`));
    });
  });
}

function glossaryPrompt(glossary = []) {
  const terms = [...new Set((Array.isArray(glossary) ? glossary : []).map((item) => String(item || '').trim()).filter(Boolean))];
  const joined = terms.slice(0, 80).join('，').slice(0, 800);
  return joined ? `以下词语可能出现在语音中，请使用准确写法：${joined}` : '';
}

async function transcribeLocal(wavPath, config, options = {}) {
  const p = runtimePaths(config);
  if (!p.whisper || !fs.existsSync(p.model)) throw new Error('本地 Whisper 尚未准备，请到设置中点击“准备本地语音环境”');
  const outBase = wavPath.replace(/\.wav$/i, '-result');
  const args = ['-m', p.model, '-f', wavPath, '-l', config.language || 'zh', '-otxt', '-of', outBase, '-nt', '-np'];
  const prompt = glossaryPrompt(options.glossary);
  if (prompt) args.push('--prompt', prompt, '--carry-initial-prompt');
  if (fs.existsSync(p.vad)) args.push('--vad', '--vad-model', p.vad);
  let result;
  try {
    // Metal is around three times faster than CPU on the target Apple Silicon
    // hardware, so it is always the first attempt in the desktop app.
    result = await spawnCapture(p.whisper, args);
  } catch (gpuError) {
    // A machine without a usable Metal backend must remain functional. Remove
    // any partial transcript and retry once with whisper.cpp's CPU backend.
    try { if (fs.existsSync(`${outBase}.txt`)) fs.unlinkSync(`${outBase}.txt`); } catch (e) { /* ignore */ }
    console.warn('[voice] Whisper Metal failed, retrying on CPU:', gpuError.message);
    result = await spawnCapture(p.whisper, ['-ng', ...args]);
  }
  let text = '';
  try { text = fs.readFileSync(`${outBase}.txt`, 'utf8').trim(); } catch (e) { text = result.stdout.trim(); }
  try { if (fs.existsSync(`${outBase}.txt`)) fs.unlinkSync(`${outBase}.txt`); } catch (e) { /* ignore */ }
  if (!text) throw new Error('没有检测到有效人声');
  return text;
}

async function remoteTranscribe(wavPath, config, options = {}) {
  let base = String(config.remoteBaseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('未配置远程 ASR Base URL');
  const endpoint = /\/audio\/transcriptions$/i.test(base) ? base : `${base}/audio/transcriptions`;
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(wavPath)], { type: 'audio/wav' }), 'speech.wav');
  form.append('model', config.remoteModel || 'gpt-4o-mini-transcribe');
  form.append('language', config.language || 'zh');
  const prompt = glossaryPrompt(options.glossary);
  if (prompt) form.append('prompt', prompt);
  const controller = new AbortController();
  activeControllers.add(controller);
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST', body: form, signal: controller.signal,
      headers: config.remoteApiKey ? { Authorization: `Bearer ${config.remoteApiKey}` } : {}
    });
    if (!response.ok) throw new Error(`远程 ASR 错误(${response.status})：${(await response.text()).slice(0, 400)}`);
    const json = await response.json();
    const text = String(json.text || '').trim();
    if (!text) throw new Error('远程 ASR 未返回文本');
    return text;
  } finally {
    clearTimeout(timer); activeControllers.delete(controller);
  }
}

async function transcribe(audio, provider, options = {}) {
  const startedAt = Date.now();
  cleanupTempFiles({ all: true });
  const buffer = assertWavBuffer(audio);
  const fp = tempFile('.wav');
  fs.writeFileSync(fp, buffer);
  const config = mergeVoiceConfig().asr;
  try {
    const selected = provider || config.provider || 'local';
    const attempts = [];
    const run = async (candidate) => {
      const began = Date.now();
      try {
        const text = candidate === 'remote' ? await remoteTranscribe(fp, config, options) : await transcribeLocal(fp, config, options);
        attempts.push({ provider: candidate, ok: true, elapsedMs: Date.now() - began });
        return text;
      } catch (error) {
        attempts.push({ provider: candidate, ok: false, error: error.message, elapsedMs: Date.now() - began });
        throw error;
      }
    };
    try {
      const text = await run(selected);
      return { ok: true, provider: selected, primaryProvider: selected, fallbackUsed: false, attempts, text, elapsedMs: Date.now() - startedAt };
    } catch (primaryError) {
      const fallback = config.fallbackProvider || (selected === 'local' ? 'remote' : 'local');
      if (!config.fallbackEnabled || fallback === selected) throw primaryError;
      try {
        const text = await run(fallback);
        return { ok: true, provider: fallback, primaryProvider: selected, fallbackUsed: true, attempts, text, elapsedMs: Date.now() - startedAt };
      } catch (fallbackError) {
        throw new Error(`ASR 主通道失败：${primaryError.message}；回退通道失败：${fallbackError.message}`);
      }
    }
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    try { fs.unlinkSync(fp); } catch (e) { /* 即用即删 */ }
  }
}

function validateLocalModel(input = {}) {
  const model = String(input.model || '').trim();
  const mode = ['zero_shot', 'custom_voice'].includes(input.mode) ? input.mode : 'zero_shot';
  if (!model) return { ok: false, type: 'empty', mode, error: '未指定本地 TTS 模型' };
  const resolved = path.resolve(model);
  if (fs.existsSync(resolved)) {
    if (!fs.statSync(resolved).isDirectory()) return { ok: false, type: 'path', path: resolved, mode, error: '本地模型路径必须是文件夹' };
    const configReady = fs.existsSync(path.join(resolved, 'config.json'));
    const weightsReady = fs.readdirSync(resolved).some((name) => /\.(safetensors|npz)$/i.test(name));
    return { ok: configReady && weightsReady, type: 'path', path: resolved, mode, configReady, weightsReady, error: configReady && weightsReady ? '' : '模型目录需要 config.json 和 MLX 权重文件' };
  }
  if (/^[\w.-]+\/[\w./-]+$/.test(model)) return { ok: true, type: 'huggingface', model, mode, cached: false };
  return { ok: false, type: 'path', path: resolved, mode, error: '模型路径不存在，也不是有效的 Hugging Face 模型 ID' };
}

function normalizePrompt(transcript, glossary) {
  return `你是面向日常通用场景的“听写编辑 Agent”。你没有任何工具权限，不回答用户、不执行任务、不续写内容。输入可能是聊天、询问、消息、笔记、灵感、长段论述、清单或任务。你的唯一工作是理解自然口述中的停顿、重复、改口、撤销和同音错字，将其恢复为“用户如果一次就说清楚，会直接输入的文字”。不要把普通内容强行改成任务或计划。

【编辑规则】
1. 删除无语义的口头禅、卡壳音、虚假开头和机械重复；保留表示强调的重复。
2. 理解“不对、算了、我说错了、应该是、不是…而是…、这个不需要了、前面的不要”等改口，以最后一次明确表达为准。
3. 区分“被放弃的旧方案”和“最终有效的否定约束”。例如“文本需要单独处理，这个不需要了，不需要做文本”中，只删除旧方案，必须保留最终约束“不需要解析文本”。
4. 修正能由上下文确认的错别字、同音词、粘连和断句。参考词表中的专名必须使用词表写法；明显的领域词误识别应按上下文纠正，例如“多门态／多摩态”应为“多模态”；不确定时保留原文。
5. 这是编辑而不是总结：保留语气、人称、详细程度及全部有效信息，不得压缩或丢掉后半段。
6. 自动补齐标点并按内容本身排版。排版只由表达结构决定，与 intent、是否为待办或是否会执行工具无关：一句话保持自然句式；连续论述按话题分段；出现“一个是、另一个是、还有、包括”等并列展开且包含两项以上时，用“- ”项目符号逐项换行并设置 format=bullets；出现“首先、其次、然后、下一个、最后、第一、第二”等明确顺序或多个步骤时，cleanedText 换行整理为“1. 2. 3.”有序列表并设置 format=numbered。聊天、提问、解释、教程、笔记和任务都可以使用列表。只有用户明确要求复选框时才使用 checklist。
7. cleanedText 必须是完整、可直接发送的成稿。听写编辑只负责文字整理，不生成任务结构，也不根据内容决定是否调用工具。
8. 不新增事实、理由、对象、结论、日期、数字或任务参数，不回答、不执行。
9. 输出前逐项核对原文最后版本的肯定信息和否定约束。无法确定时写入 ambiguities，并设置 safeToUse=false，不得猜测。

【参考词表】
${(glossary || []).map(String).filter(Boolean).slice(0, 160).join('、') || '无'}

【通用询问示例】
原文：嗯我想问一下这个本地模型是不是，那个，是不是没有网络也能用。
输出：{"cleanedText":"我想问一下，这个本地模型是不是没有网络也能用？","intent":"question","format":"sentence","safeToUse":true,"changes":["删除口头禅和重复并补充标点"],"corrections":[],"discardedSpans":[{"text":"嗯、那个、是不是（重复）","reason":"口头禅和重复"}],"ambiguities":[]}

【日常笔记分段示例】
原文：今天测试了本地识别速度很快准确率也不错然后我觉得界面还有点挤这个以后再调整。
输出：{"cleanedText":"今天测试了本地识别，速度很快，准确率也不错。\n\n不过，我觉得界面还有点拥挤，这个以后再调整。","intent":"note","format":"paragraphs","safeToUse":true,"changes":["补充标点并按话题分段"],"corrections":[],"discardedSpans":[],"ambiguities":[]}

【并列观点自动排版示例】
原文：这个方案有三个优点一个是能够离线使用另一个是数据留在本地还有就是响应速度比较稳定。
输出：{"cleanedText":"这个方案有三个优点：\n\n- 能够离线使用。\n- 数据留在本地。\n- 响应速度比较稳定。","intent":"note","format":"bullets","safeToUse":true,"changes":["将并列观点整理为项目符号"],"corrections":[],"discardedSpans":[],"ambiguities":[]}

【普通提问也可使用有序列表】
原文：这个软件怎么使用首先打开设置然后选择识别模型最后长按悬浮球开始说话。
输出：{"cleanedText":"这个软件怎么使用？\n\n1. 打开设置。\n2. 选择识别模型。\n3. 长按悬浮球开始说话。","intent":"question","format":"numbered","safeToUse":true,"changes":["将操作步骤整理为有序列表"],"corrections":[],"discardedSpans":[],"ambiguities":[]}

【明确顺序自动排版示例】
原文：帮我记录今天的事项。首先完成视频解码，然后把压缩包做成单独的多门态解析功能，最后撰写使用说明书。
输出：{"cleanedText":"帮我记录今天的事项。\\n\\n1. 完成视频解码。\\n2. 把压缩包做成单独的多模态解析功能。\\n3. 撰写使用说明书。","intent":"todo_list","format":"numbered","safeToUse":true,"changes":["将并列事项整理为有序列表"],"corrections":[{"from":"多门态","to":"多模态","reason":"上下文明确的领域词纠错"}],"discardedSpans":[],"ambiguities":[]}

【待处理原始转写】
${transcript}

只输出一个合法 JSON 对象，不要代码块或附加说明：{"cleanedText":"完整成稿","intent":"command|question|note|message|brainstorm|schedule|list|todo_list|other","format":"sentence|paragraphs|bullets|numbered|checklist","safeToUse":true,"changes":["简短说明"],"corrections":[{"from":"原片段","to":"修正片段","reason":"依据"}],"discardedSpans":[{"text":"真正失效的原文片段","reason":"口头禅|重复|用户撤销"}],"ambiguities":[]}`;
}

async function normalize(transcript, glossary = []) {
  const original = String(transcript || '').trim();
  if (!original) return { ok: false, error: '转写文本为空' };
  const config = mergeVoiceConfig();
  if (!config.cleanupEnabled || !ai.isConfigured(store.getSettings())) {
    return { ok: true, text: original, original, fallback: true, reason: config.cleanupEnabled ? 'ai-not-configured' : 'disabled' };
  }
  const settings = store.getSettings();
  const requestMessages = [{ role: 'user', content: normalizePrompt(original, glossary) }];
  let response = await ai.chat(requestMessages, settings, {
    temperature: 0, maxTokens: Math.min(3200, Math.max(1000, Math.ceil(original.length * 2.2))),
    system: '你是无工具权限的通用中文听写编辑 Agent。保持用户原有文体，按内容自然排版；不要把聊天、询问、消息、笔记或论述改成任务。理解口语反悔并采用最后一次明确表达。不得回答、执行或补充事实，只能输出指定 JSON。'
  });
  if (!response.ok) return { ok: true, text: original, original, fallback: true, reason: response.error || 'normalize-failed' };
  let parsed = parseNormalizeResponse(response.content);
  let safety = validateEditorResult(original, parsed);
  let repaired = false;

  // 仅在 JSON、空正文或异常膨胀时返修一次；不再对任何自然语言语义作阻断判断。
  if (!safety.ok) {
    const repair = await ai.chat([
      ...requestMessages,
      { role: 'assistant', content: String(response.content || '').slice(0, 12000) },
      { role: 'user', content: editorRepairInstruction(safety.reason) }
    ], settings, {
      temperature: 0, maxTokens: Math.min(3200, Math.max(1000, Math.ceil(original.length * 2.2))),
      system: '你是无工具权限的通用中文听写编辑 Agent 审校器。保持原有文体，只修复程序指出的输出格式问题，输出完整 JSON；不得回答、执行或补充任务。'
    });
    if (repair.ok) {
      response = repair;
      parsed = parseNormalizeResponse(repair.content);
      safety = validateEditorResult(original, parsed);
      repaired = true;
    }
  }
  if (!safety.ok) {
    return { ok: true, text: original, original, fallback: true, reason: safety.reason, attempts: repaired ? 2 : 1 };
  }
  return {
    ok: true, text: parsed.cleanedText, original,
    intent: parsed.intent, format: parsed.format,
    items: parsed.items, ambiguities: parsed.ambiguities,
    changes: parsed.changes, corrections: parsed.corrections, discardedSpans: parsed.discardedSpans,
    fallback: false, repaired, attempts: repaired ? 2 : 1,
    needsReview: safety.warnings.length > 0, reviewWarnings: safety.warnings
  };
}

function profileById(id) {
  if (id === BUILTIN_XAIHI_PROFILE_ID) return builtinXaihiProfile();
  return store.list('voiceProfiles').find((item) => item.id === id) || null;
}

function profileForProvider(config, provider) {
  const providerId = config[`${provider}ProfileId`];
  const exact = profileById(providerId || config.profileId);
  if (exact?.provider === provider) return exact;
  const saved = store.list('voiceProfiles').find((item) => item.provider === provider) || null;
  if (saved) return saved;
  return provider === 'local' ? builtinXaihiProfile() : null;
}

function ttsCacheIdentity(provider, config) {
  const profile = profileForProvider(config, provider);
  if (provider === 'local') {
    return [profile?.id || '', config.localModel || LOCAL_TTS_MODEL, config.localMode || 'zero_shot', config.localSpeaker || 'Xaihi'].join('|');
  }
  if (provider === 'cosy') return [profile?.id || '', config.cosyVoiceId || profile?.voiceId || '', config.cosyModel || 'cosyvoice-v2'].join('|');
  return [config.customModel || 'tts-1', config.customVoice || 'alloy', config.customBaseUrl || ''].join('|');
}

function safeProfileCopy(sourcePath, name) {
  const source = path.resolve(String(sourcePath || ''));
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error('参考音频不存在');
  const stat = fs.statSync(source);
  if (stat.size <= 0 || stat.size > 20 * 1024 * 1024) throw new Error('参考音频必须小于 20MB');
  const ext = path.extname(source).toLowerCase();
  if (!['.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg'].includes(ext)) throw new Error('不支持的参考音频格式');
  const base = String(name || 'ceci').replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, '-').slice(0, 36) || 'ceci';
  const dest = path.join(profileDir(), `${Date.now()}-${base}${ext}`);
  fs.copyFileSync(source, dest);
  return dest;
}

function audioDurationSeconds(fp) {
  const ffprobe = findExecutable(['ffprobe']);
  if (!ffprobe) return null;
  const result = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', fp], { encoding: 'utf8', timeout: 15000 });
  const duration = Number(String(result.stdout || '').trim());
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

async function postJson(url, body, apiKey, timeoutMs = 120000) {
  const controller = new AbortController();
  activeControllers.add(controller);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify(body)
    });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      if (/BadRequest\.InputDownloadFailed|download audio failed/i.test(detail)) {
        throw new Error('阿里云无法下载参考音频：请确认音频 HTTPS 地址已公开发布、无需登录且可直接下载');
      }
      throw new Error(`语音服务错误(${response.status})：${detail}`);
    }
    if (/json/i.test(contentType)) return { json: await response.json(), response };
    return { buffer: Buffer.from(await response.arrayBuffer()), contentType, response };
  } finally {
    clearTimeout(timer); activeControllers.delete(controller);
  }
}

function cosyCustomizationEndpoint(config) {
  return config.cosyWorkspaceId
    ? `https://${config.cosyWorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/customization`
    : 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization';
}

function cosyVoicePrefix(name) {
  const raw = String(name || '').trim();
  if (/xaihi|塞西/i.test(raw)) return 'xaihi';
  const ascii = raw.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);
  if (ascii) return ascii;
  return `voice${crypto.createHash('sha1').update(raw || 'voice').digest('hex').slice(0, 5)}`;
}

async function cosyVoiceRequest(config, input) {
  if (!String(config.cosyApiKey || '').trim()) throw new Error('请先填写 CosyVoice API Key');
  return postJson(cosyCustomizationEndpoint(config), { model: 'voice-enrollment', input }, config.cosyApiKey);
}

async function queryCosyVoice(config, voiceId) {
  if (!voiceId) return null;
  try {
    const result = await cosyVoiceRequest(config, { action: 'query_voice', voice_id: voiceId });
    return result.json?.output || null;
  } catch (error) {
    return null;
  }
}

async function findReusableCosyVoice(config, prefix, targetModel, referenceRevision) {
  const localProfiles = store.list('voiceProfiles').filter((item) =>
    item.provider === 'cosy' && item.prefix === prefix && item.referenceRevision === referenceRevision
  );
  for (const profile of localProfiles.slice().reverse()) {
    const remote = await queryCosyVoice(config, profile.voiceId);
    if (remote && (!remote.target_model || remote.target_model === targetModel)) return { profile, voiceId: profile.voiceId };
  }
  // The cloud list API does not return which reference-audio revision created a
  // voice. Reusing an untracked remote id here would keep an older short sample.
  // Once a revision is configured locally, subsequent clicks remain idempotent.
  await cosyVoiceRequest(config, { action: 'list_voice', prefix, page_index: 0, page_size: 100 });
  return null;
}

function saveCosyProfile({ existing, name, voiceId, audioUrl, model, prefix, sourceProfileId, referenceRevision }) {
  const record = { name, provider: 'cosy', voiceId, audioUrl, model, prefix, sourceProfileId, referenceRevision };
  return existing?.id ? store.update('voiceProfiles', existing.id, record) : store.create('voiceProfiles', record);
}

async function autoConfigureCosy(options = {}) {
  const settings = store.getSettings();
  const voiceConfig = mergeVoiceConfig(settings);
  const config = { ...voiceConfig.tts };
  const source = profileById(options.sourceProfileId || config.profileId) || builtinXaihiProfile();
  const name = String(options.name || source.name || 'Xaihi').trim().slice(0, 40) || 'Xaihi';
  const prefix = cosyVoicePrefix(name);
  const targetModel = config.cosyModel || 'cosyvoice-v2';
  const customAudioUrl = String(options.audioUrl || '').trim();
  const audioUrl = String(customAudioUrl || source.audioUrl || '').trim();
  const referenceRevision = String(options.referenceRevision || (customAudioUrl
    ? `url-${crypto.createHash('sha1').update(customAudioUrl).digest('hex').slice(0, 10)}`
    : source.referenceRevision || 'custom-v1'));
  if (!/^https:\/\//i.test(audioUrl)) throw new Error('Xaihi 云端克隆需要可公开访问的 HTTPS 参考音频地址');

  let reusable = await findReusableCosyVoice(config, prefix, targetModel, referenceRevision);
  let voiceId = reusable?.voiceId || '';
  let profile = reusable?.profile || null;
  let reused = !!voiceId;
  if (!voiceId) {
    const created = await cosyVoiceRequest(config, {
      action: 'create_voice', target_model: targetModel, prefix, url: audioUrl
    });
    voiceId = created.json?.output?.voice_id || '';
    if (!voiceId) throw new Error('CosyVoice 未返回 Voice ID');
  }

  profile = saveCosyProfile({
    existing: profile, name: 'Xaihi · 阿里云克隆音色', voiceId,
    audioUrl, model: targetModel, prefix, sourceProfileId: source.id, referenceRevision
  });
  const nextTts = {
    ...config, provider: 'cosy', profileId: profile.id,
    cosyProfileId: profile.id, cosyVoiceId: voiceId
  };
  store.saveSettings({ voiceConfig: { ...voiceConfig, tts: nextTts } });

  const startedAt = Date.now();
  const preview = await synthesize({
    provider: 'cosy', profileId: profile.id, allowFallback: false,
    text: '管理员，Xaihi 已经准备好了。今天也一起把事情做好吧。',
    context: { type: 'chat_text' }
  });
  return {
    ...preview, configured: true, reused, voiceId, profile,
    elapsedMs: Date.now() - startedAt
  };
}

async function enroll(profile, provider) {
  const selected = provider || profile.provider || 'local';
  const name = String(profile.name || '塞西').trim().slice(0, 40) || '塞西';
  if (selected === 'status') {
    const statusType = String(profile.statusType || '').trim();
    if (!['tool_confirmation', 'tool_result', 'cancelled', 'error'].includes(statusType)) throw new Error('未知状态短句类型');
    const referencePath = safeProfileCopy(profile.referencePath, `status-${statusType}`);
    return { id: `status-${statusType}`, name, provider: 'status', statusType, referencePath };
  }
  if (selected === 'local') {
    const transcript = String(profile.referenceText || '').trim();
    if (!transcript) throw new Error('请填写参考音频的精确逐字稿');
    const duration = audioDurationSeconds(path.resolve(String(profile.referencePath || '')));
    if (duration !== null && (duration < 3 || duration > 10)) throw new Error(`本地参考音频应为 3–10 秒，当前约 ${duration.toFixed(1)} 秒`);
    const referencePath = safeProfileCopy(profile.referencePath, name);
    return store.create('voiceProfiles', { name, provider: 'local', referencePath, referenceText: transcript, model: LOCAL_TTS_MODEL });
  }
  if (selected === 'cosy') {
    const config = mergeVoiceConfig().tts;
    const audioUrl = String(profile.audioUrl || '').trim();
    if (!/^https:\/\//i.test(audioUrl)) throw new Error('CosyVoice 克隆需要可公开访问的 HTTPS 音频 URL');
    const prefix = cosyVoicePrefix(profile.prefix || name);
    const result = await cosyVoiceRequest(config, { action: 'create_voice', target_model: config.cosyModel || 'cosyvoice-v2', prefix, url: audioUrl });
    const voiceId = result.json?.output?.voice_id;
    if (!voiceId) throw new Error('CosyVoice 未返回 voice_id');
    return store.create('voiceProfiles', { name, provider: 'cosy', voiceId, audioUrl, model: config.cosyModel || 'cosyvoice-v2', prefix });
  }
  return store.create('voiceProfiles', { name, provider: 'custom', voiceId: String(profile.voiceId || '') });
}

function startLocalTtsWorker() {
  const config = mergeVoiceConfig().tts;
  const requestedModel = String(config.localModel || LOCAL_TTS_MODEL).trim();
  if (ttsWorker && ttsWorker.exitCode === null && ttsPort && ttsWorkerModel === requestedModel) return Promise.resolve(ttsPort);
  if (ttsWorker && ttsWorker.exitCode === null && ttsWorkerModel !== requestedModel) {
    try { ttsWorker.kill('SIGTERM'); } catch (e) { /* restart with selected model */ }
    ttsWorker = null; ttsPort = null; ttsReadyPromise = null; ttsWorkerModel = '';
  }
  if (ttsReadyPromise) return ttsReadyPromise;
  const p = runtimePaths();
  if (!hasMlxAudio(p.python)) return Promise.reject(new Error('本地 MLX TTS 尚未准备，请到设置中准备运行环境'));
  ttsReadyPromise = new Promise((resolve, reject) => {
    const child = spawn(p.python, [p.worker, '--port', '0', '--model', requestedModel], {
      env: { ...process.env, HF_HOME: p.hfHome }, stdio: ['ignore', 'pipe', 'pipe']
    });
    ttsWorker = child;
    ttsWorkerModel = requestedModel;
    activeChildren.add(child);
    let logs = '', readySeen = false;
    const timeout = setTimeout(() => {
      child.kill('SIGTERM'); reject(new Error('本地 TTS 启动超时'));
    }, 60000);
    child.stdout.on('data', (chunk) => {
      logs += String(chunk);
      for (const line of logs.split(/\r?\n/)) {
        try {
          const item = JSON.parse(line);
          if (item.stage === 'ready' && item.port && !readySeen) {
            readySeen = true;
            ttsPort = Number(item.port);
            fetch(`http://127.0.0.1:${ttsPort}/health`)
              .then((response) => {
                if (!response.ok) throw new Error(`健康检查失败(${response.status})`);
                clearTimeout(timeout); resolve(ttsPort);
              })
              .catch((error) => { clearTimeout(timeout); child.kill('SIGTERM'); reject(new Error(`本地 TTS ${error.message}`)); });
          }
        } catch (e) { /* partial line */ }
      }
      logs = logs.slice(-4000);
    });
    child.stderr.on('data', (c) => { logs = (logs + String(c)).slice(-8000); });
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('exit', (code) => {
      clearTimeout(timeout); activeChildren.delete(child);
      if (ttsWorker === child) {
        ttsWorker = null; ttsPort = null; ttsReadyPromise = null; ttsWorkerModel = '';
      }
      if (code && code !== 0) reject(new Error(`本地 TTS 已退出(${code})：${logs.slice(-800)}`));
    });
  }).finally(() => { ttsReadyPromise = null; });
  return ttsReadyPromise;
}

async function synthesizeLocal(text, config) {
  const profile = profileForProvider(config, 'local');
  const mode = config.localMode === 'custom_voice' ? 'custom_voice' : 'zero_shot';
  if (mode === 'zero_shot' && (!profile || profile.provider !== 'local')) throw new Error('请先创建并选择本地塞西声音档案');
  const validation = validateLocalModel({ model: config.localModel || LOCAL_TTS_MODEL, mode });
  if (!validation.ok) throw new Error(validation.error);
  const port = await startLocalTtsWorker();
  const response = await postJson(`http://127.0.0.1:${port}/synthesize`, {
    text, model: config.localModel || LOCAL_TTS_MODEL,
    mode,
    voice: config.localSpeaker || 'Xaihi',
    instruct: config.localInstruct || '',
    speed: 1,
    referencePath: profile?.referencePath || '',
    referenceText: profile?.referenceText || ''
  }, '', 180000);
  if (!response.buffer) throw new Error(response.json?.error || '本地 TTS 未返回音频');
  return { buffer: response.buffer, mimeType: response.contentType || 'audio/wav', provider: 'local' };
}

async function synthesizeCosy(text, config) {
  const profile = profileForProvider(config, 'cosy');
  const voiceId = config.cosyVoiceId || profile?.voiceId;
  if (!voiceId) throw new Error('请先选择 CosyVoice 克隆音色');
  const endpoint = config.cosyBaseUrl || (config.cosyWorkspaceId
    ? `https://${config.cosyWorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer`
    : 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer');
  const result = await postJson(endpoint, {
    model: config.cosyModel || 'cosyvoice-v2',
    input: { text, voice: voiceId, format: 'wav', sample_rate: 24000 }
  }, config.cosyApiKey, 180000);
  if (result.buffer) return { buffer: result.buffer, mimeType: result.contentType || 'audio/wav', provider: 'cosy' };
  const audio = result.json?.output?.audio || {};
  if (audio.data) return { buffer: Buffer.from(audio.data, 'base64'), mimeType: 'audio/wav', provider: 'cosy' };
  if (audio.url || result.json?.output?.audio_url || result.json?.output?.url) {
    const url = audio.url || result.json.output.audio_url || result.json.output.url;
    const controller = new AbortController(); activeControllers.add(controller);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`下载 CosyVoice 音频失败(${response.status})`);
      return { buffer: Buffer.from(await response.arrayBuffer()), mimeType: response.headers.get('content-type') || 'audio/wav', provider: 'cosy' };
    } finally { activeControllers.delete(controller); }
  }
  throw new Error('CosyVoice 未返回可播放音频');
}

async function synthesizeCustom(text, config) {
  let endpoint = String(config.customBaseUrl || '').replace(/\/+$/, '');
  if (!endpoint) throw new Error('未配置自定义 TTS Base URL');
  if (!/\/audio\/speech$/i.test(endpoint)) endpoint += '/audio/speech';
  const response = await postJson(endpoint, {
    model: config.customModel || 'tts-1', input: text,
    voice: config.customVoice || 'alloy', response_format: 'wav'
  }, config.customApiKey, 180000);
  if (!response.buffer) throw new Error(response.json?.error?.message || '自定义 TTS 未返回音频');
  return { buffer: response.buffer, mimeType: response.contentType || 'audio/wav', provider: 'custom' };
}

async function synthesize(input = {}) {
  const type = input.context?.type || 'chat_text';
  const speechText = speechTextForEvent(type, input.text || '');
  if (!speechText) return { ok: false, error: '没有可播报内容' };
  const config = { ...mergeVoiceConfig().tts };
  if (input.profileId) config.profileId = input.profileId;
  const provider = input.provider || config.provider || 'cosy';
  try {
    const preRecorded = config.statusAudio && config.statusAudio[type];
    if (preRecorded && fs.existsSync(preRecorded)) {
      const buffer = fs.readFileSync(preRecorded);
      if (buffer.length > 0 && buffer.length <= 20 * 1024 * 1024) {
        const ext = path.extname(preRecorded).toLowerCase();
        const mimeType = ({ '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac' })[ext] || 'audio/wav';
        return { ok: true, provider: 'pre-recorded', text: speechText, mimeType, audioBase64: buffer.toString('base64') };
      }
    }
    const cacheable = ['tool_confirmation', 'tool_result', 'cancelled', 'error'].includes(type);
    const cached = statusCacheKey(type, provider, ttsCacheIdentity(provider, config), speechText);
    if (cacheable && fs.existsSync(cached.audio) && fs.existsSync(cached.meta)) {
      try {
        const meta = JSON.parse(fs.readFileSync(cached.meta, 'utf8'));
        const buffer = fs.readFileSync(cached.audio);
        return { ok: true, provider: `${provider}-cache`, text: speechText, mimeType: meta.mimeType || 'audio/wav', audioBase64: buffer.toString('base64') };
      } catch (error) {
        try { fs.unlinkSync(cached.audio); } catch (e) { /* rebuild */ }
        try { fs.unlinkSync(cached.meta); } catch (e) { /* rebuild */ }
      }
    }
    const attempts = [];
    const run = async (candidate) => {
      const began = Date.now();
      try {
        const result = candidate === 'cosy'
          ? await synthesizeCosy(speechText, config)
          : candidate === 'custom'
            ? await synthesizeCustom(speechText, config)
            : await synthesizeLocal(speechText, config);
        attempts.push({ provider: candidate, ok: true, elapsedMs: Date.now() - began });
        return result;
      } catch (error) {
        attempts.push({ provider: candidate, ok: false, error: error.message, elapsedMs: Date.now() - began });
        throw error;
      }
    };
    let result;
    let fallbackUsed = false;
    try {
      result = await run(provider);
    } catch (primaryError) {
      const fallback = config.fallbackProvider || 'local';
      if (input.allowFallback === false || !config.fallbackEnabled || fallback === provider) throw primaryError;
      try {
        result = await run(fallback);
        fallbackUsed = true;
      } catch (fallbackError) {
        throw new Error(`TTS 主通道失败：${primaryError.message}；回退通道失败：${fallbackError.message}`);
      }
    }
    if (cacheable) {
      const resultCache = statusCacheKey(type, result.provider, ttsCacheIdentity(result.provider, config), speechText);
      fs.writeFileSync(resultCache.audio, result.buffer);
      fs.writeFileSync(resultCache.meta, JSON.stringify({ mimeType: result.mimeType, provider: result.provider, createdAt: new Date().toISOString() }), 'utf8');
    }
    return { ok: true, provider: result.provider, primaryProvider: provider, fallbackUsed, attempts, text: speechText, mimeType: result.mimeType, audioBase64: result.buffer.toString('base64') };
  } catch (error) {
    return { ok: false, error: error.message, text: speechText };
  }
}

async function test(provider, profileId) {
  const config = mergeVoiceConfig();
  if (profileId) config.tts.profileId = profileId;
  const started = Date.now();
  const result = await synthesize({ provider: provider || config.tts.provider, profileId, allowFallback: false, text: '管理员，塞西已经准备好了。今天也一起把事情做好吧。', context: { type: 'chat_text' } });
  const elapsedMs = Date.now() - started;
  return { ...result, firstPacketMs: elapsedMs, elapsedMs };
}

async function permission() {
  if (process.platform !== 'darwin') return { ok: true, status: 'granted' };
  if (microphonePermissionGranted) return { ok: true, status: 'granted', cached: true };
  const { systemPreferences } = require('electron');
  let status = systemPreferences.getMediaAccessStatus('microphone');
  if (status === 'granted') {
    microphonePermissionGranted = true;
    return { ok: true, status };
  }
  if ((status === 'not-determined' || status === 'unknown') && !microphonePromptAttempted) {
    microphonePromptAttempted = true;
    const granted = await systemPreferences.askForMediaAccess('microphone');
    status = granted ? 'granted' : systemPreferences.getMediaAccessStatus('microphone');
  }
  microphonePermissionGranted = status === 'granted';
  return { ok: status === 'granted', status };
}

function stop({ shutdown = false } = {}) {
  for (const controller of activeControllers) controller.abort();
  activeControllers.clear();
  for (const child of [...activeChildren]) {
    try { child.kill('SIGTERM'); } catch (e) { /* ignore */ }
  }
  if (ttsWorker) {
    try { ttsWorker.kill('SIGTERM'); } catch (e) { /* ignore */ }
    ttsWorker = null;
    ttsPort = null;
    ttsReadyPromise = null;
    ttsWorkerModel = '';
  }
  cleanupTempFiles({ all: true });
  return { ok: true };
}

module.exports = {
  defaults,
  mergeVoiceConfig,
  runtimeStatus,
  validateLocalModel,
  prepareRuntime,
  cleanupTempFiles,
  transcribe,
  normalize,
  enroll,
  autoConfigureCosy,
  synthesize,
  test,
  permission,
  stop,
  _internals: { assertWavBuffer, normalizePrompt, findExecutable, speechTextForEvent, sanitizeSpeechText, builtinXaihiProfile, cosyVoicePrefix }
};
