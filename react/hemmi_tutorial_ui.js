// Shared tutorial UI for Hemmi Versalog / Versalog II (Equation input, Generate, Replay, step controls).
// Depends: equation_parser.js, dynamic_tutorial_hemmi.js (generateDynamicTutorial, playDynamicLesson, dynamicTutorialState, step functions).
(function () {
  'use strict';

  var lastDynamicSteps = null;

  function onGenerateDynamicTutorial() {
    var input = document.getElementById('equation_input');
    var errEl = document.getElementById('equation_error');
    var areaEl = document.getElementById('equation_problem_area');
    if (!input) return;
    var eq = (input.value || '').trim();
    errEl.innerHTML = '';
    areaEl.innerHTML = '';
    if (!eq) {
      errEl.textContent = 'Enter an equation (e.g. 2*3/4, sqrt(16), or 10^-3).';
      return;
    }
    var parsed = equation_parser.parseEquation(eq);
    if (parsed.error) {
      errEl.textContent = parsed.message;
      if (parsed.start != null && parsed.end != null && parsed.end > parsed.start) {
        var before = eq.substring(0, parsed.start);
        var problem = eq.substring(parsed.start, parsed.end);
        var after = eq.substring(parsed.end);
        areaEl.innerHTML = 'Problem area: ' + escapeHtml(before) + '<span style="background: #ffcccc; text-decoration: underline;">' + escapeHtml(problem) + '</span>' + escapeHtml(after);
      }
      return;
    }
    var messageFn = (function (infoEl) {
      return function (msg) {
        if (infoEl) infoEl.innerHTML += (msg || '') + '<br />';
      };
    })(document.getElementById('info'));
    var result = window.generateDynamicTutorial(eq, messageFn);
    if (result.error) {
      errEl.textContent = result.message;
      return;
    }
    lastDynamicSteps = result.steps;
    document.getElementById('info').innerHTML = '';
    playDynamicLesson(result.steps, 'info', updateTutorialStepControls);
    updateTutorialStepControls();
  }

  function onReplayDynamicTutorial() {
    if (lastDynamicSteps && lastDynamicSteps.length) {
      document.getElementById('info').innerHTML = '';
      playDynamicLesson(lastDynamicSteps, 'info', updateTutorialStepControls);
      updateTutorialStepControls();
    } else {
      var errEl = document.getElementById('equation_error');
      if (errEl) errEl.textContent = 'Generate a tutorial first.';
    }
  }

  function updateTutorialStepControls() {
    var s = typeof dynamicTutorialState !== 'undefined' ? dynamicTutorialState : { steps: null, index: 0 };
    var steps = s.steps;
    var n = steps ? steps.length : 0;
    var i = s.index;
    var visCount = (typeof dynamicTutorialVisibleCount === 'function') ? dynamicTutorialVisibleCount(steps) : n;
    var visDone = (typeof dynamicTutorialCountVisibleBefore === 'function') ? dynamicTutorialCountVisibleBefore(steps, i) : i;
    var atFirstVisible = visDone <= 0;
    var atLastVisible = i >= n || (typeof dynamicTutorialNextVisibleIndex === 'function' && dynamicTutorialNextVisibleIndex(steps, i) >= n);
    var prevBtn = document.getElementById('tutorial_prev');
    var nextBtn = document.getElementById('tutorial_next');
    var playBtn = document.getElementById('tutorial_play');
    var pauseBtn = document.getElementById('tutorial_pause');
    var counterEl = document.getElementById('tutorial_step_counter');
    if (prevBtn) prevBtn.disabled = n === 0 || atFirstVisible;
    if (nextBtn) nextBtn.disabled = n === 0 || atLastVisible;
    if (playBtn) playBtn.disabled = n === 0 || i >= n;
    if (pauseBtn) pauseBtn.disabled = n === 0;
    if (counterEl) counterEl.textContent = visCount ? ('Step ' + visDone + ' of ' + visCount + ' (visible)') : 'Step 0 of 0';
  }

  function onTutorialStepBack() {
    if (typeof dynamicTutorialStepBack === 'function') dynamicTutorialStepBack();
    updateTutorialStepControls();
  }

  function onTutorialStepForward() {
    if (typeof dynamicTutorialStepForward === 'function') dynamicTutorialStepForward();
    updateTutorialStepControls();
  }

  function onTutorialPlay() {
    if (typeof dynamicTutorialPlay === 'function') dynamicTutorialPlay();
    updateTutorialStepControls();
  }

  function onTutorialPause() {
    if (typeof dynamicTutorialPause === 'function') dynamicTutorialPause();
    updateTutorialStepControls();
  }

  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateTutorialStepControls);
  } else {
    updateTutorialStepControls();
  }

  window.onGenerateDynamicTutorial = onGenerateDynamicTutorial;
  window.onReplayDynamicTutorial = onReplayDynamicTutorial;
  window.updateTutorialStepControls = updateTutorialStepControls;
  window.onTutorialStepBack = onTutorialStepBack;
  window.onTutorialStepForward = onTutorialStepForward;
  window.onTutorialPlay = onTutorialPlay;
  window.onTutorialPause = onTutorialPause;
  window.escapeHtml = escapeHtml;
})();
