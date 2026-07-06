// ==UserScript==
// @name         Additional HelloQuiz Anki Keys
// @namespace    http://tampermonkey.net/
// @version      2026-07-05
// @description  Additional keys for the Anik mode of helloquiz.app
// @author       Jakube
// @match        https://helloquiz.app/quiz/*?learn
// @match        https://helloquiz.app/learn
// @icon         https://www.google.com/s2/favicons?sz=64&domain=helloquiz.app
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Map each key to the symbol that identifies its button
    const KEY_SYMBOL_MAP = {
        '1': '▶', // practice more
        '2': '⇋', // select quiz
        '3': '→' // next quiz
    };

    document.addEventListener('keydown', function(e) {
        // Ignore if typing in an input, textarea, or contenteditable element
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;

        const symbol = KEY_SYMBOL_MAP[e.key];
        if (!symbol) return;

        const spans = document.querySelectorAll('span[class*="generic-quiz-module"][class*="expanded"]');

        spans.forEach(function(span) {
            const button = span.closest('button');
            if (button && button.textContent.includes(symbol)) {
                button.click();
            }
        });
    });

})();
