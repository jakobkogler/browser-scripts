// ==UserScript==
// @name         helloquiz anki timer
// @namespace    helloquiz-anki-timer
// @version      4.0
// @description  Adjustable countdown per question. If you find the correct province after time's up, auto-clicks "again" instead of letting you grade it normally.
// @match        https://helloquiz.app/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  let TIMER_SECONDS = 10;
  let running = true;

  let timerBar, timerInterval, timeoutHandle;
  let currentQuestionText = '';
  let timedOut = false;
  let buttonsWerePresent = false;

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

  function watchForNewQuestion() {
    const qEl = findQuestionEl();
    const container = findMapContainer();
    if (!qEl || !container) return;

    if (qEl.textContent !== currentQuestionText) {
      currentQuestionText = qEl.textContent;
      // Don't assume no buttons are present - the previous question's
      // grading buttons can still be mid-fade-out in the DOM right as the
      // next question renders. Recording their real state here prevents
      // that leftover from being misread as a fresh "answer" transition,
      // which was wrongly clearing the just-started timer.
      buttonsWerePresent = !!findAgainButton();
      startTimer(container);
    }
  }

  function watchForGradingButtons() {
    const again = findAgainButton();
    const buttonsPresent = !!again;

    // Only act at the exact transition from "no buttons" -> "buttons appeared".
    // This is the moment the user answered, so it's the only moment
    // `timedOut` should be trusted.
    if (buttonsPresent && !buttonsWerePresent) {
      clearTimer(); // stop the countdown now that an answer was given
      if (running && timedOut) {
        again.click();
      }
    }

    buttonsWerePresent = buttonsPresent;
  }

  function onAnswerDetected(args) {
    // Site logs something like: 0 'correct'  or  0 'incorrect'
    // Checking for "correct" as a substring covers both cases (since
    // "incorrect" also contains "correct"), which is all we need - either
    // one means an answer was just given, so stop the countdown now.
    const text = args.map((a) => {
      try {
        return typeof a === 'string' ? a : JSON.stringify(a);
      } catch (e) {
        return String(a);
      }
    }).join(' ').toLowerCase();

    if (text.includes('correct')) {
      if (DEBUG) console.debug('[helloquiz-timer] answer detected via console log, stopping timer');
      clearTimer();
    }
  }

  function installConsoleHook() {
    const originalLog = console.log.bind(console);
    console.log = function (...args) {
      originalLog(...args);
      try {
        onAnswerDetected(args);
      } catch (err) {
        /* swallow - never let our hook break the page's own logging */
      }
    };
  }

  const NAV_BUTTON_SYMBOLS = ['▶', '⇋', '→'];
  const DEBUG = true;

  function isNavButton(el) {
    if (!el || !el.textContent) return false;
    const text = el.textContent.trim();
    return NAV_BUTTON_SYMBOLS.some((sym) => text.includes(sym));
  }

  function onPossibleNavClick(e) {
    // Don't assume it's a <button>/<a> - icon-only controls are often a
    // plain <div>/<span> with a click handler. Walk up a few ancestors
    // checking each one's own trimmed text.
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

    if (DEBUG) {
      console.log('[helloquiz-timer] click target:', e.target,
        'textContent:', JSON.stringify(e.target.textContent),
        'outerHTML:', e.target.outerHTML,
        'nav match:', matched);
    }

    if (!matched) return;

    setTimeout(() => {
      if (DEBUG) console.log('[helloquiz-timer] forcing resync after nav click');
      currentQuestionText = '__forced_reset__' + Math.random();
      watchForNewQuestion();
    }, 250);
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
        // restart timer for current question with new duration
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

  function init() {
    makeControlPanel();
    installConsoleHook();
    document.addEventListener('click', onPossibleNavClick, true);
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
