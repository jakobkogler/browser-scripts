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
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const DEBUG = false;
  const NAV_BUTTON_SYMBOLS = ['▶', '⇋', '→'];
  const STORAGE_KEY = 'helloquiz-anki-timer-settings';

  // ---------- Persisted settings ----------

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* corrupted or unavailable - use defaults */ }
    return {};
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        seconds: TIMER_SECONDS,
        running: running,
      }));
    } catch (e) { /* storage unavailable - not critical */ }
  }

  const saved = loadSettings();
  let TIMER_SECONDS = typeof saved.seconds === 'number' && saved.seconds > 0 ? saved.seconds : 10;
  let running = typeof saved.running === 'boolean' ? saved.running : true;

  // ---------- State ----------

  let timerBar, timerBarWrap, timerInterval, timeoutHandle;
  let currentQuestionText = '';
  let currentQuizTitle = '';
  let timedOut = false;
  let buttonsWerePresent = false;
  let pendingReview = true; // start paused: first question waits for a click
  let overlayEl = null;

  // Timer bookkeeping for pause/resume on tab switch
  let timerDeadline = 0;      // Date.now() when timer would expire
  let pausedRemaining = null; // seconds left when paused, or null if not paused

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

  function findQuizTitleEl() {
    return document.querySelector('.quiz-module__HPadfW__titleText');
  }

  function findAgainButton() {
    const container = document.querySelector('.generic-quiz-module__m31QtG__controlButtonsAnki');
    if (!container) return null;
    return container.querySelector('button[title="1"]');
  }

  // ---------- Timer bar ----------

  function makeTimerBar(container) {
    // Remove any stale bar from a previous quiz's DOM first
    if (timerBarWrap && timerBarWrap.parentNode) {
      timerBarWrap.parentNode.removeChild(timerBarWrap);
    }

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
    timerBarWrap = wrap;
    return bar;
  }

  function clearTimer() {
    clearInterval(timerInterval);
    clearTimeout(timeoutHandle);
    timerInterval = null;
    timeoutHandle = null;
    pausedRemaining = null;
  }

  function resetBarIdle() {
    if (timerBar) {
      timerBar.style.width = '100%';
      timerBar.style.background = running ? 'orange' : '#999';
    }
  }

  function runCountdown(container, seconds) {
    // (Re)start the visual + timeout for `seconds` from now.
    clearInterval(timerInterval);
    clearTimeout(timeoutHandle);

    if (!timerBar || !document.body.contains(timerBar)) {
      timerBar = makeTimerBar(container);
    }

    timerDeadline = Date.now() + seconds * 1000;

    timerInterval = setInterval(() => {
      const remaining = Math.max(0, (timerDeadline - Date.now()) / 1000);
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
    }, seconds * 1000);
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

    timerBar.style.width = '100%';
    timerBar.style.background = 'orange';
    runCountdown(container, TIMER_SECONDS);
  }

  // ---------- Pause/resume on tab switch or window blur ----------

  function pauseTimer() {
    // Only pause if a countdown is actually active
    if (!timerInterval && !timeoutHandle) return;
    const remaining = (timerDeadline - Date.now()) / 1000;
    if (remaining > 0 && !timedOut) {
      pausedRemaining = remaining;
      clearInterval(timerInterval);
      clearTimeout(timeoutHandle);
      timerInterval = null;
      timeoutHandle = null;
      if (DEBUG) console.log('[helloquiz-timer] paused with', remaining.toFixed(1), 's remaining');
    }
  }

  function resumeTimer() {
    if (pausedRemaining === null || !running || overlayEl) return;
    const container = findMapContainer();
    if (container) {
      if (DEBUG) console.log('[helloquiz-timer] resuming with', pausedRemaining.toFixed(1), 's remaining');
      runCountdown(container, pausedRemaining);
    }
    pausedRemaining = null;
  }

  function onVisibilityChange() {
    if (document.hidden) {
      pauseTimer();
    } else {
      resumeTimer();
    }
  }

  function onWindowBlur() {
    // Fires when the window loses focus (e.g. alt-tab to another app),
    // which visibilitychange alone does NOT catch if the browser window
    // stays visible on screen.
    pauseTimer();
  }

  function onWindowFocus() {
    resumeTimer();
  }

  // ---------- Question hiding (CSS-based, flash-free) ----------

  // A class on <html> + stylesheet rule hides the question content. The
  // class is applied at document-start, BEFORE the page renders anything,
  // so the question is never visible even on a fresh page load. Using
  // <html> instead of <body> because <body> doesn't exist yet at
  // document-start.

  const HIDE_CLASS = 'hq-timer-hide-question';

  function installHideStyle() {
    const style = document.createElement('style');
    style.textContent = `
      html.${HIDE_CLASS} .quiz-module__HPadfW__content {
        visibility: hidden !important;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function hideQuestion() {
    document.documentElement.classList.add(HIDE_CLASS);
  }

  function showQuestion() {
    document.documentElement.classList.remove(HIDE_CLASS);
  }

  // Apply immediately at document-start, before first render
  installHideStyle();
  hideQuestion();

  // ---------- Review pause (after wrong answer) ----------

  function markPendingReview(reason) {
    pendingReview = true;
    // Hide immediately so the next question text is never visible,
    // even for a frame.
    hideQuestion();
    if (DEBUG) console.log('[helloquiz-timer] pending review (' + reason + '), will pause before next timer start');
  }

  function showReviewOverlay(container) {
    hideReviewOverlay();
    if (!container) return;

    // Hide the question text so the next answer isn't revealed
    hideQuestion();

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
    showQuestion();
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
    // Only check string args — skip objects to avoid expensive serialization
    for (let i = 0; i < args.length; i++) {
      if (typeof args[i] !== 'string') continue;
      const s = args[i].toLowerCase();
      if (s === 'incorrect') {
        clearTimer();
        markPendingReview('incorrect answer');
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

  function fullReset(reason) {
    if (DEBUG) console.log('[helloquiz-timer] full reset (' + reason + ')');
    clearTimer();
    hideReviewOverlay();
    timedOut = false;
    buttonsWerePresent = false;
    // Drop stale bar references so a fresh one gets created in the new DOM
    if (timerBarWrap && timerBarWrap.parentNode) {
      timerBarWrap.parentNode.removeChild(timerBarWrap);
    }
    timerBar = null;
    timerBarWrap = null;
    // New quiz starts paused too: wait for a click before showing the
    // question and starting the timer.
    markPendingReview('quiz start');
    // Force question re-detection
    currentQuestionText = '__forced_reset__' + Math.random();
  }

  function watchForQuizChange() {
    const titleEl = findQuizTitleEl();
    const title = titleEl ? titleEl.textContent : '';
    if (title !== currentQuizTitle) {
      const isFirst = currentQuizTitle === '';
      currentQuizTitle = title;
      if (!isFirst) {
        fullReset('quiz changed to "' + title + '"');
      }
    }
  }

  // ---------- Instant SPA navigation detection ----------

  // The 200ms poll is too slow to hide the question when navigating
  // between pages (e.g. from the /learn list into a quiz): the new
  // question renders before the poll notices the change. pushState fires
  // synchronously at the moment of the click, BEFORE the new content
  // renders, so hooking it lets us hide/reset with zero visible flash.

  let lastUrl = location.href;

  function onUrlChange() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    fullReset('url changed to ' + location.pathname);
  }

  function installHistoryHook() {
    ['pushState', 'replaceState'].forEach((fnName) => {
      const orig = history[fnName].bind(history);
      history[fnName] = function (...args) {
        const ret = orig(...args);
        try { onUrlChange(); } catch (e) { /* never break navigation */ }
        return ret;
      };
    });
    window.addEventListener('popstate', onUrlChange);
  }

  function watchForNewQuestion() {
    const qEl = findQuestionEl();
    const container = findMapContainer();
    if (!qEl || !container) return;

    if (qEl.textContent !== currentQuestionText) {
      currentQuestionText = qEl.textContent;
      // Don't assume no buttons are present - the previous question's
      // grading buttons can still be mid-fade-out in the DOM right as the
      // next question renders.
      buttonsWerePresent = !!findAgainButton();

      if (running && pendingReview) {
        const quizContainer = findQuizContainer() || container;
        showReviewOverlay(quizContainer);
      } else {
        // Timer disabled or no review pending: make sure the question is
        // visible (otherwise a pendingReview set while stopped would keep
        // it hidden with no overlay to dismiss).
        pendingReview = false;
        showQuestion();
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
        markPendingReview('timeout');
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

    if (!matched) return;
    if (DEBUG) console.log('[helloquiz-timer] nav button matched:', matched.textContent.trim());

    setTimeout(() => {
      hideReviewOverlay();
      // Navigation (next question preview / next quiz / practice more)
      // also starts paused: wait for a click before revealing the question.
      markPendingReview('nav');
      currentQuestionText = '__forced_reset__' + Math.random();
      watchForNewQuestion();
    }, 250);
  }

  // ---------- Again-button detection ----------

  function onPossibleAgainClick(e) {
    const btn = e.target.closest && e.target.closest('button[title="1"]');
    if (btn) {
      markPendingReview('again clicked');
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
    // typing into the timer seconds field would falsely trigger this).
    if (e.key !== '1') return;
    if (overlayEl) return;
    const tag = (document.activeElement || {}).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (!findAgainButton()) return;

    markPendingReview('again key');
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
        saveSettings();
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
      saveSettings();
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
    installHistoryHook();
    document.addEventListener('click', onPossibleNavClick, true);
    document.addEventListener('click', onPossibleAgainClick, true);
    document.addEventListener('keydown', onOverlayKeydown, true);
    document.addEventListener('keydown', onAgainKeydown, true);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('focus', onWindowFocus);
    setInterval(() => {
      watchForQuizChange();
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
