///////////////////////////////////////////////////////////////////////////////////
// Dynamic tutorial generator for Hemmi Versalog II.
// Converts a parsed equation (AST + value) into tutorial steps.
// Depends: equation_parser.js, sliderule_ctrl.js, crnu/rndlist from construction kit.
///////////////////////////////////////////////////////////////////////////////////

(function () {
  'use strict';

  var evaluate = window.equation_parser && window.equation_parser.evaluate;
  var parseEquation = window.equation_parser && window.equation_parser.parseEquation;
  var profile = window.hemmiRuleProfile || { hasA: true, scaleL: 'LogX     L' };

  function toMantissa(x) {
    if (x === 0) return { m: 1, exp: -100 };
    var exp = Math.floor(Math.log10(Math.abs(x)));
    var m = x / Math.pow(10, exp);
    if (m >= 10) { m /= 10; exp += 1; }
    if (m < 1 && m > 0) { m *= 10; exp -= 1; }
    return { m: crnu(m), exp: exp }; // crnu = decimal places for mantissa; display uses formatSigFig
  }

  function flattenOps(ast, out) {
    if (!ast || !out) return null;
    if (ast.type === 'number') {
      out.push({ op: 'init', value: ast.value });
      return ast.value;
    }
    if (ast.type === 'name') {
      out.push({ op: 'init', value: ast.value });
      return ast.value;
    }
    if (ast.type === 'unary_minus') {
      var v = flattenOps(ast.arg, out);
      if (v === null) return null;
      return -v;
    }
    if (ast.type === 'call') {
      var argVal = flattenOps(ast.arg, out);
      if (argVal === null) return null;
      var res = evaluate(ast);
      if (res !== res) return null;
      out.push({ op: ast.fn, arg: argVal, result: res });
      return res;
    }
    if (ast.type === 'binary') {
      var leftVal = flattenOps(ast.left, out);
      if (leftVal === null) return null;
      var rightVal = flattenOps(ast.right, out);
      if (rightVal === null) return null;
      var result = evaluate(ast);
      if (result !== result) return null;
      out.push({ op: ast.op, left: leftVal, right: rightVal, result: result });
      return result;
    }
    return null;
  }

  function emitSteps(ops, finalResult, equationStr, message) {
    var steps = [];
    var delayMsg = 2000;
    var delayAction = 1500;
    var delayObj = 6000;
    /** Slide rule precision: at most 4 significant figures display, 3 for final/read results. */
    var PREC = 4;
    var PREC_FINAL = 3;
    /** Format a number with n significant figures for display (crnu uses decimal places, not sig figs). */
    function formatSigFig(x, n) {
      if (x === 0 || !isFinite(x)) return String(x);
      return String(Number(Number(x).toPrecision(n)));
    }
    var currentMantissa = null;
    var currentExp = 0;
    var sidesUsed = { front: false, back: false };
    var lastWasBack = false;
    var lastResultOnD = true;
    var lastWasFinalSqrt = false;
    /** After sqrt on R1/R2 (no A scale), cursor does not "hold" the value; next multiply must re-enter it. */
    var lastResultFromRScale = false;
    /** After CI multiply, result is under the right index; next multiply can be done by cursor to C only (no slide move). */
    var lastMultiplyWasCI = false;

    /** Exponent log scratchpad: reason for last change (shown at end of every instruction). */
    var exponentLogReason = '\u2014';
    /** Capture current exponent state and return an action that shows that state for this step only. */
    function displayMessageWithExponent(t) {
      var _exp = currentExp;
      var _reason = exponentLogReason;
      return function () {
        message(t + ' \u2016 Exponent log: ' + _exp + (_reason ? ' \u2014 ' + _reason : ''));
      };
    }

    // ——— Rule book: body limits, scale positions, division/mult and index choice ———
    // CI multiply: cursor at first factor on D, slide so second factor on CI is under cursor.
    // Slide target = log10(a) + log10(b) - 1. Left index at body position = target, right at target+1. Pick the index that is on scale (inRange).
    function whichIndexCIMultiply(firstFactor, secondFactor) {
      var slideTarget = Math.log10(firstFactor) + Math.log10(secondFactor) - 1;
      return whichIndex(slideTarget, firstFactor * secondFactor);
    }
    var limitL = 0.03;
    var limitR = 0.03;
    function positionC(shift, x) { return shift + Math.log10(x); }
    function positionCI(shift, x) { return shift + (1 - Math.log10(x)); }
    function positionCIF(shift, x) { return shift + (1 - Math.log10(x * Math.PI)); }
    function inRange(pos) { return pos >= -limitL && pos <= 1 + limitR; }
    function chooseDivisionMethod(chainSlideShift, divisorM) {
      if (chainSlideShift == null) return 'C';
      if (inRange(positionCI(chainSlideShift, divisorM))) return 'CI';
      if (inRange(positionCIF(chainSlideShift, divisorM))) return 'CIF';
      return 'C';
    }
    function whichIndex(slideShift, quotM) {
      var leftOnBody = inRange(slideShift);
      var rightOnBody = inRange(slideShift + 1);
      if (leftOnBody && rightOnBody) return (quotM >= 1) ? 1 : 10;
      if (rightOnBody) return 10;
      if (leftOnBody) return 1;
      return (slideShift + 0.5 >= 0) ? 10 : 1;
    }
    function squareRootHalf(x) {
      if (x <= 0) return 'left';
      var e = Math.floor(Math.log10(x));
      return (e % 2 === 0) ? 'left' : 'right';
    }
    /** Number of digits to the left of the decimal (for R1 vs R2: odd → R1, even → R2). */
    function digitsLeftOfDecimal(x) {
      if (x <= 0 || !isFinite(x)) return 0;
      x = Math.abs(x);
      var intPart = Math.floor(x);
      if (intPart === 0) return 0;
      return Math.floor(Math.log10(intPart)) + 1;
    }
    function cubeRootThird(x) {
      if (x <= 0) return 0;
      var e = Math.floor(Math.log10(x));
      return ((e % 3) + 3) % 3;
    }

    function ensureFront() {
      if (!sidesUsed.front) {
        sidesUsed.front = true;
        steps.push({ action: function () { ensureSide(['C', 'D']); }, delay: 100 });
      }
    }
    function ensureFrontWithCI() {
      if (!sidesUsed.front) {
        sidesUsed.front = true;
        steps.push({ action: function () { ensureSide(['C', 'D', 'CI']); }, delay: 100 });
      }
    }
    function isDivisionChain(ops) {
      for (var j = 0; j < ops.length; j++) {
        if (ops[j].op !== 'init') return ops[j].op === '/';
      }
      return false;
    }
    function ensureBack() {
      if (!sidesUsed.back) {
        sidesUsed.back = true;
        steps.push({ action: function () { ensureSide(['S', 'D']); }, delay: 100 });
      }
    }

    function stepInit(op, useRightIndex) {
      var v = op.value;
      var man = toMantissa(v);
      var dVal = man.m;
      currentMantissa = man.m;
      currentExp = man.exp;
      exponentLogReason = 'first factor ' + formatSigFig(man.m, PREC) + '\u00d710^' + man.exp;
      lastWasBack = false;
      lastResultOnD = true;
      ensureFront();
      var cIndex = (useRightIndex === true) ? 10 : 1;
      var indexLabel = (useRightIndex === true) ? 'right index (10)' : 'left index (1)';
      var indexReason = (useRightIndex === true) ? ' (Product will be over 10; use right index so the result stays on the D scale.)' : '';
      steps.push({ action: displayMessageWithExponent('Calculate: ' + equationStr), delay: 500 });
      steps.push({ action: function () { undimScales(['C', 'D']); changeMarkings('hairline', true); }, delay: 500 });
      steps.push({ action: displayMessageWithExponent('First factor is ' + formatSigFig(v, PREC) + '. Move the slide so the ' + indexLabel + ' on C is over ' + formatSigFig(v, PREC) + ' on the D scale.' + indexReason), delay: delayMsg });
      steps.push({ action: function () {
        if (typeof changeSide === 'function') changeSide('front');
        ensureSide(['C', 'D']);
        cursorTo('D', dVal);
        slideTo('C', cIndex);
      }, delay: delayAction });
    }

    function stepInitForDivision(op) {
      var v = op.value;
      var man = toMantissa(v);
      var dVal = man.m;
      currentMantissa = man.m;
      currentExp = man.exp;
      exponentLogReason = 'dividend ' + formatSigFig(man.m, PREC) + '\u00d710^' + man.exp;
      lastWasBack = false;
      lastResultOnD = true;
      ensureFront();
      steps.push({ action: displayMessageWithExponent('Calculate: ' + equationStr), delay: 500 });
      steps.push({ action: function () { undimScales(['C', 'D']); changeMarkings('hairline', true); }, delay: 500 });
      steps.push({ action: displayMessageWithExponent('Division chain: set the dividend. Move the cursor to ' + formatSigFig(v, PREC) + ' on the D scale.'), delay: delayMsg });
      steps.push({ action: function () {
        if (typeof changeSide === 'function') changeSide('front');
        ensureSide(['C', 'D']);
        cursorTo('D', dVal);
      }, delay: delayAction });
    }

    function stepMultiply(op) {
      if (lastWasBack) {
        ensureFront();
        var transferVal = currentMantissa;
        var actualVal = op.left;
        var resultWasOnD = lastResultOnD;
        steps.push({
          action: (function (_exp, _reason) {
            return function () {
              var noFlip = typeof currentSideHasScales === 'function' && currentSideHasScales(['C', 'D']);
              var msg;
              if (resultWasOnD) {
                msg = noFlip
                  ? 'The cursor is linked—it is already at the correct position. The value you are multiplying is ' + formatSigFig(actualVal, PREC) + ' (mantissa ' + formatSigFig(transferVal, PREC) + ' on D). C and D are on this side; no need to flip.'
                  : 'Flip the rule to the front. The cursor is linked—it is already at the correct position. The value you are multiplying is ' + formatSigFig(actualVal, PREC) + ' (mantissa ' + formatSigFig(transferVal, PREC) + ' on D).';
              } else {
                msg = noFlip
                  ? 'Move the cursor to the result found on the L scale (' + formatSigFig(actualVal, PREC) + ') to the D scale (' + formatSigFig(transferVal, PREC) + '). C and D are on this side; no need to flip.'
                  : 'Flip the rule to the front. Move the cursor to the result found on the L scale (' + formatSigFig(actualVal, PREC) + ') to the D scale (' + formatSigFig(transferVal, PREC) + ').';
              }
              message(msg + ' \u2016 Exponent log: ' + _exp + (_reason ? ' \u2014 ' + _reason : ''));
            };
          })(currentExp, exponentLogReason),
          delay: delayMsg
        });
        steps.push({
          action: function () {
            if (typeof currentSideHasScales === 'function' && !currentSideHasScales(['C', 'D']) && typeof changeSide === 'function') changeSide('front');
            ensureSide(['C', 'D']);
            cursorTo('D', transferVal);
          },
          delay: delayAction
        });
        lastWasBack = false;
      }
      var a, b, cursorCVal, firstFactor, afterRScaleSqrt = false;
      if (lastResultFromRScale && !profile.hasA) {
        afterRScaleSqrt = true;
        lastResultFromRScale = false;
        firstFactor = currentMantissa;
        a = firstFactor;
        b = op.right;
        cursorCVal = toMantissa(b).m;
      } else {
        a = currentMantissa;
        b = op.right;
        cursorCVal = toMantissa(b).m;
        firstFactor = a;
      }
      var manB = toMantissa(b);
      var prod = op.result;
      var manProd = toMantissa(prod);
      var prodMsg = formatSigFig(prod, PREC_FINAL);
      currentMantissa = manProd.m;
      lastResultOnD = true;
      ensureFront();
      currentExp = manProd.exp;
      exponentLogReason = 'multiply by ' + formatSigFig(manB.m, PREC) + '\u00d710^' + manB.exp;
      if (lastMultiplyWasCI) {
        lastMultiplyWasCI = false;
        var productOnScale = (prod >= 1 && prod < 10);
        if (productOnScale) {
          steps.push({ action: function () { undimScales(['C', 'D']); changeMarkings('hairline', true); }, delay: 500 });
          steps.push({ action: displayMessageWithExponent('Result is under the index. Move the cursor to ' + formatSigFig(cursorCVal, PREC) + ' on the C scale. Read the product on D under the cursor.'), delay: delayMsg });
          steps.push({ action: function () {
            if (typeof currentSideHasScales === 'function' && !currentSideHasScales(['C', 'D']) && typeof changeSide === 'function') changeSide('front');
            ensureSide(['C', 'D']);
            cursorTo('C', cursorCVal);
          }, delay: delayAction });
          steps.push({ action: displayMessageWithExponent('Read intermediate result ' + prodMsg + ' on D.'), delay: delayMsg });
          return;
        }
      }
      var shiftLeft = Math.log10(a);
      var shiftRight = Math.log10(a) - 1;
      var useCF = false;
      var useRightIndex = false;
      if (inRange(positionC(shiftLeft, cursorCVal))) {
        useRightIndex = false;
      } else if (inRange(positionC(shiftRight, cursorCVal))) {
        useRightIndex = true;
      } else {
        useCF = true;
      }
      exponentLogReason = 'multiply by ' + formatSigFig(manB.m, PREC) + '\u00d710^' + manB.exp + (useRightIndex ? ' + 1 (index shift: slide left)' : '');
      var cIndex = useRightIndex ? 10 : 1;
      var rScaleCursorMsg = afterRScaleSqrt ? ('Move the cursor to ' + formatSigFig(cursorCVal, PREC_FINAL) + ' on the C scale (the second factor).') : null;
      var useCI = resultWasOnD && !afterRScaleSqrt;
      if (useCI) {
        lastMultiplyWasCI = true;
        exponentLogReason = 'multiply by ' + formatSigFig(manB.m, PREC) + '\u00d710^' + manB.exp;
        var ciMultiplyIndex = whichIndexCIMultiply(firstFactor, cursorCVal);
        var ciIndexLabel = (ciMultiplyIndex === 10) ? 'right index (10)' : 'left index (1)';
        steps.push({ action: function () { undimScales(['C', 'D', 'CI']); changeMarkings('hairline', true); }, delay: 500 });
        steps.push({ action: displayMessageWithExponent('First factor is already on D (under the cursor). Without moving the cursor, move the slide so ' + formatSigFig(cursorCVal, PREC) + ' on the CI scale is under the cursor. Read the product on D under the ' + ciIndexLabel + '.'), delay: delayMsg });
        steps.push({
          action: (function (tVal, cVal, idx) {
            return function () {
              if (typeof currentSideHasScales === 'function' && !currentSideHasScales(['C', 'D', 'CI']) && typeof changeSide === 'function') changeSide('front');
              ensureSide(['C', 'D', 'CI']);
              cursorTo('D', tVal);
              slideTo('CI', cVal);
              cursorTo('C', idx);
            };
          })(transferVal, cursorCVal, ciMultiplyIndex),
          delay: delayAction
        });
        steps.push({ action: displayMessageWithExponent('Read intermediate result ' + prodMsg + ' on D under the ' + ciIndexLabel + '.'), delay: delayMsg });
      } else if (useCF) {
        lastMultiplyWasCI = false;
        steps.push({ action: function () { undimScales(['CF', 'DF']); changeMarkings('hairline', true); }, delay: 500 });
        steps.push({ action: displayMessageWithExponent('Second factor ' + formatSigFig(cursorCVal, PREC) + ' would be off C; use folded scales. Set cursor to ' + formatSigFig(firstFactor, PREC) + ' on DF, align index on CF, then cursor to ' + formatSigFig(cursorCVal, PREC) + ' on CF and read product on DF.'), delay: delayMsg });
        steps.push({ action: function () {
          if (typeof currentSideHasScales === 'function' && !currentSideHasScales(['CF', 'DF']) && typeof changeSide === 'function') changeSide('front');
          ensureSide(['CF', 'DF']);
          cursorTo('DF', firstFactor);
        }, delay: delayAction });
        steps.push({ action: function () { slideTo('CF', 1); }, delay: delayAction });
        steps.push({ action: function () { cursorTo('CF', cursorCVal); }, delay: delayAction });
        steps.push({ action: displayMessageWithExponent('Read intermediate result ' + prodMsg + ' on DF.'), delay: delayMsg });
      } else {
        lastMultiplyWasCI = false;
        steps.push({ action: function () { undimScales(['C', 'D']); changeMarkings('hairline', true); }, delay: 500 });
        var msgSetSlide = (useRightIndex ? 'Move the slide so the right index (10) on C is over ' : (afterRScaleSqrt ? 'Set the first factor: move the slide so the left index (1) on C is over ' : 'Move the slide so the left index (1) on C is over ')) + formatSigFig(firstFactor, PREC) + ' on the D scale.';
        var msgCursor = rScaleCursorMsg || ('Move the cursor to ' + formatSigFig(cursorCVal, PREC) + ' on the C scale.');
        steps.push({ action: displayMessageWithExponent(msgSetSlide), delay: delayMsg });
        steps.push({ action: function () {
          if (typeof currentSideHasScales === 'function' && !currentSideHasScales(['C', 'D']) && typeof changeSide === 'function') changeSide('front');
          ensureSide(['C', 'D']);
          cursorTo('D', firstFactor);
        }, delay: delayAction });
        steps.push({ action: function () { slideTo('C', cIndex); }, delay: delayAction });
        steps.push({ action: displayMessageWithExponent(msgCursor), delay: delayMsg });
        steps.push({ action: function () { cursorTo('C', cursorCVal); }, delay: delayAction });
        var readMsg = afterRScaleSqrt ? ('Read result ' + formatSigFig(prod, PREC_FINAL) + ' on D.') : ('Read intermediate result ' + prodMsg + ' on D.' + (useRightIndex ? ' (Adjust decimal: result is ' + prodMsg + '.)' : ''));
        steps.push({ action: displayMessageWithExponent(readMsg), delay: delayMsg });
      }
    }

    // Division: CI/CIF shortcut only when cursor is AT THE INDEX (result under index).
    // After using CI/CIF, cursor is over the quotient on D (not at index); next division must move the slide.
    function stepDivide(op, divisionIndexInChain, inDivisionChain, chainSlideShift, cursorAtIndex) {
      var divisor = op.right;
      var dividend = (op.left != null && op.left !== undefined) ? toMantissa(op.left).m : currentMantissa;
      if (lastWasBack) {
        ensureFront();
        var transferVal = dividend;
        steps.push({
          action: (function (_exp, _reason) {
            return function () {
              var msg = (typeof currentSideHasScales === 'function' && currentSideHasScales(['C', 'D']))
                ? 'Set cursor to ' + formatSigFig(transferVal, PREC) + ' on D (C and D are on this side; no need to flip).'
                : 'Result so far is on the other side. Switch to front and set cursor to ' + formatSigFig(transferVal, PREC) + ' on D.';
              message(msg + ' \u2016 Exponent log: ' + _exp + (_reason ? ' \u2014 ' + _reason : ''));
            };
          })(currentExp, exponentLogReason),
          delay: delayMsg
        });
        steps.push({
          action: function () {
            if (typeof currentSideHasScales === 'function' && !currentSideHasScales(['C', 'D']) && typeof changeSide === 'function') changeSide('front');
            ensureSide(['C', 'D']);
            cursorTo('D', transferVal);
          },
          delay: delayAction
        });
        lastWasBack = false;
      }
      var manDiv = toMantissa(divisor);
      var quot = op.result;
      var manQuot = toMantissa(quot);
      var divisorM = manDiv.m;
      var quotMsg = formatSigFig(quot, PREC_FINAL);
      currentMantissa = manQuot.m;
      lastResultOnD = true;
      var newSlideShift = Math.log10(dividend) - Math.log10(divisorM);

      var useCIorCIF = (inDivisionChain && divisionIndexInChain > 0 && cursorAtIndex &&
        chooseDivisionMethod(chainSlideShift, divisorM));
      var method = (useCIorCIF === 'CI' || useCIorCIF === 'CIF') ? useCIorCIF : 'C';

      if (method === 'CI') {
        currentExp = manQuot.exp;
        exponentLogReason = 'divide by ' + formatSigFig(manDiv.m, PREC) + '\u00d710^' + manDiv.exp;
        ensureFrontWithCI();
        steps.push({ action: function () { undimScales(['C', 'D', 'CI']); changeMarkings('hairline', true); }, delay: 500 });
        steps.push({ action: displayMessageWithExponent('Divide by ' + formatSigFig(divisor, PREC) + ': Move the cursor to ' + formatSigFig(divisorM, PREC) + ' on the CI scale. Read the intermediate result (' + quotMsg + ') on the D scale under the cursor.'), delay: delayMsg });
        steps.push({ action: function () { ensureSide(['C', 'D', 'CI']); cursorTo('CI', divisorM); }, delay: delayAction });
        return { slideShift: chainSlideShift, cursorAtIndex: false };
      }
      if (method === 'CIF') {
        currentExp = manQuot.exp;
        exponentLogReason = 'divide by ' + formatSigFig(manDiv.m, PREC) + '\u00d710^' + manDiv.exp;
        ensureFrontWithCI();
        steps.push({ action: function () { undimScales(['C', 'D', 'CI', 'CIF', 'DF']); changeMarkings('hairline', true); }, delay: 500 });
        steps.push({ action: displayMessageWithExponent('Divide by ' + formatSigFig(divisor, PREC) + ': Move the cursor to ' + formatSigFig(divisorM, PREC) + ' on the CIF scale. Read the intermediate result (' + quotMsg + ') on the D scale under the cursor.'), delay: delayMsg });
        steps.push({ action: function () { ensureSide(['C', 'D', 'CI', 'CIF', 'DF']); cursorTo('CIF', divisorM); }, delay: delayAction });
        return { slideShift: chainSlideShift, cursorAtIndex: false };
      }

      ensureFront();
      steps.push({ action: function () { undimScales(['C', 'D']); changeMarkings('hairline', true); }, delay: 500 });
      var readIndex = whichIndex(newSlideShift, manQuot.m);
      currentExp = manQuot.exp;
      exponentLogReason = 'divide by ' + formatSigFig(manDiv.m, PREC) + '\u00d710^' + manDiv.exp + (readIndex === 10 ? ' \u22121 (index shift: slide left)' : '');
      var indexLabel = (readIndex === 10) ? 'right index (10)' : 'left index (1)';
      if (inDivisionChain && divisionIndexInChain > 0) {
        if (cursorAtIndex) {
          steps.push({ action: displayMessageWithExponent('Divide by ' + formatSigFig(divisor, PREC) + ': Move the slide so ' + formatSigFig(divisorM, PREC) + ' on the C scale is under the cursor. The intermediate result (' + quotMsg + ') is now located on the D scale under the slide index.'), delay: delayMsg });
        } else {
          steps.push({ action: displayMessageWithExponent('Divide by ' + formatSigFig(divisor, PREC) + ': You must move the slide to continue the chain. Move the slide so the index (or ' + formatSigFig(divisorM, PREC) + ' on the C scale) is aligned with the previous result (' + formatSigFig(dividend, PREC) + ') on the D scale. The new result (' + quotMsg + ') will be found under the slide index on the D scale.'), delay: delayMsg });
        }
      } else {
        steps.push({ action: displayMessageWithExponent('Divide by ' + formatSigFig(divisor, PREC) + ': Move the slide so ' + formatSigFig(divisorM, PREC) + ' on the C scale is under the cursor. The intermediate result (' + quotMsg + ') is now located on the D scale under the slide index.'), delay: delayMsg });
      }
      steps.push({ action: function () { slideTo('C', divisorM); }, delay: delayAction });
      steps.push({ action: function () { cursorTo('C', readIndex); }, delay: delayAction });
      steps.push({ action: displayMessageWithExponent((inDivisionChain ? 'Intermediate result (' : 'Result (') + quotMsg + ') on the D scale under the ' + indexLabel + '.'), delay: delayMsg });
      return { slideShift: newSlideShift, cursorAtIndex: true };
    }

    // Which LL scale (LL1, LL2, LL3) contains value > 1? LL1: e^0.01..e^0.1, LL2: e^0.1..e, LL3: e..e^10.
    function llScaleForValue(value) {
      if (value <= 0 || value <= 1) return null;
      var ln = Math.log(value);
      if (ln <= 0.1) return 'LL1';
      if (ln <= 1) return 'LL2';
      if (ln <= 10) return 'LL3';
      return null;
    }

    // Which "down" LL scale (Versalog: LL02, LL03, etc.) contains 0 < value < 1?
    // Versalog: LL02 ~ e^-0.1 to e^-1 (≈0.9–0.37), LL03 ~ e^-1 to e^-10 (≈0.37–0.00005). 0.3 is on LL02, 0.0081 on LL03.
    function llDownScaleForValue(value) {
      if (value <= 0 || value >= 1) return null;
      var x = -Math.log(value);
      if (x >= 0.1 && x < 1.25) return 'LL02';   // base e.g. 0.3 (x≈1.2) on LL02
      if (x >= 1.25 && x <= 10) return 'LL03';   // result e.g. 0.0081 (x≈4.8) on LL03
      if (x >= 0.01 && x < 0.1) return 'LL01';
      if (x >= 0.001 && x < 0.01) return 'LL00';
      if (x > 10) return 'LL03';
      if (x > 0 && x < 0.001) return 'LL00';
      return 'LL03';
    }

    // Find the actual scale.left of an LL-type scale that contains the value (for cursorTo).
    function findLLScaleNameForValue(value) {
      var list = (typeof sliderules !== 'undefined' && sliderules.sliderules) ? sliderules.sliderules : (window.sliderules && window.sliderules.sliderules);
      if (!list) return null;
      for (var i = 0; i < list.length; i++) {
        var sr = list[i];
        for (var r in sr.rules) {
          var rule = sr.rules[r];
          for (var s in rule.scales) {
            var scale = rule.scales[s];
            var left = scale.left;
            if (left && (left === 'LL1' || left === 'LL2' || left === 'LL3' || left.indexOf('LL2') >= 0 || left.indexOf('LL3') >= 0 || left.indexOf('LL1') >= 0) && typeof scale.location === 'function') {
              try {
                var loc = scale.location(value);
                if (loc >= -0.02 && loc <= 1.02) return left;
              } catch (e) {}
            }
          }
        }
      }
      return null;
    }

    // Find scale name for 0 < value < 1 (LL03, LL02, LL01, LL00 or Hemmi LL/3, LL/2, LL/1 "down" scales).
    // Only consider scales whose left suggests an LL "down" scale (e.g. LL03 or LL/3), not the linear L scale.
    function isLLDownScaleLeft(left) {
      if (!left || typeof left !== 'string') return false;
      return left.indexOf('LL0') >= 0 || left.indexOf('LL/') >= 0;
    }
    function findLLDownScaleNameForValue(value) {
      if (value <= 0 || value >= 1) return null;
      var list = (typeof sliderules !== 'undefined' && sliderules.sliderules) ? sliderules.sliderules : (window.sliderules && window.sliderules.sliderules);
      if (!list) return null;
      for (var i = 0; i < list.length; i++) {
        var sr = list[i];
        for (var r in sr.rules) {
          var rule = sr.rules[r];
          for (var s in rule.scales) {
            var scale = rule.scales[s];
            var left = scale.left;
            if (left && isLLDownScaleLeft(left) && typeof scale.location === 'function') {
              try {
                var loc = scale.location(value);
                if (loc >= -0.02 && loc <= 1.02) return left;
              } catch (e) {}
            }
          }
        }
      }
      return null;
    }

    function stepPower(op) {
      var base = op.left;
      var exp = op.right;
      var result = op.result;
      var manBase = toMantissa(base);
      var manResult = toMantissa(result);
      currentMantissa = manResult.m;
      if (exp === 2) {
        ensureFront();
        if (profile.hasA) {
          steps.push({ action: function () { ensureSide(['A', 'D']); sidesUsed.front = true; }, delay: 100 });
          steps.push({ action: function () { undimScales(['A', 'D']); changeMarkings('hairline', true); }, delay: 500 });
          steps.push({ action: displayMessageWithExponent('Square: cursor to ' + formatSigFig(manBase.m, PREC) + ' on D, read ' + formatSigFig(result, PREC_FINAL) + ' on A.'), delay: delayMsg });
          steps.push({ action: function () { cursorTo('D', manBase.m); }, delay: delayAction });
          steps.push({ action: displayMessageWithExponent('Read result on A scale: ' + formatSigFig(result, PREC_FINAL)), delay: delayMsg });
        } else {
          var nDigitsSq = digitsLeftOfDecimal(result);
          var useR1Sq = (nDigitsSq % 2 === 1);
          var rScaleSq = useR1Sq ? 'R1' : 'R2';
          var rHintSq = useR1Sq ? 'Odd number of digits in result → use R1.' : 'Even number of digits in result → use R2.';
          steps.push({ action: function () { ensureSide(['R1', 'R2', 'D']); sidesUsed.front = true; }, delay: 100 });
          steps.push({ action: function () { undimScales(['R1', 'R2', 'D']); changeMarkings('hairline', true); }, delay: 500 });
          steps.push({ action: displayMessageWithExponent('Square: cursor to ' + formatSigFig(manBase.m, PREC) + ' on D, read ' + formatSigFig(result, PREC_FINAL) + ' on ' + rScaleSq + '. ' + rHintSq), delay: delayMsg });
          steps.push({ action: function () { cursorTo('D', manBase.m); }, delay: delayAction });
          steps.push({ action: displayMessageWithExponent('Read result on ' + rScaleSq + ' scale: ' + formatSigFig(result, PREC_FINAL)), delay: delayMsg });
        }
        currentExp = currentExp * 2;
        exponentLogReason = 'square: exponent \u00d7 2';
        lastResultOnD = false;
      } else if (exp === 0.5) {
        ensureFront();
        if (profile.hasA) {
          var half = squareRootHalf(base);
          var aVal = half === 'left' ? manBase.m : manBase.m * 10;
          steps.push({ action: function () { ensureSide(['A', 'D']); sidesUsed.front = true; }, delay: 100 });
          steps.push({ action: function () { undimScales(['A', 'D']); changeMarkings('hairline', true); }, delay: 500 });
          steps.push({ action: displayMessageWithExponent('Square root: use ' + half + ' half of A (exponent ' + (half === 'left' ? 'even' : 'odd') + '). Cursor to ' + formatSigFig(base, PREC) + ' on A, read ' + formatSigFig(result, PREC_FINAL) + ' on D.'), delay: delayMsg });
          steps.push({ action: function () { cursorTo('A', aVal); }, delay: delayAction });
          steps.push({ action: displayMessageWithExponent('Read result on D scale: ' + formatSigFig(result, PREC_FINAL)), delay: delayMsg });
        } else {
          var nDigitsSqrtPow = digitsLeftOfDecimal(base);
          var useR1SqrtPow = (nDigitsSqrtPow % 2 === 1);
          var rScaleSqrtPow = useR1SqrtPow ? 'R1' : 'R2';
          var rHintSqrtPow = useR1SqrtPow ? 'Odd number of digits to the left of the decimal → use R1.' : 'Even number of digits to the left of the decimal → use R2.';
          steps.push({ action: function () { ensureSide(['R1', 'R2', 'D']); sidesUsed.front = true; }, delay: 100 });
          steps.push({ action: function () { undimScales(['R1', 'R2', 'D']); changeMarkings('hairline', true); }, delay: 500 });
          steps.push({ action: displayMessageWithExponent('Square root of ' + formatSigFig(base, PREC) + ': use R scales. Set cursor on ' + formatSigFig(manBase.m, PREC) + ' on D, read ' + formatSigFig(result, PREC_FINAL) + ' on ' + rScaleSqrtPow + '. ' + rHintSqrtPow), delay: delayMsg });
          steps.push({ action: function () { cursorTo('D', manBase.m); }, delay: delayAction });
          steps.push({ action: displayMessageWithExponent('Result ' + formatSigFig(result, PREC_FINAL) + ' on ' + rScaleSqrtPow + ' scale.'), delay: delayMsg });
        }
        currentExp = Math.floor(currentExp / 2);
        exponentLogReason = 'sqrt: exponent \u00f7 2';
      } else if (exp === 3) {
        ensureFront();
        steps.push({ action: function () { ensureSide(['K', 'D']); sidesUsed.front = true; }, delay: 100 });
        steps.push({ action: function () { undimScales(['K', 'D']); changeMarkings('hairline', true); }, delay: 500 });
        steps.push({ action: displayMessageWithExponent('Cube: cursor to ' + formatSigFig(manBase.m, PREC) + ' on D, read ' + formatSigFig(result, PREC_FINAL) + ' on K.'), delay: delayMsg });
        steps.push({ action: function () { cursorTo('D', manBase.m); }, delay: delayAction });
        steps.push({ action: displayMessageWithExponent('Read result on K scale: ' + formatSigFig(result, PREC_FINAL)), delay: delayMsg });
        currentExp = currentExp * 3;
        exponentLogReason = 'cube: exponent \u00d7 3';
        lastResultOnD = false;
      } else if (Math.abs(exp - 1/3) < 1e-9) {
        ensureFront();
        var third = cubeRootThird(base);
        var thirdName = (third === 0) ? 'left' : (third === 1 ? 'middle' : 'right');
        steps.push({ action: function () { ensureSide(['K', 'D']); sidesUsed.front = true; }, delay: 100 });
        steps.push({ action: function () { undimScales(['K', 'D']); changeMarkings('hairline', true); }, delay: 500 });
        steps.push({ action: displayMessageWithExponent('Cube root: use ' + thirdName + ' third of K. Cursor to ' + formatSigFig(base, PREC) + ' on K, read ' + formatSigFig(result, PREC_FINAL) + ' on D.'), delay: delayMsg });
        steps.push({ action: function () { cursorTo('K', manBase.m); }, delay: delayAction });
        steps.push({ action: displayMessageWithExponent('Read result on D scale: ' + formatSigFig(result, PREC_FINAL)), delay: delayMsg });
        currentExp = Math.floor(currentExp / 3);
        exponentLogReason = 'cube root: exponent \u00f7 3';
      } else if (base > 0 && exp < 0 && result > 0 && result < 1) {
        // Negative exponent: result on LL "down" scales (e.g. 10^-3 = 0.001 on LL03), or log method if result too small.
        var expMag = -exp;
        var baseScaleLabel = llScaleForValue(base);
        var baseScaleName = findLLScaleNameForValue(base);
        var resultDownLabel = llDownScaleForValue(result);
        var resultDownScaleName = findLLDownScaleNameForValue(result);
        if (baseScaleLabel && baseScaleName && resultDownLabel && resultDownScaleName) {
          ensureBack();
          var scalesToShow = [baseScaleName, resultDownScaleName, 'C', 'D'];
          steps.push({ action: function () { ensureSide(scalesToShow); sidesUsed.back = true; }, delay: 100 });
          steps.push({ action: function () { undimScales(scalesToShow); changeMarkings('hairline', true); }, delay: 500 });
          var expM = (expMag <= 10) ? expMag : expMag / Math.pow(10, Math.floor(Math.log10(expMag)));
          steps.push({ action: displayMessageWithExponent('Negative power ' + formatSigFig(base, PREC) + '^(' + exp + ') = ' + formatSigFig(result, PREC_FINAL) + ': use the LL scale for the base and the LL "down" scale for the result (values < 1).'), delay: delayMsg });
          steps.push({ action: displayMessageWithExponent('Set the cursor to ' + formatSigFig(base, PREC) + ' on the ' + baseScaleLabel + ' scale (base ' + formatSigFig(base, PREC) + ').'), delay: delayMsg });
          steps.push({ action: function () { cursorTo(baseScaleName, base); }, delay: delayAction });
          steps.push({ action: displayMessageWithExponent('Move the slide so the right index (10) of the C scale is under the cursor. Then 4 on C will align with the result on the ' + resultDownLabel + ' scale.'), delay: delayMsg });
          steps.push({ action: function () { slideTo('C', 10); }, delay: delayAction });
          steps.push({ action: displayMessageWithExponent('Move the cursor to ' + formatSigFig(expM, PREC) + ' on the C scale (exponent magnitude ' + formatSigFig(expMag, PREC) + '). The result appears on the ' + resultDownLabel + ' scale (down scale for values < 1).'), delay: delayMsg });
          steps.push({ action: function () { cursorTo('C', expM); }, delay: delayAction });
          steps.push({ action: displayMessageWithExponent('Read ' + formatSigFig(result, PREC_FINAL) + ' under the cursor on the ' + resultDownScaleName + ' scale.'), delay: delayMsg });
          currentMantissa = manResult.m;
          currentExp = manResult.exp;
          exponentLogReason = 'negative power: result exponent';
          lastWasBack = true;
          lastResultOnD = false;
        } else if (result > 0) {
          // Result too small for LL down scales (e.g. 3^-20). Use log method: log10(a^b) = b × log10(a).
          var log10Base = Math.log10(base);
          var product = exp * log10Base;
          var characteristic = Math.floor(product);
          var logMantissa = product - characteristic;
          if (logMantissa < 0) logMantissa += 1;
          var resultMantissaFromLog = Math.pow(10, logMantissa);
          var dVal = log10Base >= 1 ? log10Base : log10Base * 10;
          var cVal = expMag <= 10 ? expMag : expMag / Math.pow(10, Math.floor(Math.log10(expMag)));
          var multProduct = dVal * cVal;
          var useRightIndex = multProduct > 10;
          var cIndex = useRightIndex ? 10 : 1;
          var readOnD = useRightIndex ? multProduct / 10 : multProduct;
          function toSigFigs(x, n) { if (x === 0 || !isFinite(x)) return x; return Number(Number(x).toPrecision(n)); }
          var log10BaseD = toSigFigs(log10Base, 3);
          var productD = toSigFigs(product, 4);
          var logMantissaD = toSigFigs(logMantissa, 3);
          var resultMantD = toSigFigs(resultMantissaFromLog, 3);
          var resultD = toSigFigs(result, 3);
          var resultExp = Math.floor(Math.log10(Math.abs(result)));
          var indexLabel = useRightIndex ? 'right index (10)' : 'left index (1)';
          var lScaleName = profile.scaleL;
          ensureBack();
          currentExp = 0;
          exponentLogReason = 'log method';
          steps.push({ action: function () { ensureSide([lScaleName, 'C', 'D']); sidesUsed.back = true; }, delay: 100 });
          steps.push({ action: function () { undimScales([lScaleName, 'C', 'D']); changeMarkings('hairline', true); }, delay: 500 });
          steps.push({ action: displayMessageWithExponent(formatSigFig(base, PREC) + '^(' + exp + ') = ' + resultD + '×10^' + characteristic + ' is below the LL down scale range. Use the log method: log₁₀(a^b) = b × log₁₀(a).'), delay: delayMsg });
          steps.push({ action: displayMessageWithExponent('Step A: Find log₁₀(' + formatSigFig(base, 2) + '). Cursor to ' + formatSigFig(manBase.m, PREC) + ' on D; read on L: log₁₀(' + formatSigFig(base, 2) + ') ≈ ' + log10BaseD + '.'), delay: delayMsg });
          steps.push({ action: function () { cursorTo('D', manBase.m); }, delay: delayAction });
          steps.push({ action: displayMessageWithExponent('Step B: Compute ' + expMag + ' × ' + log10BaseD + ' on C and D. Set the ' + indexLabel + ' of C over ' + formatSigFig(dVal, PREC) + ' on D. Move the cursor to ' + formatSigFig(cVal, PREC) + ' on C (representing exponent magnitude ' + expMag + ').'), delay: delayMsg });
          steps.push({ action: function () { ensureSide([lScaleName, 'C', 'D']); cursorTo('D', dVal); slideTo('C', cIndex); }, delay: delayAction });
          steps.push({ action: function () { cursorTo('C', cVal); }, delay: delayAction });
          currentExp = characteristic;
          exponentLogReason = 'log\u2081\u2080(result) characteristic';
          steps.push({ action: displayMessageWithExponent('Step C: Read ' + formatSigFig(readOnD, PREC_FINAL) + ' on D (i.e. ' + toSigFigs(readOnD, 4) + '). log₁₀(result) = ' + productD + ', characteristic ' + characteristic + ', mantissa ≈ ' + logMantissaD + '.'), delay: delayMsg });
          currentExp = resultExp;
          exponentLogReason = 'negative power: result exponent';
          steps.push({ action: displayMessageWithExponent('Step D: Antilog: move the slide so the left index (1) of C is over the result mantissa on D (≈ ' + resultMantD + '). The answer is on the D scale under the index.'), delay: delayMsg });
          steps.push({ action: function () { ensureSide([lScaleName, 'C', 'D']); cursorTo('D', resultMantissaFromLog); slideTo('C', 1); }, delay: delayAction });
          steps.push({ action: displayMessageWithExponent('Result: ' + formatSigFig(base, 2) + '^(' + exp + ') = ' + resultMantD + ' × 10^' + characteristic + ' ≈ ' + resultD + '×10^' + characteristic + '. Read the result mantissa on D under the index.'), delay: delayMsg });
          currentMantissa = manResult.m;
          currentExp = resultExp;
          exponentLogReason = 'negative power: result exponent';
          lastWasBack = true;
          lastResultOnD = true;
        } else {
          steps.push({ action: displayMessageWithExponent('Negative power ' + formatSigFig(base, PREC) + '^(' + exp + ') = ' + formatSigFig(result, PREC_FINAL) + ' (use LL down scales if available; otherwise 1/' + formatSigFig(base, PREC) + '^' + formatSigFig(expMag, PREC) + ').'), delay: delayMsg });
        }
      } else if (base > 0 && exp < 0 && result >= 1) {
        // Negative exponent with result >= 1 (e.g. 0.3^-4 = 123): base on LL0 (down), result on LL (up).
        var expMag = -exp;
        var baseDownLabel = llDownScaleForValue(base);
        var baseDownScaleName = findLLDownScaleNameForValue(base);
        var resultUpLabel = llScaleForValue(result);
        var resultUpScaleName = findLLScaleNameForValue(result);
        if (baseDownScaleName && resultUpScaleName) {
          ensureBack();
          var scalesToShowNeg = [baseDownScaleName, 'C', 'D'];
          if (resultUpScaleName && resultUpScaleName !== baseDownScaleName) scalesToShowNeg.push(resultUpScaleName);
          steps.push({ action: function () { ensureSide(scalesToShowNeg); sidesUsed.back = true; }, delay: 100 });
          steps.push({ action: function () { undimScales(scalesToShowNeg); changeMarkings('hairline', true); }, delay: 500 });
          var expM = (expMag <= 10) ? expMag : expMag / Math.pow(10, Math.floor(Math.log10(expMag)));
          var resultExpNeg = Math.floor(Math.log10(Math.abs(result)));
          steps.push({ action: displayMessageWithExponent('Negative power ' + formatSigFig(base, PREC) + '^(' + exp + ') = ' + formatSigFig(result, PREC_FINAL) + ': base &lt; 1 on LL0, result &gt; 1 on LL. Step 1: Set the left index (1) of the C scale over ' + formatSigFig(base, PREC) + ' on the ' + (baseDownLabel || 'LL02') + ' scale.'), delay: delayMsg });
          steps.push({ action: function () { ensureSide(scalesToShowNeg); cursorTo(baseDownScaleName, base); slideTo('C', 1); }, delay: delayAction });
          steps.push({ action: displayMessageWithExponent('Step 2: Move the hairline to ' + formatSigFig(expM, PREC) + ' on the C scale (exponent magnitude ' + expMag + '). Result appears on the ' + (resultUpLabel || 'LL') + ' scale (values &gt; 1).'), delay: delayMsg });
          steps.push({ action: function () { ensureSide(scalesToShowNeg); cursorTo('C', expM); }, delay: delayAction });
          steps.push({ action: displayMessageWithExponent('Step 3: Read ' + formatSigFig(result, PREC_FINAL) + ' under the hairline on the ' + (resultUpLabel || 'LL') + ' scale.'), delay: delayMsg });
          currentExp = resultExpNeg;
          exponentLogReason = 'negative power: result exponent';
          lastWasBack = true;
          lastResultOnD = false;
        } else {
          steps.push({ action: displayMessageWithExponent('Negative power ' + formatSigFig(base, PREC) + '^(' + exp + ') = ' + formatSigFig(result, PREC_FINAL) + ' (use LL0 for base, LL for result; or 1/' + formatSigFig(base, PREC) + '^' + formatSigFig(expMag, PREC) + ').'), delay: delayMsg });
        }
      } else if (base > 0 && result > 0) {
        var LL_LIMIT = Math.exp(10);
        var resultOffScale = result > LL_LIMIT;
        var resultExp = Math.floor(Math.log10(Math.abs(result)));
        var fractionalBase = base < 1;

        // Versalog way: use LL0 (red) scales for fractional base when available. Base on e.g. LL02, right index of C at base, cursor to exponent on C, read result on LL0.
        var baseDownLabel = fractionalBase ? llDownScaleForValue(base) : null;
        var baseDownScaleName = fractionalBase ? findLLDownScaleNameForValue(base) : null;
        var resultDownLabel = (fractionalBase && result > 0 && result < 1) ? llDownScaleForValue(result) : null;
        var resultDownScaleName = (fractionalBase && result > 0 && result < 1) ? findLLDownScaleNameForValue(result) : null;
        if (fractionalBase && baseDownScaleName && result > 0 && result < 1) {
          ensureBack();
          var scalesToShow = [baseDownScaleName, 'C', 'D'];
          if (resultDownScaleName && resultDownScaleName !== baseDownScaleName) scalesToShow.push(resultDownScaleName);
          steps.push({ action: function () { ensureSide(scalesToShow); sidesUsed.back = true; }, delay: 100 });
          steps.push({ action: function () { undimScales(scalesToShow); changeMarkings('hairline', true); }, delay: 500 });
          var expM = (exp <= 10) ? exp : exp / Math.pow(10, Math.floor(Math.log10(exp)));
          steps.push({ action: displayMessageWithExponent('Power ' + formatSigFig(base, PREC) + '^' + exp + ' (Versalog): base &lt; 1, use the Red LL0 scales. Step 1: Set the left index (1) of the C scale over ' + formatSigFig(base, PREC) + ' on the ' + (baseDownLabel || 'LL02') + ' scale.'), delay: delayMsg });
          steps.push({ action: function () { ensureSide(scalesToShow); cursorTo(baseDownScaleName, base); slideTo('C', 1); }, delay: delayAction });
          steps.push({ action: displayMessageWithExponent('Step 2: Move the hairline to ' + formatSigFig(expM, PREC) + ' on the C scale (exponent ' + exp + ').'), delay: delayMsg });
          steps.push({ action: function () { ensureSide(scalesToShow); cursorTo('C', expM); }, delay: delayAction });
          steps.push({ action: displayMessageWithExponent('Step 3: Read the result under the hairline on the ' + (resultDownLabel || 'LL03') + ' scale (one scale deeper than base): ' + formatSigFig(result, PREC_FINAL) + '.'), delay: delayMsg });
          currentExp = resultExp;
          exponentLogReason = 'power: result exponent';
          lastWasBack = true;
          lastResultOnD = false;
        } else if (resultOffScale || (fractionalBase && !baseDownScaleName)) {
          // Result exceeds LL3, or fractional base but no LL0 scales: use L-scale log method log10(a^b) = b × log10(a).
          var log10Base = Math.log10(base);
          var product = exp * log10Base;
          var characteristic = Math.floor(product);
          var logMantissa = product - characteristic;
          if (logMantissa < 0) logMantissa += 1;
          var resultMantissaFromLog = Math.pow(10, logMantissa);
          var dVal = (log10Base < 0)
            ? (Math.abs(log10Base) >= 0.1 ? Math.abs(log10Base) * 10 : Math.abs(log10Base) * 100)
            : (log10Base >= 1 ? log10Base : log10Base * 10);
          var cVal = exp <= 10 ? exp : exp / Math.pow(10, Math.floor(Math.log10(exp)));
          var multProduct = dVal * cVal;
          var useRightIndex = multProduct > 10;
          var cIndex = useRightIndex ? 10 : 1;
          var readOnD = useRightIndex ? multProduct / 10 : multProduct;
          function toSigFigs(x, n) { if (x === 0 || !isFinite(x)) return x; return Number(Number(x).toPrecision(n)); }
          var log10BaseD = toSigFigs(log10Base, 3);
          var productD = toSigFigs(product, 4);
          var logMantissaD = toSigFigs(logMantissa, 3);
          var resultMantD = toSigFigs(resultMantissaFromLog, 3);
          var resultD = toSigFigs(result, 3);
          var magLogD = toSigFigs(Math.abs(log10Base), 4);
          var productMagD = toSigFigs(exp * Math.abs(log10Base), 4);
          var indexLabel = useRightIndex ? 'right index (10)' : 'left index (1)';
          var lScaleName = profile.scaleL;
          ensureBack();
          currentExp = 0;
          exponentLogReason = 'log method';
          steps.push({ action: function () { ensureSide([lScaleName, 'C', 'D']); sidesUsed.back = true; }, delay: 100 });
          steps.push({ action: function () { undimScales([lScaleName, 'C', 'D']); changeMarkings('hairline', true); }, delay: 500 });
          var logMethodIntro = resultOffScale
            ? (formatSigFig(base, 2) + '^' + exp + ' = ' + resultD + '×10^' + characteristic + ' exceeds the end of the LL3 scale (~22,026). Use the log method: log₁₀(a^b) = b × log₁₀(a).')
            : (formatSigFig(base, 2) + '^' + exp + ' has a fractional base; LL0 scales not available. Use the L-scale method: log₁₀(a^b) = b × log₁₀(a). For base &lt; 1, log₁₀(base) is negative.');
          steps.push({ action: displayMessageWithExponent(logMethodIntro), delay: delayMsg });
          var stepAMsg = fractionalBase
            ? ('Step A: Find log₁₀(' + formatSigFig(base, 2) + '). Cursor to ' + formatSigFig(manBase.m, PREC) + ' on D; read on L. For base &lt; 1, log₁₀(' + formatSigFig(base, 2) + ') ≈ ' + log10BaseD + ' (negative); use its magnitude |log₁₀| = ' + magLogD + ' for the next step.')
            : ('Step A: Find log₁₀(' + formatSigFig(base, 2) + '). Cursor to ' + formatSigFig(manBase.m, PREC) + ' on D; read on L: log₁₀(' + formatSigFig(base, 2) + ') ≈ ' + log10BaseD + '.');
          steps.push({ action: displayMessageWithExponent(stepAMsg), delay: delayMsg });
          steps.push({ action: function () { cursorTo('D', manBase.m); }, delay: delayAction });
          var stepBMsg = fractionalBase
            ? ('Step B: Compute ' + exp + ' × ' + magLogD + ' = ' + productMagD + ' on C and D. Set the ' + indexLabel + ' of C over ' + formatSigFig(dVal, PREC) + ' on D (D shows ' + formatSigFig(dVal, PREC) + ' representing |log₁₀| = ' + magLogD + '). Move the cursor to ' + formatSigFig(cVal, PREC) + ' on C. Read ' + productMagD + ' on D.')
            : ('Step B: Compute ' + exp + ' × ' + log10BaseD + ' on C and D. Set the ' + indexLabel + ' of C over ' + formatSigFig(dVal, PREC) + ' on D (representing ' + log10BaseD + '). Move the cursor to ' + formatSigFig(cVal, PREC) + ' on the C scale (representing ' + exp + ').' + (useRightIndex ? ' Using the right index keeps 6.6 on C to the left, over the result on D.' : ''));
          steps.push({ action: displayMessageWithExponent(stepBMsg), delay: delayMsg });
          steps.push({ action: function () { ensureSide([lScaleName, 'C', 'D']); cursorTo('D', dVal); slideTo('C', cIndex); }, delay: delayAction });
          steps.push({ action: function () { cursorTo('C', cVal); }, delay: delayAction });
          currentExp = characteristic;
          exponentLogReason = 'log\u2081\u2080(result) characteristic';
          var stepCMsg = fractionalBase
            ? ('Step C: Since the log was negative, log₁₀(result) = ' + productD + '. Characteristic ' + characteristic + ', mantissa of log ≈ ' + logMantissaD + '. Result = ' + resultMantD + ' × 10^' + characteristic + '.')
            : ('Step C: Read ' + formatSigFig(readOnD, PREC_FINAL) + ' on D (i.e. ' + productD + '). Characteristic ' + characteristic + ', mantissa of log ≈ ' + logMantissaD + '.');
          steps.push({ action: displayMessageWithExponent(stepCMsg), delay: delayMsg });
          currentExp = resultExp;
          exponentLogReason = 'power: result exponent';
          var stepDMsg = fractionalBase
            ? ('Step D: Antilog: move the slide so the left index (1) of C is over ' + resultMantD + ' on D. With characteristic ' + characteristic + ', the answer is ' + resultMantD + ' × 10^' + characteristic + ' = ' + resultD + '.')
            : ('Step D: Antilog: move the slide so the left index (1) of C is over the result mantissa on D (≈ ' + resultMantD + '). The answer is on the D scale under the index.');
          steps.push({ action: displayMessageWithExponent(stepDMsg), delay: delayMsg });
          steps.push({ action: function () { ensureSide([lScaleName, 'C', 'D']); cursorTo('D', resultMantissaFromLog); slideTo('C', 1); }, delay: delayAction });
          steps.push({ action: displayMessageWithExponent('Result: ' + formatSigFig(base, 2) + '^' + exp + ' = ' + resultMantD + ' × 10^' + characteristic + ' ≈ ' + resultD + '. Read the result mantissa on D under the index.'), delay: delayMsg });
          currentMantissa = manResult.m;
          currentExp = resultExp;
          exponentLogReason = 'power: result exponent';
          lastWasBack = true;
          lastResultOnD = true;
        } else {
          var baseScaleLabel = llScaleForValue(base);
          var baseScaleName = findLLScaleNameForValue(base);
          var resultScaleLabel = llScaleForValue(result);
          var resultScaleName = findLLScaleNameForValue(result);
          if (baseScaleLabel && baseScaleName) {
            ensureBack();
            var scalesToShow = [baseScaleName, 'C', 'D'];
            if (resultScaleName && resultScaleName !== baseScaleName) scalesToShow.push(resultScaleName);
            steps.push({ action: function () { ensureSide(scalesToShow); sidesUsed.back = true; }, delay: 100 });
            steps.push({ action: function () { undimScales(scalesToShow); changeMarkings('hairline', true); }, delay: 500 });
            var expM;
            if (exp < 0.1) expM = exp * 100;
            else if (exp < 1) expM = exp * 10;
            else if (exp <= 10) expM = exp;
            else expM = exp / Math.pow(10, Math.floor(Math.log10(exp)));
            var scaleJumpHint = '';
            if (exp < 1 && exp >= 0.1) scaleJumpHint = ' Exponent between 0.1 and 1.0: result is one scale down (e.g. LL3 → LL2).';
            else if (exp < 0.1 && exp >= 0.01) scaleJumpHint = ' Exponent between 0.01 and 0.1: result is two scales down (e.g. LL3 → LL1).';
            else if (exp < 0.01 && exp > 0) scaleJumpHint = ' Exponent &lt; 0.01: result is three scales down.';
            var resultReadD = formatSigFig(result, PREC_FINAL);
            steps.push({ action: displayMessageWithExponent('Power ' + formatSigFig(base, PREC) + '^' + exp + ' using LL scales: set the cursor so the hairline is over ' + formatSigFig(base, PREC) + ' on the ' + baseScaleLabel + ' scale.'), delay: delayMsg });
            steps.push({ action: function () { cursorTo(baseScaleName, base); }, delay: delayAction });
            steps.push({ action: displayMessageWithExponent('Move the slide so the left index (1) of the C scale is under the cursor. The rule is now set for base ' + formatSigFig(base, PREC) + '.'), delay: delayMsg });
            steps.push({ action: function () { slideTo('C', 1); }, delay: delayAction });
            steps.push({ action: displayMessageWithExponent('Move the cursor to ' + formatSigFig(expM, PREC) + ' on the C scale (representing exponent ' + exp + ').' + (exp > 10 ? ' Use ' + formatSigFig(expM, PREC) + ' because ' + exp + ' is off the physical C scale.' : (exp < 1 ? ' For exponent &lt; 1 the result appears on a lower LL scale.' : '')) + scaleJumpHint), delay: delayMsg });
            steps.push({ action: function () { cursorTo('C', expM); }, delay: delayAction });
            steps.push({ action: displayMessageWithExponent('Read ' + resultReadD + ' under the cursor on the ' + (resultScaleLabel || baseScaleLabel) + ' scale. (Do not use the D scale here—it is log-log; the value under the cursor on D is not the result mantissa.)'), delay: delayMsg });
            currentExp = resultExp;
            exponentLogReason = 'power: result exponent';
            lastWasBack = true;
            lastResultOnD = false;
          } else {
            steps.push({ action: displayMessageWithExponent('Power ' + exp + ': use C/D chain or not supported; result is ' + formatSigFig(result, PREC_FINAL)), delay: delayMsg });
          }
        }
      } else {
        steps.push({ action: displayMessageWithExponent('Power ' + exp + ': use C/D chain or not supported; result is ' + formatSigFig(result, PREC_FINAL)), delay: delayMsg });
      }
    }

    function stepSqrt(op, isFinalOp) {
      var arg = op.arg;
      var result = op.result;
      var manArg = toMantissa(arg);
      var manResult = toMantissa(result);
      currentMantissa = manResult.m;
      if (isFinalOp) {
        ensureBack();
        var nDigits = digitsLeftOfDecimal(arg);
        var useR1 = (nDigits % 2 === 1);
        var rScale = useR1 ? 'R1' : 'R2';
        var rHint = useR1 ? 'Odd number of digits to the left of the decimal → use R1.' : 'Even number of digits to the left of the decimal → use R2.';
        steps.push({ action: function () { ensureSide(['R1', 'R2', 'D']); sidesUsed.back = true; }, delay: 100 });
        steps.push({ action: function () { undimScales(['R1', 'R2', 'D']); changeMarkings('hairline', true); }, delay: 500 });
        currentExp = manResult.exp;
        exponentLogReason = 'sqrt: exponent \u00f7 2';
        steps.push({ action: displayMessageWithExponent('Square root of ' + formatSigFig(arg, PREC) + ' (final result): use the R scales for higher precision. Set the cursor on ' + formatSigFig(manArg.m, PREC) + ' on the D scale and read the result on ' + rScale + '. ' + rHint), delay: delayMsg });
        steps.push({ action: function () { cursorTo('D', manArg.m); }, delay: delayAction });
        steps.push({ action: displayMessageWithExponent('Result ' + formatSigFig(result, PREC_FINAL) + ' on ' + rScale + ' scale.'), delay: delayMsg });
        lastResultOnD = false;
        lastWasBack = true;
        lastWasFinalSqrt = true;
      } else {
        ensureFront();
        if (profile.hasA) {
          var half = squareRootHalf(arg);
          var aVal = half === 'left' ? manArg.m : manArg.m * 10;
          steps.push({ action: function () { ensureSide(['A', 'D']); sidesUsed.front = true; }, delay: 100 });
          steps.push({ action: function () { undimScales(['A', 'D']); changeMarkings('hairline', true); }, delay: 500 });
          steps.push({ action: displayMessageWithExponent('Square root of ' + formatSigFig(arg, PREC) + ': use ' + half + ' half of A. Cursor to value on A, read ' + formatSigFig(result, PREC_FINAL) + ' on D.'), delay: delayMsg });
          steps.push({ action: function () { cursorTo('A', aVal); }, delay: delayAction });
          steps.push({ action: displayMessageWithExponent('Result ' + formatSigFig(result, PREC_FINAL) + ' on D scale.'), delay: delayMsg });
          currentExp = manResult.exp;
          exponentLogReason = 'sqrt: exponent \u00f7 2';
          lastResultOnD = true;
        } else {
          var nDigitsSqrt = digitsLeftOfDecimal(arg);
          var useR1Sqrt = (nDigitsSqrt % 2 === 1);
          var rScaleSqrt = useR1Sqrt ? 'R1' : 'R2';
          var rHintSqrt = useR1Sqrt ? 'Odd number of digits to the left of the decimal → use R1.' : 'Even number of digits to the left of the decimal → use R2.';
          var sqrtReadRounded = formatSigFig(result, PREC_FINAL);
          steps.push({ action: function () { ensureSide(['R1', 'R2', 'D']); sidesUsed.front = true; }, delay: 100 });
          steps.push({ action: function () { undimScales(['R1', 'R2', 'D']); changeMarkings('hairline', true); }, delay: 500 });
          steps.push({ action: displayMessageWithExponent('Square root of ' + formatSigFig(arg, PREC) + ': use R scales. Set cursor on ' + formatSigFig(manArg.m, PREC) + ' on D, read ' + sqrtReadRounded + ' on ' + rScaleSqrt + '. ' + rHintSqrt), delay: delayMsg });
          steps.push({ action: function () { cursorTo('D', manArg.m); }, delay: delayAction });
          steps.push({ action: displayMessageWithExponent('Result ' + sqrtReadRounded + ' on ' + rScaleSqrt + ' scale. The cursor is not a memory—you must re-enter this value on C or D for the next step.'), delay: delayMsg });
          currentExp = manResult.exp;
          exponentLogReason = 'sqrt: exponent \u00f7 2';
          lastResultOnD = false;
          lastResultFromRScale = true;
        }
      }
    }

    var S_SCALE_MIN_DEG = 5.73;
    function stepSin(op) {
      var arg = op.arg;
      var result = op.result;
      ensureBack();
      var useST = arg < S_SCALE_MIN_DEG;
      var scaleNames = useST ? ['SRT', 'D'] : ['S', 'D'];
      steps.push({ action: function () { ensureSide(scaleNames); sidesUsed.back = true; }, delay: 100 });
      steps.push({ action: function () { undimScales(scaleNames); changeMarkings('hairline', true); }, delay: 500 });
      if (useST) {
        steps.push({ action: displayMessageWithExponent('Angle ' + formatSigFig(arg, PREC) + '\u00b0 is below the S scale range (~5.7\u00b0). Use the ST scale: cursor to ' + formatSigFig(arg, PREC) + ' on ST, read on D (result 0.01\u20130.1).'), delay: delayMsg });
        steps.push({ action: function () { cursorTo('SRT', arg); }, delay: delayAction });
      } else {
        steps.push({ action: displayMessageWithExponent('Sine of ' + formatSigFig(arg, PREC) + ' degrees: cursor to angle on S, read value on D.'), delay: delayMsg });
        steps.push({ action: function () { cursorTo('S', arg); }, delay: delayAction });
      }
      steps.push({ action: displayMessageWithExponent('Read sin = ' + formatSigFig(result, PREC_FINAL) + ' on D (adjust decimal).'), delay: delayMsg });
      currentMantissa = result;
      while (currentMantissa > 0 && currentMantissa < 1) currentMantissa *= 10;
      while (currentMantissa >= 10) currentMantissa /= 10;
      currentExp = result !== 0 && isFinite(result) ? Math.floor(Math.log10(Math.abs(result))) : 0;
      exponentLogReason = 'sin: result exponent';
      lastWasBack = true;
      lastResultOnD = true;
    }

    function stepCos(op) {
      var arg = op.arg;
      var result = op.result;
      var comp = 90 - arg;
      ensureBack();
      var useST = comp < S_SCALE_MIN_DEG;
      var scaleNames = useST ? ['SRT', 'D'] : ['S', 'D'];
      steps.push({ action: function () { ensureSide(scaleNames); sidesUsed.back = true; }, delay: 100 });
      steps.push({ action: function () { undimScales(scaleNames); changeMarkings('hairline', true); }, delay: 500 });
      if (useST) {
        steps.push({ action: displayMessageWithExponent('cos(θ) = sin(90−θ). Angle 90−' + formatSigFig(arg, PREC) + '\u00b0 = ' + formatSigFig(comp, PREC) + '\u00b0 is below S scale range. Use ST: cursor to ' + formatSigFig(comp, PREC) + ' on ST, read on D.'), delay: delayMsg });
        steps.push({ action: function () { cursorTo('SRT', comp); }, delay: delayAction });
      } else {
        steps.push({ action: displayMessageWithExponent('Cosine of ' + formatSigFig(arg, PREC) + ' degrees: cos(θ) = sin(90−θ). Cursor to ' + formatSigFig(comp, PREC) + ' on S, read on D.'), delay: delayMsg });
        steps.push({ action: function () { cursorTo('S', comp); }, delay: delayAction });
      }
      steps.push({ action: displayMessageWithExponent('Read cos = ' + formatSigFig(result, PREC_FINAL) + ' on D.'), delay: delayMsg });
      currentMantissa = result;
      while (currentMantissa > 0 && currentMantissa < 1) currentMantissa *= 10;
      while (currentMantissa >= 10) currentMantissa /= 10;
      lastWasBack = true;
      lastResultOnD = true;
    }

    function stepTan(op) {
      var arg = op.arg;
      var result = op.result;
      ensureBack();
      steps.push({ action: function () { ensureSide(['T', 'D']); sidesUsed.back = true; }, delay: 100 });
      steps.push({ action: function () { undimScales(['T', 'D']); changeMarkings('hairline', true); }, delay: 500 });
      steps.push({ action: displayMessageWithExponent('Tangent of ' + formatSigFig(arg, PREC) + ' degrees: cursor to angle on T, read on D.'), delay: delayMsg });
      steps.push({ action: function () { cursorTo('T', arg); }, delay: delayAction });
      steps.push({ action: displayMessageWithExponent('Read tan = ' + formatSigFig(result, PREC_FINAL) + ' on D.'), delay: delayMsg });
      currentMantissa = result;
      while (currentMantissa > 0 && currentMantissa < 1) currentMantissa *= 10;
      while (currentMantissa >= 10) currentMantissa /= 10;
      currentExp = result !== 0 && isFinite(result) ? Math.floor(Math.log10(Math.abs(result))) : 0;
      exponentLogReason = 'tan: result exponent';
      lastWasBack = true;
      lastResultOnD = true;
    }

    function stepLog(op) {
      var arg = op.arg;
      var result = op.result;
      ensureBack();
      steps.push({ action: function () { ensureSide([profile.scaleL, 'D']); sidesUsed.back = true; }, delay: 100 });
      steps.push({ action: function () { undimScales([profile.scaleL, 'D']); changeMarkings('hairline', true); }, delay: 500 });
      var manArg = toMantissa(arg);
      steps.push({ action: displayMessageWithExponent('Log10 of ' + formatSigFig(arg, PREC) + ': cursor to value on D, read on L.'), delay: delayMsg });
      steps.push({ action: function () { cursorTo('D', manArg.m); }, delay: delayAction });
      steps.push({ action: displayMessageWithExponent('Read log10 = ' + formatSigFig(result, PREC_FINAL) + ' on the L scale. The L scale gives the mantissa (decimal part)—' + formatSigFig(result, PREC_FINAL) + ' is the actual value for the next step.'), delay: delayMsg });
      currentMantissa = result >= 1 && result < 10 ? result : (result < 1 ? result * 10 : result / 10);
      currentExp = result !== 0 && isFinite(result) ? Math.floor(Math.log10(Math.abs(result))) : 0;
      exponentLogReason = 'log result (value for next step)';
      lastWasBack = true;
      lastResultOnD = false;
    }

    function stepLn(op) {
      var arg = op.arg;
      var result = op.result;
      var manArg = toMantissa(arg);
      var llScaleLabel = llScaleForValue(arg);
      var llScaleName = findLLScaleNameForValue(arg);
      if (llScaleLabel && llScaleName) {
        ensureBack();
        steps.push({ action: function () { ensureSide([llScaleName, 'D']); sidesUsed.back = true; }, delay: 100 });
        steps.push({ action: function () { undimScales([llScaleName, 'D']); changeMarkings('hairline', true); }, delay: 500 });
        var resultRead = formatSigFig(result, PREC_FINAL);
        var rangeHint = (llScaleLabel === 'LL3') ? '1.0 to 10.0' : (llScaleLabel === 'LL2') ? '0.1 to 1.0' : '0.01 to 0.1';
        steps.push({ action: displayMessageWithExponent('Natural log of ' + formatSigFig(arg, PREC) + ': On this rule, the D scale and LL scales are aligned so ln(y) is read directly. Find ' + formatSigFig(arg, PREC) + ' on the ' + llScaleLabel + ' scale.'), delay: delayMsg });
        steps.push({ action: function () { cursorTo(llScaleName, arg); }, delay: delayAction });
        steps.push({ action: displayMessageWithExponent('Place the hairline over ' + formatSigFig(arg, PREC) + ' on ' + llScaleLabel + '. Read the digits under the cursor on the D scale. ' + llScaleLabel + ' gives ln between ' + rangeHint + ', so ln(' + formatSigFig(arg, PREC) + ') = ' + resultRead + '.'), delay: delayMsg });
        currentMantissa = result >= 1 && result < 10 ? result : (result < 1 ? result * 10 : result / 10);
        if (currentMantissa >= 10) currentMantissa /= 10;
        currentExp = result !== 0 && isFinite(result) ? Math.floor(Math.log10(Math.abs(result))) : 0;
        exponentLogReason = 'log result (value for next step)';
        lastWasBack = true;
        lastResultOnD = true;
      } else {
        ensureBack();
        steps.push({ action: function () { ensureSide([profile.scaleL, 'D']); sidesUsed.back = true; }, delay: 100 });
        steps.push({ action: function () { undimScales([profile.scaleL, 'D']); changeMarkings('hairline', true); }, delay: 500 });
        steps.push({ action: displayMessageWithExponent('Natural log of ' + formatSigFig(arg, PREC) + ': cursor to value on D, read log10 on L. Then ln(x) = log10(x) × 2.303.'), delay: delayMsg });
        steps.push({ action: function () { cursorTo('D', manArg.m); }, delay: delayAction });
        steps.push({ action: displayMessageWithExponent('Read log10 on L, then ln(x) = log10(x) × 2.303 = ' + formatSigFig(result, PREC_FINAL)), delay: delayMsg });
        currentMantissa = result >= 1 && result < 10 ? result : (result < 1 ? result * 10 : result / 10);
        currentExp = result !== 0 && isFinite(result) ? Math.floor(Math.log10(Math.abs(result))) : 0;
        exponentLogReason = 'log result (value for next step)';
        lastWasBack = true;
        lastResultOnD = false;
      }
    }

    var isFirstInit = true;
    var divisionChain = isDivisionChain(ops);
    var divisionIndexInChain = 0;
    var chainSlideShift = null;
    var cursorAtIndex = false;
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      if (op.op === 'init') {
        if (isFirstInit) {
          var coefTimesPower = (i + 3 < ops.length && ops[i + 1].op === 'init' && ops[i + 2].op === '^' && ops[i + 3].op === '*');
          var powerOnly = (i + 2 < ops.length && ops[i + 1].op === 'init' && ops[i + 2].op === '^' && (i + 3 >= ops.length || ops[i + 3].op !== '*'));
          if (coefTimesPower || powerOnly) {
            steps.push({ action: displayMessageWithExponent('Calculate: ' + equationStr), delay: 500 });
            isFirstInit = false;
          } else if (divisionChain) {
            stepInitForDivision(op);
          } else if (i + 1 < ops.length && ops[i + 1].op === '*') {
            var useRightIndex = false;
            if (i + 2 < ops.length && ops[i + 1].op === 'init' && ops[i + 2].op === '*') {
              var secondVal = ops[i + 1].value;
              var manSecond = toMantissa(secondVal);
              if (op.value * manSecond.m >= 10) useRightIndex = true;
            }
            stepInit(op, useRightIndex);
          } else {
            var nextOp = (i + 1 < ops.length) ? ops[i + 1].op : null;
            var unaryOnly = (nextOp === 'sqrt' || nextOp === 'sin' || nextOp === 'cos' || nextOp === 'tan' || nextOp === 'log' || nextOp === 'ln' || nextOp === '^');
            if (unaryOnly) {
              var man = toMantissa(op.value);
              currentMantissa = man.m;
              currentExp = 0;
              lastWasBack = false;
              lastResultOnD = true;
              steps.push({ action: displayMessageWithExponent('Calculate: ' + equationStr), delay: 500 });
            } else {
              stepInit(op, false);
            }
          }
          isFirstInit = false;
        }
        // Second and later inits (e.g. 3.5 in 2*3.5) are second factors; no steps here.
      } else if (op.op === '*') stepMultiply(op);
      else if (op.op === '/') {
        var out = stepDivide(op, divisionChain ? divisionIndexInChain : -1, divisionChain, chainSlideShift, cursorAtIndex);
        if (divisionChain) {
          divisionIndexInChain += 1;
          if (out && out.slideShift != null) chainSlideShift = out.slideShift;
          if (out && typeof out.cursorAtIndex === 'boolean') cursorAtIndex = out.cursorAtIndex;
        }
      }
      else if (op.op === '^') stepPower(op);
      else if (op.op === 'sqrt') stepSqrt(op, i === ops.length - 1);
      else if (op.op === 'sin') stepSin(op);
      else if (op.op === 'cos') stepCos(op);
      else if (op.op === 'tan') stepTan(op);
      else if (op.op === 'log') stepLog(op);
      else if (op.op === 'ln') stepLn(op);
    }

    var finalVal = finalResult;
    var finalMan = toMantissa(finalResult);
    steps.unshift({ action: function () { ensureSide(['C', 'D']); cursorTo('D', 1); slideTo('C', 1); }, delay: 0 });
    var _resultExp = currentExp;
    var _resultReason = exponentLogReason;
    steps.push({ action: function () {
      if (lastWasFinalSqrt) ensureSide(['R1', 'R2', 'D']);
      else if (lastWasBack) ensureSide(['S', 'D']);
      else ensureSide(['C', 'D']);
      isolate();
      sliderules.objective = function () {
        var ok = false;
        if (lastResultOnD) ok = checkValue('D', finalMan.m);
        else ok = true;
        if (ok) {
          message('Result: ' + equationStr + ' = ' + formatSigFig(finalVal, PREC_FINAL) + ' \u2016 Exponent log: ' + _resultExp + (_resultReason ? ' \u2014 ' + _resultReason : ''));
          return true;
        }
        return false;
      };
    }, delay: delayObj });
    steps.push({ action: function () { isolate(); message('Try again or enter another equation.'); }, delay: 4000 });

    // Mark visible steps: those that show an instruction (message) or move cursor/slide. Setup-only (ensureSide, undimScales) are not visible.
    for (var vi = 0; vi < steps.length; vi++) {
      var actionStr = steps[vi].action.toString();
      var setupOnly = (actionStr.indexOf('ensureSide') !== -1 && actionStr.indexOf('message') === -1 && actionStr.indexOf('cursorTo') === -1 && actionStr.indexOf('slideTo') === -1) ||
          (actionStr.indexOf('undimScales') !== -1 && actionStr.indexOf('message') === -1 && actionStr.indexOf('cursorTo') === -1 && actionStr.indexOf('slideTo') === -1);
      steps[vi].visible = !setupOnly;
    }
    return steps;
  }

  function generateTutorial(equationString, messageFn) {
    if (!parseEquation || !messageFn) return { error: true, message: 'Missing equation parser or message function', start: 0, end: 0 };
    var parsed = parseEquation(equationString);
    if (parsed.error) return parsed;
    var ast = parsed.ast;
    var finalResult = parsed.value;
    var ops = [];
    flattenOps(ast, ops);
    if (ops.length === 0) return { error: true, message: 'Could not build operation list', start: 0, end: equationString.length };
    var steps = emitSteps(ops, finalResult, equationString, messageFn);
    return { steps: steps };
  }

  window.generateDynamicTutorial = generateTutorial;
})();
