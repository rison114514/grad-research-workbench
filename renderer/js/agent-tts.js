'use strict';

/* 主窗口统一 Agent TTS：智能助理与应用内宠物共用，设置关闭时完全静音。 */
const AgentTts = {
  audio: null,
  sequence: 0,

  stop() {
    this.sequence += 1;
    if (this.audio) {
      this.audio.pause();
      this.audio.src = '';
      this.audio = null;
    }
    window.api?.voice?.stop?.().catch(() => {});
  },

  async handleEvent(event) {
    if (!event?.type) return;
    const sequence = ++this.sequence;
    try {
      const settings = await window.api.store.getSettings();
      const voiceConfig = settings.voiceConfig || {};
      const tts = voiceConfig.tts || {};
      if (voiceConfig.enabled === false || tts.agentReplyEnabled !== true) return;
      const result = await window.api.voice.synthesize(
        event.text || '', { type: event.type }, tts.provider, tts.profileId
      );
      if (sequence !== this.sequence || !result?.ok || !result.audioBase64) return;
      if (this.audio) {
        this.audio.pause();
        this.audio.src = '';
      }
      const audio = new Audio(`data:${result.mimeType || 'audio/wav'};base64,${result.audioBase64}`);
      this.audio = audio;
      audio.volume = Math.max(0, Math.min(1, Number(tts.volume ?? .9)));
      audio.playbackRate = Math.max(.6, Math.min(1.6, Number(tts.speed ?? 1)));
      audio.addEventListener('ended', () => {
        if (this.audio === audio) this.audio = null;
      }, { once: true });
      await audio.play();
    } catch (error) {
      // 播报失败不能影响文字回答、上下文或工具确认链路。
    }
  }
};

window.AgentTts = AgentTts;
if (typeof module !== 'undefined' && module.exports) module.exports = { AgentTts };
