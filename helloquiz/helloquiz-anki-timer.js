// ==UserScript==
// @name         HelloQuiz Anki Timer
// @namespace    http://tampermonkey.net/
// @version      2026-07-06
// @description  Adjustable countdown per question. If you find the correct province after time's up, auto-clicks "again" instead of letting you grade it normally.
// @author       Jakube
// @match        https://helloquiz.app/quiz/*?learn
// @match        https://helloquiz.app/learn
// @icon         https://www.google.com/s2/favicons?sz=64&domain=helloquiz.app
// @updateURL    https://raw.githubusercontent.com/jakobkogler/browser-scripts/main/helloquiz/helloquiz-anki-timer.js
// @downloadURL  https://raw.githubusercontent.com/jakobkogler/browser-scripts/main/helloquiz/helloquiz-anki-timer.js
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const DEBUG = true;
  const NAV_BUTTON_SYMBOLS = ['▶', '⇋', '→'];

  let TIMER_SECONDS = 10;
  let running = true;

  let timerBar, timerInterval, timeoutHandle;
  let currentQuestionText = '';
  let timedOut = false;
  let buttonsWerePresent = false;
  let pendingReview = false;
  let overlayEl = null;

  // ---------- DOM finders ----------

  function findQuizContainer() {
    return document.querySelector('.quiz-module__HPadfW__mapQuiz');
  }

  function findMapContainer() {
    return document.querySelector('.map-quiz-module__gooF1W__map');
  }

  function findQuestionEl() {
    return document.querySelector('.quiz-module__HPadfW__content h2');
  }

  function findAgainButton() {
    const container = document.querySelector('.generic-quiz-module__m31QtG__controlButtonsAnki');
    if (!container) return null;
    return container.querySelector('button[title="1"]');
  }

  // ---------- Timer bar ----------

  function makeTimerBar(container) {
    const wrap = document.createElement('div');
    wrap.style.cssText = `
      position: relative;
      height: 6px;
      width: 100%;
      background: #ddd;
      z-index: 999;
    `;
    const bar = document.createElement('div');
    bar.style.cssText = `
      height: 100%;
      width: 100%;
      background: orange;
      transition: width 100ms linear, background-color 200ms linear;
    `;
    wrap.appendChild(bar);
    container.parentNode.insertBefore(wrap, container);
    return bar;
  }

  function clearTimer() {
    clearInterval(timerInterval);
    clearTimeout(timeoutHandle);
  }

  function resetBarIdle() {
    if (timerBar) {
      timerBar.style.width = '100%';
      timerBar.style.background = running ? 'orange' : '#999';
    }
  }

  function startTimer(container) {
    if (DEBUG) console.log('[helloquiz-timer] startTimer called, running =', running, 'seconds =', TIMER_SECONDS);
    clearTimer();
    timedOut = false;

    if (!timerBar || !document.body.contains(timerBar)) {
      timerBar = makeTimerBar(container);
    }

    if (!running) {
      resetBarIdle();
      return;
    }

    const start = Date.now();
    timerBar.style.width = '100%';
    timerBar.style.background = 'orange';

    timerInterval = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      const remaining = Math.max(0, TIMER_SECONDS - elapsed);
      const pct = TIMER_SECONDS > 0 ? (remaining / TIMER_SECONDS) * 100 : 0;
      timerBar.style.width = pct + '%';
      if (remaining < TIMER_SECONDS * 0.3) {
        timerBar.style.background = 'crimson';
      }
      if (remaining <= 0) {
        clearInterval(timerInterval);
      }
    }, 100);

    timeoutHandle = setTimeout(() => {
      timedOut = true;
      if (timerBar) {
        timerBar.style.background = '#555';
        timerBar.style.width = '0%';
      }
    }, TIMER_SECONDS * 1000);
  }

  // ---------- Review overlay (after wrong answer) ----------

  function findContentEl() {
    return document.querySelector('.quiz-module__HPadfW__content');
  }

  function showReviewOverlay(container) {
    hideReviewOverlay();
    if (!container) return;

    // Hide the question text so the next answer isn't revealed
    const contentEl = findContentEl();
    if (contentEl) contentEl.style.visibility = 'hidden';

    // Full-screen transparent button — map stays visible, any click continues
    const btn = document.createElement('button');
    btn.textContent = 'click anywhere to continue (1)';
    btn.style.cssText = `
      position: fixed;
      inset: 0;
      width: 100%;
      height: 100%;
      z-index: 10000;
      background: transparent;
      border: none;
      cursor: pointer;
      color: rgba(255, 255, 255, 0.7);
      font-size: 18px;
      font-weight: 600;
      font-family: system-ui, sans-serif;
      text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
    `;
    btn.addEventListener('click', proceedFromOverlay);

    document.body.appendChild(btn);
    overlayEl = btn;

    if (DEBUG) console.log('[helloquiz-timer] showing review button, timer paused');
  }

  function hideReviewOverlay() {
    if (overlayEl && overlayEl.parentNode) {
      overlayEl.parentNode.removeChild(overlayEl);
    }
    overlayEl = null;

    // Restore question text visibility
    const contentEl = findContentEl();
    if (contentEl) contentEl.style.visibility = '';
  }

  function proceedFromOverlay() {
    hideReviewOverlay();
    pendingReview = false;
    const container = findMapContainer();
    if (container) startTimer(container);
  }

  // ---------- Console hook (detect correct/incorrect) ----------

  function onAnswerDetected(args) {
    // The site logs: console.log(0, 'correct') or console.log(0, 'incorrect')
    // Only check string args — skip objects to avoid expensive JSON.stringify
    for (let i = 0; i < args.length; i++) {
      if (typeof args[i] !== 'string') continue;
      const s = args[i].toLowerCase();
      if (s === 'incorrect') {
        if (DEBUG) console.debug('[helloquiz-timer] INCORRECT answer detected');
        clearTimer();
        pendingReview = true;
        // Pre-hide immediately so the next question text is never visible
        const contentEl = findContentEl();
        if (contentEl) contentEl.style.visibility = 'hidden';
        return;
      }
      if (s === 'correct') {
        if (DEBUG) console.debug('[helloquiz-timer] correct answer detected');
        clearTimer();
        return;
      }
    }
  }

  function installConsoleHook() {
    ['log', 'warn', 'info', 'debug'].forEach((method) => {
      const original = console[method].bind(console);
      console[method] = function (...args) {
        original(...args);
        try {
          onAnswerDetected(args);
        } catch (err) {
          /* swallow - never let our hook break the page's own logging */
        }
      };
    });
  }

  // ---------- Watchers ----------

  function watchForNewQuestion() {
    const qEl = findQuestionEl();
    const container = findMapContainer();
    if (!qEl || !container) return;

    if (qEl.textContent !== currentQuestionText) {
      currentQuestionText = qEl.textContent;
      buttonsWerePresent = !!findAgainButton();

      if (running && pendingReview) {
        const quizContainer = findQuizContainer() || container;
        showReviewOverlay(quizContainer);
      } else {
        startTimer(container);
      }
    }
  }

  function watchForGradingButtons() {
    const again = findAgainButton();
    const buttonsPresent = !!again;

    if (buttonsPresent && !buttonsWerePresent) {
      // Buttons just appeared — the user answered correctly on the map.
      clearTimer();
      if (running && timedOut) {
        pendingReview = true;
        const contentEl = findContentEl();
        if (contentEl) contentEl.style.visibility = 'hidden';
        again.click();
      }
    }

    buttonsWerePresent = buttonsPresent;
  }

  // ---------- Nav button detection (▶ ⇋ →) ----------

  function isNavButton(el) {
    if (!el || !el.textContent) return false;
    const text = el.textContent.trim();
    return NAV_BUTTON_SYMBOLS.some((sym) => text.includes(sym));
  }

  function onPossibleNavClick(e) {
    let el = e.target;
    let depth = 0;
    let matched = null;
    while (el && depth < 6) {
      if (isNavButton(el)) {
        matched = el;
        break;
      }
      el = el.parentElement;
      depth++;
    }

    if (DEBUG && matched) {
      console.log('[helloquiz-timer] nav button matched:', matched.textContent.trim());
    }

    if (!matched) return;

    setTimeout(() => {
      if (DEBUG) console.log('[helloquiz-timer] forcing resync after nav click');
      hideReviewOverlay();
      pendingReview = false;
      currentQuestionText = '__forced_reset__' + Math.random();
      watchForNewQuestion();
    }, 250);
  }

  // ---------- Again-button detection ----------

  function onPossibleAgainClick(e) {
    const btn = e.target.closest && e.target.closest('button[title="1"]');
    if (btn) {
      pendingReview = true;
      const contentEl = findContentEl();
      if (contentEl) contentEl.style.visibility = 'hidden';
      if (DEBUG) console.log('[helloquiz-timer] "again" grading detected, will pause before next timer start');
    }
  }

  // ---------- Keyboard handlers ----------

  function onOverlayKeydown(e) {
    if (!overlayEl) return;
    if (e.key === '1') {
      e.preventDefault();
      proceedFromOverlay();
    }
  }

  function onAgainKeydown(e) {
    // Catch keyboard shortcut for "again" (key "1") from the user's other
    // userscript. Only fire when grading buttons are actually visible, the
    // overlay isn't showing, and focus isn't in an input field (otherwise
    // typing "15" into the timer seconds field would falsely trigger this).
    if (e.key !== '1') return;
    if (overlayEl) return;
    const tag = (document.activeElement || {}).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (!findAgainButton()) return;

    pendingReview = true;
    const contentEl = findContentEl();
    if (contentEl) contentEl.style.visibility = 'hidden';
    if (DEBUG) console.log('[helloquiz-timer] "again" grading detected via keyboard, will pause before next timer start');
  }

  // ---------- Control panel ----------

  function makeControlPanel() {
    const panel = document.createElement('div');
    panel.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      z-index: 100000;
      background: rgba(30, 30, 30, 0.85);
      color: #fff;
      font-family: system-ui, sans-serif;
      font-size: 13px;
      padding: 8px 10px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      user-select: none;
    `;

    const label = document.createElement('label');
    label.textContent = 'timer (s):';
    label.style.cssText = 'display:flex; align-items:center; gap:4px;';

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.step = '1';
    input.value = String(TIMER_SECONDS);
    input.style.cssText = `
      width: 48px;
      padding: 2px 4px;
      border-radius: 4px;
      border: 1px solid #666;
      background: #222;
      color: #fff;
    `;
    input.addEventListener('change', () => {
      const val = parseFloat(input.value);
      if (!isNaN(val) && val > 0) {
        TIMER_SECONDS = val;
        const container = findMapContainer();
        if (container) startTimer(container);
      } else {
        input.value = String(TIMER_SECONDS);
      }
    });

    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = running ? 'stop' : 'start';
    toggleBtn.style.cssText = `
      padding: 3px 10px;
      border-radius: 4px;
      border: none;
      cursor: pointer;
      font-weight: 600;
      background: ${running ? '#c0392b' : '#27ae60'};
      color: #fff;
    `;
    toggleBtn.addEventListener('click', () => {
      running = !running;
      toggleBtn.textContent = running ? 'stop' : 'start';
      toggleBtn.style.background = running ? '#c0392b' : '#27ae60';

      const container = findMapContainer();
      if (running) {
        if (container) startTimer(container);
      } else {
        clearTimer();
        timedOut = false;
        resetBarIdle();
      }
    });

    label.appendChild(input);
    panel.appendChild(label);
    panel.appendChild(toggleBtn);
    document.body.appendChild(panel);
  }

  // ---------- Init ----------

  function init() {
    makeControlPanel();
    installConsoleHook();
    document.addEventListener('click', onPossibleNavClick, true);
    document.addEventListener('click', onPossibleAgainClick, true);
    document.addEventListener('keydown', onOverlayKeydown, true);
    document.addEventListener('keydown', onAgainKeydown, true);
    setInterval(() => {
      watchForNewQuestion();
      watchForGradingButtons();
    }, 200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
