'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  parseNormalizeResponse,
  validateNormalizedText,
  validateEditorResult,
  editorRepairInstruction,
  sanitizeSpeechText,
  speechTextForEvent
} = require('../main/voice-utils');

test('口语净化：解析结构化 JSON 与 Markdown 围栏', () => {
  const result = parseNormalizeResponse('```json\n{"cleanedText":"后天下午三点，帮我安排调研浑元4。","semanticRisk":false,"changes":["采用最后修正"],"discardedSpans":["嗯","明天，不对"]}\n```');
  assert.equal(result.cleanedText, '后天下午三点，帮我安排调研浑元4。');
  assert.equal(result.semanticRisk, false);
  assert.deepEqual(result.discardedSpans, [
    { text: '嗯', reason: '' },
    { text: '明天，不对', reason: '' }
  ]);
});

test('口语净化：数字与否定关系改变时拒绝结果并回退', () => {
  assert.equal(validateNormalizedText('后天下午3点开会', '后天下午4点开会').ok, false);
  assert.equal(validateNormalizedText('明天下午3点，不对，后天下午4点开会', '后天下午4点开会。').ok, true);
  assert.equal(validateNormalizedText('明天下午3点开会', '后天下午3点开会').ok, false);
  assert.equal(validateNormalizedText('不要删除这个任务', '删除这个任务').reason, 'negation');
  assert.equal(validateNormalizedText('嗯，不要删除这个任务', '不要删除这个任务。').ok, true);
  assert.equal(validateNormalizedText('这个不要删，明天不对后天提醒我', '后天提醒我。').reason, 'negation');
  assert.equal(validateNormalizedText('不要删，算了还是删掉', '删掉。').ok, true);
});

test('听写编辑 Agent：日期同义词、分别和自然反悔不会触发误判', () => {
  const source = '帮我记录一下今日的代办事项首先是要完成视频的解码把图像和音频单独进行解析文本的话需要单独的这个不需要了不需要做文本的然后压缩包的话需要作为单独的一个功能框进行多摩态的解析最后的话是要完成使用说明书的撰写';
  const cleaned = '今日待办事项：\n- [ ] 完成视频解码，分别解析图像和音频，不解析文本。\n- [ ] 将压缩包解析作为独立功能模块，进行多模态解析。\n- [ ] 完成使用说明书的撰写。';
  assert.equal(validateNormalizedText(source, cleaned).ok, true);
  assert.equal(validateNormalizedText('记录今日的计划', '记录今天的计划').ok, true);
  assert.equal(validateNormalizedText('分别解析图像和音频', '分别解析图像和音频。').ok, true);
});

test('听写编辑 Agent：通用问答、聊天和待办都不受 items 或语义校验约束', () => {
  const question = { cleanedText: '你觉得这个方案怎么样？', intent: 'question', items: [] };
  const chat = { cleanedText: '今天心情不错，想和你聊聊天。', intent: 'message' };
  const looseTodo = {
    cleanedText: '完成视频解码，分别解析图像和音频，不解析文本。',
    intent: 'todo_list', safeToUse: false, semanticRisk: true, items: []
  };
  assert.equal(validateEditorResult('你觉得这个方案怎么样', question).ok, true);
  assert.equal(validateEditorResult('今天心情不错想和你聊聊天', chat).ok, true);
  const todoCheck = validateEditorResult('完成视频解码这个不需要不需要做文本', looseTodo);
  assert.equal(todoCheck.ok, true);
  assert.deepEqual(todoCheck.warnings, ['semantic-risk']);
});

test('听写编辑 Agent：仅对无法使用的输出形态进行返修', () => {
  assert.equal(validateEditorResult('你好', null).reason, 'invalid-json');
  assert.equal(validateEditorResult('你好', { cleanedText: '   ' }).reason, 'empty-output');
  assert.equal(validateEditorResult('你好', { cleanedText: '好'.repeat(2100) }).reason, 'output-too-large');
  assert.match(editorRepairInstruction('invalid-json'), /可解析的完整 JSON/);
});

test('听写编辑 Agent：只校验模型声明的列表版式，不约束聊天内容', () => {
  const paragraph = {
    cleanedText: '首先完成视频解码，然后解析压缩包，最后撰写说明书。',
    intent: 'todo_list', format: 'numbered', items: []
  };
  assert.equal(validateEditorResult('首先完成视频解码然后解析压缩包最后撰写说明书', paragraph).reason, 'format-mismatch:numbered');
  paragraph.cleanedText = '今日待办：\n\n1. 完成视频解码。\n2. 解析压缩包。\n3. 撰写说明书。';
  assert.equal(validateEditorResult('首先完成视频解码然后解析压缩包最后撰写说明书', paragraph).ok, true);
  assert.equal(validateEditorResult('你好', { cleanedText: '你好，有什么可以帮你？', intent: 'message', format: 'sentence' }).ok, true);
  assert.match(editorRepairInstruction('format-mismatch:numbered'), /1\. 2\. 3\./);
});

test('听写编辑提示词按表达结构排版，不以待办类型限制列表', () => {
  const service = fs.readFileSync(path.join(__dirname, '..', 'main', 'voice-service.js'), 'utf8');
  assert.match(service, /面向日常通用场景/);
  assert.match(service, /不要把普通内容强行改成任务或计划/);
  assert.match(service, /排版只由表达结构决定，与 intent、是否为待办或是否会执行工具无关/);
  assert.match(service, /聊天、提问、解释、教程、笔记和任务都可以使用列表/);
  assert.match(service, /听写编辑只负责文字整理，不生成任务结构/);
  assert.doesNotMatch(service, /仅当原文明确要求记录任务、计划或待办时才填写/);
  assert.match(service, /一个是、另一个是、还有、包括/);
  assert.match(service, /首先、其次、然后、下一个、最后/);
  assert.match(service, /format=numbered/);
  assert.match(service, /只有用户明确要求复选框时才使用 checklist/);
});

test('口语净化：长口述只允许整理，不允许压缩成摘要', () => {
  const source = '这个项目的第一个优点是部署简单，只需要准备本地环境。第二个优点是离线状态也能使用，数据不会离开电脑。但是现在长语音识别还不够稳定，遇到背景噪声时会丢字。后面我准备分别测试小模型和大模型，记录准确率和处理时间。';
  assert.match(validateNormalizedText(source, '这个项目有优点，但长语音识别需要优化。').reason, /^(length|information-loss|negation)/);
  assert.equal(validateNormalizedText(source, source.replace(/。/g, '。\n\n')).ok, true);
});

test('Typeless 式整理：确认卡隐藏清洗细节，确认后仍可学习专有词', () => {
  const controller = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'js', 'voice-controller.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'pet-floating.html'), 'utf8');
  assert.match(html, /id="petVoiceEditSummary"/);
  assert.match(controller, /renderEditSummary\(normalized\)/);
  assert.doesNotMatch(controller, /normalized\.changes\.slice/);
  assert.doesNotMatch(controller, /formatLabels/);
  assert.match(controller, /rememberConfirmedCorrections\(text\)/);
  assert.match(controller, /learnedGlossary/);
  assert.match(controller, /\['projects', 'tasks', 'literature'\]/);
});

test('麦克风授权成功后复用，权限失效时才清理缓存', () => {
  const controller = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'js', 'voice-controller.js'), 'utf8');
  const service = fs.readFileSync(path.join(__dirname, '..', 'main', 'voice-service.js'), 'utf8');
  assert.match(controller, /voice\.microphone\.granted/);
  assert.match(controller, /if \(!this\.permissionReady\)/);
  assert.match(controller, /localStorage\.setItem\('voice\.microphone\.granted', '1'\)/);
  assert.match(controller, /localStorage\.removeItem\('voice\.microphone\.granted'\)/);
  assert.match(service, /microphonePermissionGranted/);
  assert.match(service, /microphonePromptAttempted/);
});

test('TTS 清理 Markdown、URL、代码、路径与警告块', () => {
  const source = '# 结论\n\n请看 [说明](https://example.com) 和 `/Users/rison/test.md`。\n\n```js\nalert(1)\n```\n> ⚠️ 该草案未保存';
  const clean = sanitizeSpeechText(source);
  assert.match(clean, /结论/);
  assert.doesNotMatch(clean, /https|Users|alert|草案未保存/);
});

test('结构化 Agent 事件使用固定播报策略', () => {
  assert.equal(speechTextForEvent('tool_confirmation', '任意确认卡'), '好的，我已经为您整理好安排，请确认。');
  assert.equal(speechTextForEvent('tool_result', '完整输出'), '已经为您处理完成。');
  assert.equal(speechTextForEvent('cancelled', ''), '好的，已取消。');
  assert.equal(speechTextForEvent('error', '敏感错误详情'), '抱歉，处理失败了，请查看详细信息。');
});

test('Agent TTS 回复提供独立开关且默认关闭，不影响手动试听', () => {
  const service = fs.readFileSync(path.join(__dirname, '..', 'main', 'voice-service.js'), 'utf8');
  const controller = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'js', 'voice-controller.js'), 'utf8');
  const settings = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'js', 'settings.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  assert.match(service, /agentReplyEnabled: false/);
  assert.match(controller, /agentReplyEnabled: false/);
  assert.match(controller, /cfg\.tts\?\.agentReplyEnabled !== true/);
  assert.match(settings, /setVoiceAgentTts/);
  assert.match(settings, /agentReplyEnabled: document\.getElementById\('setVoiceAgentTts'\)\.checked/);
  assert.match(html, /id="setVoiceAgentTts"/);
});

test('主智能助理、应用内宠物和桌面宠物共用 Agent TTS 事件通道', () => {
  const assistant = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'js', 'assistant.js'), 'utf8');
  const petFloating = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'js', 'pet-floating.js'), 'utf8');
  const agentTts = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'js', 'agent-tts.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  assert.match(assistant, /window\.AgentTts\?\.handleEvent\(event\)/);
  assert.match(petFloating, /emit: \(event\) => window\.VoiceController/);
  assert.match(agentTts, /agentReplyEnabled !== true/);
  assert.match(agentTts, /window\.api\.voice\.synthesize/);
  assert.match(html, /js\/agent-tts\.js/);
});

test('悬浮球语音手势与人工确认门禁已接入', () => {
  const pet = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'js', 'pet-floating.js'), 'utf8');
  const voice = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'js', 'voice-controller.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'pet-floating.html'), 'utf8');
  assert.match(pet, /setTimeout\([\s\S]*?, 520\)/);
  assert.match(pet, /MOVE_THRESHOLD = 5/);
  assert.match(pet, /longpressEnd/);
  assert.match(voice, /confirmBeforeSend|sendConfirmed/);
  assert.match(voice, /window\.PetFloat\.sendText\(text, true, this\.cycle\)/);
  assert.match(html, /id="petVoiceRecordingStop"[^>]*>结束录制</);
  assert.match(html, /id="petVoiceRecordingCancel"[^>]*>取消</);
  assert.match(voice, /petVoiceRecordingStop'[\s\S]*requestStop/);
  assert.match(voice, /petVoiceRecordingCancel'[\s\S]*cancel/);
  assert.match(voice, /window\.PetFloat\.openChat\(\);[\s\S]*window\.PetFloat\.sendText/);
  assert.match(voice, /PetFloat\?\.mode === 'chat'[\s\S]*this\.speak\(event\.text \|\| '', type, false\)/);
  assert.match(voice, /90000/);
});

test('macOS 打包包含麦克风权限用途说明与最终校验', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'package.sh'), 'utf8');
  assert.match(script, /NSMicrophoneUsageDescription/);
  assert.match(script, /usage-description\.Microphone/);
  assert.match(script, /PlistBuddy[\s\S]*Print :NSMicrophoneUsageDescription/);
});

test('统一 voice IPC、127.0.0.1 sidecar 与 userData 持久目录均已接入', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const ipc = fs.readFileSync(path.join(__dirname, '..', 'main', 'ipc.js'), 'utf8');
  const service = fs.readFileSync(path.join(__dirname, '..', 'main', 'voice-service.js'), 'utf8');
  const worker = fs.readFileSync(path.join(__dirname, '..', 'main', 'voice-worker.py'), 'utf8');
  for (const method of ['permission', 'runtimeStatus', 'validateLocalModel', 'prepareRuntime', 'transcribe', 'normalize', 'enroll', 'autoConfigureCosy', 'synthesize', 'stop', 'test']) {
    assert.match(preload, new RegExp(`${method}:`));
    assert.match(ipc, new RegExp(`voice:${method}`));
  }
  assert.match(worker, /HTTPServer\(\("127\.0\.0\.1"/);
  assert.match(service, /getPath\('userData'\)/);
  assert.match(service, /cleanupTempFiles\(\{ all: true \}\)/);
});

test('语音主备路由与未来本地微调模型接口已接入', () => {
  const service = fs.readFileSync(path.join(__dirname, '..', 'main', 'voice-service.js'), 'utf8');
  const worker = fs.readFileSync(path.join(__dirname, '..', 'main', 'voice-worker.py'), 'utf8');
  const settings = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  assert.match(service, /provider: 'local',[\s\S]*fallbackProvider: 'remote'/);
  assert.match(service, /provider: 'cosy',[\s\S]*fallbackProvider: 'local'/);
  assert.match(service, /fallbackUsed/);
  assert.match(worker, /mode == "custom_voice"/);
  assert.match(worker, /kwargs\["voice"\]/);
  assert.match(settings, /setVoiceLocalModel/);
  assert.match(settings, /setVoiceAsrFallback/);
  assert.match(settings, /setVoiceTtsFallback/);
});

test('塞西参考音色随应用内置，并作为本地 TTS 默认档案', () => {
  const service = fs.readFileSync(path.join(__dirname, '..', 'main', 'voice-service.js'), 'utf8');
  const settings = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'js', 'settings.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  const reference = path.join(__dirname, '..', 'renderer', 'assets', 'voice', 'Xaihi-reference.wav');
  assert.equal(fs.existsSync(reference), true);
  assert.ok(fs.statSync(reference).size > 0);
  assert.match(service, /BUILTIN_XAIHI_PROFILE_ID = 'builtin-Xaihi'/);
  assert.match(service, /经过这段时间的相处，我与管理员的关系越发亲近/);
  assert.match(service, /provider === 'local' \? builtinXaihiProfile\(\) : null/);
  assert.match(settings, /Xaihi · 塞西内置参考音色/);
  assert.match(html, /Workspace ID（专属工作空间可选）/);
});

test('Xaihi 云端音色支持一键检测、复用、配置 Voice ID 与试听', () => {
  const service = fs.readFileSync(path.join(__dirname, '..', 'main', 'voice-service.js'), 'utf8');
  const settings = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'js', 'settings.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  assert.match(service, /function cosyVoicePrefix/);
  assert.match(service, /return 'xaihi'/);
  assert.match(service, /action: 'list_voice'/);
  assert.match(service, /action: 'query_voice'/);
  assert.match(service, /action: 'create_voice'/);
  assert.match(service, /BUILTIN_XAIHI_REFERENCE_REVISION = 'long-11s-v1'/);
  assert.match(service, /item\.referenceRevision === referenceRevision/);
  assert.match(service, /crypto\.createHash\('sha1'\)\.update\(customAudioUrl\)/);
  assert.match(service, /BadRequest\\\.InputDownloadFailed/);
  assert.match(service, /阿里云无法下载参考音频/);
  assert.match(service, /cosyVoiceId: voiceId/);
  assert.match(settings, /async autoConfigureCosy\(\)/);
  assert.match(settings, /window\.api\.voice\.autoConfigureCosy/);
  assert.match(html, /id="setVoiceAutoCosy"/);
});

test('本地 Whisper 使用官方 Q5_1 权重并优先 Metal、失败回退 CPU', () => {
  const service = fs.readFileSync(path.join(__dirname, '..', 'main', 'voice-service.js'), 'utf8');
  const packageScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'package.sh'), 'utf8');
  assert.match(service, /ggml-small-q5_1\.bin/);
  assert.match(service, /spawnCapture\(p\.whisper, args\)/);
  assert.match(service, /spawnCapture\(p\.whisper, \['-ng', \.\.\.args\]\)/);
  assert.match(service, /bundledBackendPath[\s\S]*cwd/);
  assert.match(packageScript, /libexec\/libggml-metal\.so/);
});

test('本地 Whisper 模型由设置手动选择，不根据录音时长自动切换', () => {
  const service = fs.readFileSync(path.join(__dirname, '..', 'main', 'voice-service.js'), 'utf8');
  const settings = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'js', 'settings.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  assert.match(service, /ggml-small-q5_1\.bin/);
  assert.match(service, /ggml-large-v3-turbo-q5_0\.bin/);
  assert.match(service, /runtimePaths\(config\)/);
  assert.doesNotMatch(service, /audioDuration[\s\S]{0,160}(large|small)/i);
  assert.match(html, /id="setVoiceAsrLocalModel"/);
  assert.match(html, /应用只使用当前选择的模型，不会根据录音长度自动切换/);
  assert.match(settings, /localModel: document\.getElementById\('setVoiceAsrLocalModel'\)\.value/);
  assert.match(settings, /async prepareVoiceRuntime\(\)[\s\S]{0,300}await this\.saveVoice\(false\)/);
});

test('本地 Whisper 保持默认 VAD，不使用已验证会降低长语音准确率的自定义切段参数', () => {
  const service = fs.readFileSync(path.join(__dirname, '..', 'main', 'voice-service.js'), 'utf8');
  assert.match(service, /args\.push\('--vad', '--vad-model', p\.vad\)/);
  assert.doesNotMatch(service, /--vad-(threshold|min-speech-duration|min-silence-duration|max-speech-duration|speech-pad|samples-overlap)/);
});
