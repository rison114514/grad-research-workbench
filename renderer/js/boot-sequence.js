'use strict';

/* Industrial opening sequence: vertical load, yellow wipe, workbench reveal. */
const BootSequence = {
  async init() {
    const root = document.getElementById('bootSequence');
    const fill = document.getElementById('bootLoaderFill');
    const value = document.getElementById('bootLoaderValue');
    const number = value && value.querySelector('b');
    const loader = root && root.querySelector('.boot-loader-track');
    const projectLogo = root && root.querySelector('.boot-project-logo');
    const endfieldLogo = root && root.querySelector('.boot-endfield-logo');
    const divider = root && root.querySelector('.boot-logo-divider');
    const contours = root && root.querySelector('.boot-contours');
    const status = document.getElementById('bootStatusCopy');
    const wipe = document.getElementById('bootYellowWipe');
    if (!root || !fill || !value || !number || !loader || !wipe) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const loadDelay = reduced ? 40 : 180;
    const loadDuration = reduced ? 520 : 2700;
    document.body.classList.add('booting');

    try {
      projectLogo.animate([
        { transform: 'translate3d(38px,0,0) scale(.96)', opacity: 0 },
        { transform: 'translate3d(0,0,0) scale(1)', opacity: 1 }
      ], { duration: reduced ? 180 : 720, delay: reduced ? 0 : 140, easing: 'cubic-bezier(.16,.78,.18,1)', fill: 'both' });
      endfieldLogo.animate([
        { transform: 'translate3d(28px,0,0)', opacity: 0 },
        { transform: 'translate3d(0,0,0)', opacity: 1 }
      ], { duration: reduced ? 180 : 680, delay: reduced ? 0 : 310, easing: 'cubic-bezier(.18,.76,.2,1)', fill: 'both' });
      if (divider) divider.animate([
        { transform: 'scaleY(.15)', opacity: 0 },
        { transform: 'scaleY(1)', opacity: .7 }
      ], { duration: reduced ? 150 : 620, delay: reduced ? 0 : 460, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' });
      if (contours) contours.animate([
        { transform: 'translate3d(12px,-8px,0) scale(1.025)', opacity: .32 },
        { transform: 'translate3d(0,0,0) scale(1)', opacity: .72 }
      ], { duration: loadDuration + loadDelay, easing: 'cubic-bezier(.2,.65,.2,1)', fill: 'both' });

      const fillAnimation = fill.animate([
        { transform: 'scaleY(0)' },
        { transform: 'scaleY(1)' }
      ], { duration: loadDuration, delay: loadDelay, easing: 'cubic-bezier(.26,.02,.18,1)', fill: 'both' });

      await this.driveCounter({ loader, value, number, status, delay: loadDelay, duration: loadDuration });
      await fillAnimation.finished;
      number.textContent = '100';
      status.innerHTML = '<span>READY</span><b>工作台加载完成</b>';

      await this.pause(reduced ? 35 : 150);
      const wipeIn = wipe.animate([
        { transform: 'scaleX(0)' },
        { transform: 'scaleX(1)' }
      ], { duration: reduced ? 250 : 720, easing: 'cubic-bezier(.72,0,.18,1)', fill: 'both' });
      await wipeIn.finished;

      root.classList.add('reveal-ready');
      root.style.background = 'transparent';
      const wipeOut = wipe.animate([
        { transform: 'scaleX(1)', opacity: 1 },
        { transform: 'scaleX(1)', opacity: 0 }
      ], { duration: reduced ? 200 : 760, delay: reduced ? 20 : 110, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'both' });
      await wipeOut.finished;
    } catch (error) {
      console.warn('开屏动画已安全跳过：', error.message);
    } finally {
      root.remove();
      document.body.classList.remove('booting');
    }
  },

  driveCounter({ loader, value, number, status, delay, duration }) {
    return new Promise((resolve) => {
      const started = performance.now() + delay;
      let last = -1;
      const tick = (now) => {
        const raw = Math.max(0, Math.min(1, (now - started) / duration));
        const eased = 1 - Math.pow(1 - raw, 3.25);
        const percent = Math.min(100, Math.round(eased * 100));
        if (percent !== last) {
          last = percent;
          number.textContent = String(percent).padStart(3, '0');
          const markerHeight = value.offsetHeight || 43;
          const maxY = Math.max(0, loader.clientHeight - markerHeight);
          const markerY = Math.max(0, Math.min(maxY, (loader.clientHeight * eased) - (markerHeight / 2)));
          value.style.transform = `translate3d(0,${markerY}px,0)`;
          if (percent >= 72) status.innerHTML = '<span>VERIFYING</span><b>校验本地服务与工作模块</b>';
          else if (percent >= 34) status.innerHTML = '<span>LOADING</span><b>载入研究数据与视觉系统</b>';
        }
        if (raw < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
  },

  pause(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
};

window.BootSequence = BootSequence;

/*
 * 兜底保护：若开屏动画异常（如 Web Animations finished 未 resolve、
 * 页面在后台 rAF 挂起）导致开屏层未移除，将在 5 秒后强制移除，
 * 防止全屏覆盖层拦截点击导致导航无响应。
 */
setTimeout(() => {
  const root = document.getElementById('bootSequence');
  if (root) {
    root.remove();
    document.body.classList.remove('booting');
  }
}, 5000);

document.addEventListener('DOMContentLoaded', () => BootSequence.init());
