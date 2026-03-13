///////////////////////////////////////////////////////////////////////////////////
// Dynamic tutorial generator for K&E Deci-Lon (68-1100).
// Converts a parsed equation (AST + value) into tutorial steps.
// Uses D/DI scale for division when profile.hasDI. Scale names: Sq1/Sq2, L, Ln0–Ln3, Ln-0–Ln-3, K.
// Depends: equation_parser.js, sliderule_ctrl.js, crnu/rndlist from construction kit, decilon_rule_profile.js.
///////////////////////////////////////////////////////////////////////////////////

(function () {
  'use strict';

  var evaluate = window.equation_parser && window.equation_parser.evaluate;
  var parseEquation = window.equation_parser && window.equation_parser.parseEquation;
  var profile = window.decilonRuleProfile || (window.decilonRuleProfiles && window.decilonRuleProfiles.decilon) || { hasA: true, hasB: true, hasDI: true, scaleL: 'L', scaleNames: { R1: 'Sq1', R2: 'Sq2', K: 'K' } };

  function scaleName(name) {
    return (profile.scaleNames && profile.scaleNames[name]) || name;
  }

  function toMantissa(x) {
    if (x === 0) return { m: 1, exp: -100 };
    var exp = Math.floor(Math.log10(Math.abs(x)));
    var m = x / Math.pow(10, exp);
    if (m >= 10) { m /= 10; exp += 1; }
    if (m < 1 && m > 0) { m *= 10; exp -= 1; }
    return { m: crnu(m), exp: exp };
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
    var PREC = 4;
    var PREC_FINAL = 3;
    function formatSigFig(x, n) {
      if (x === 0 || !isFinite(x)) return String(x);
      return String(Number(Number(x).toPrecision(n)));
    }
    var currentMantissa = null;
    var currentExp = 0;
    var sidesUsed = { front: false, back: false };
    var lastWasBack = false;
    /** If user started on the back and back has required scales, prefer back for operations that support it. */
    var preferBack = false;
    if (typeof currentSideHasScales === 'function' && currentSideHasScales(['D', 'DI'])) {
      preferBack = true;
      sidesUsed.back = true;
    }
    var lastResultOnD = true;
    var lastWasFinalSqrt = false;
    var lastResultFromRScale = false;
    var lastMultiplyWasCI = false;

    var exponentLogReason = '\u2014';
    function displayMessageWithExponent(t) {
      var _exp = currentExp;
      var _reason = exponentLogReason;
      return function () {
        message(t + ' \u2016 Exponent log: ' + _exp + (_reason ? ' \u2014 ' + _reason : ''));
      };
    }

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

    function ensureFront(requiredScales) {
      var scales = requiredScales || ['C', 'D'];
      if (!sidesUsed.front) {
        sidesUsed.front = true;
        steps.push({
          action: function () {
            ensureSide(scales);
          },
          delay: 100
        });
      }
    }
    function ensureFrontWithCI() {
      ensureFront(['C', 'D', 'CI']);
    }
    function isDivisionChain(ops) {
      for (var j = 0; j < ops.length; j++) {
        if (ops[j].op !== 'init') return ops[j].op === '/';
      }
      return false;
    }
    function ensureBack(requiredScales) {
      var scales = requiredScales || ['S', 'D'];
      if (!sidesUsed.back) {
        sidesUsed.back = true;
        steps.push({
          action: function () {
            ensureSide(scales);
          },
          delay: 100
        });
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
      var indexReason = (useRightIndex === true) ? ' (Use the right index so later products stay on the D scale.)' : '';
      steps.push({ action: displayMessageWithExponent('Calculate: ' + equationStr), delay: 500 });
      steps.push({ action: function () { undimScales(['C', 'D']); changeMarkings('hairline', true); }, delay: 500 });
      steps.push({ action: displayMessageWithExponent('First factor is ' + formatSigFig(v, PREC) + '. Move the slide so the ' + indexLabel + ' on C is over ' + formatSigFig(v, PREC) + ' on the D scale.' + indexReason), delay: delayMsg });
      steps.push({ action: function () {
        if (typeof currentSideHasScales === 'function' && !currentSideHasScales(['C', 'D']) && typeof changeSide === 'function') changeSide('front');
        ensureSide(['C', 'D']);
        cursorTo('D', dVal);
        slideTo('C', cIndex);
      }, delay: delayAction, resultScale: 'D', resultValue: formatSigFig(dVal, PREC) });
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
      if (preferBack && profile.hasDI) {
        sidesUsed.back = true;
        steps.push({ action: displayMessageWithExponent('Calculate: ' + equationStr), delay: 500 });
        steps.push({ action: function () { undimScales(['D', 'DI']); changeMarkings('hairline', true); }, delay: 500 });
        steps.push({ action: displayMessageWithExponent('Division chain: set the dividend. Move the cursor to ' + formatSigFig(v, PREC) + ' on the D scale (back side).'), delay: delayMsg });
        steps.push({ action: function () {
          if (typeof currentSideHasScales === 'function' && !currentSideHasScales(['D', 'DI']) && typeof changeSide === 'function') changeSide('back');
          ensureSide(['D', 'DI']);
          cursorTo('D', dVal);
        }, delay: delayAction });
      } else {
        ensureFront();
        steps.push({ action: displayMessageWithExponent('Calculate: ' + equationStr), delay: 500 });
        steps.push({ action: function () { undimScales(['C', 'D']); changeMarkings('hairline', true); }, delay: 500 });
        steps.push({ action: displayMessageWithExponent('Division chain: set the dividend. Move the cursor to ' + formatSigFig(v, PREC) + ' on the D scale.'), delay: delayMsg });
        steps.push({ action: function () {
          if (typeof currentSideHasScales === 'function' && !currentSideHasScales(['C', 'D']) && typeof changeSide === 'function') changeSide('front');
          ensureSide(['C', 'D']);
          cursorTo('D', dVal);
        }, delay: delayAction });
      }
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
      if (manB.m >= 0.9995 && manB.m <= 1.0005) {
        steps.push({ action: displayMessageWithExponent('Multiply by ' + formatSigFig(b, PREC) + ' (' + formatSigFig(manB.m, PREC) + '\u00d710^' + manB.exp + '): exponent only; no movement.'), delay: delayMsg });
        return;
      }
      ensureFront();
      if (lastMultiplyWasCI) {
        lastMultiplyWasCI = false;
        var productOnScale = (prod >= 1 && prod < 10);
        if (productOnScale) {
          currentExp = manProd . exp;
          exponentLogReason = 'multiply by ' + formatSigFig(manB.m, PREC) + '\u00d710^' + manB.exp;
          steps.push({ action: function () { undimScales(['C', 'D']); changeMarkings('hairline', true); }, delay: 500 });
          steps.push({ action: displayMessageWithExponent('Result is under the index. Move the cursor to ' + formatSigFig(cursorCVal, PREC) + ' on the C scale. Read the product on D under the cursor.'), delay: delayMsg });
          steps.push({ action: function () {
            if (typeof currentSideHasScales === 'function' && !currentSideHasScales(['C', 'D']) && typeof changeSide === 'function') changeSide('front');
            ensureSide(['C', 'D']);
            cursorTo('C', cursorCVal);
          }, delay: delayAction });
          steps.push({ action: displayMessageWithExponent('Read intermediate result ' + prodMsg + ' on D.'), delay: delayMsg, resultScale: 'D', resultValue: prodMsg });
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
      var nextExp = manProd.exp;
      var nextReason = 'multiply by ' + formatSigFig(manB.m, PREC) + '\u00d710^' + manB.exp + (useRightIndex ? ' + 1 (index shift: slide left)' : '');
      var cIndex = useRightIndex ? 10 : 1;
      var rScaleCursorMsg = afterRScaleSqrt ? ('Move the cursor to ' + formatSigFig(cursorCVal, PREC_FINAL) + ' on the C scale (the second factor).') : null;
      // For the Deci-Lon tutorial, prefer the standard C/DF workflows over CI
      // so that simple products like 2*3 use a single slide move (index to first
      // factor on D, then cursor to second factor on C) instead of a CI-based
      // sequence that requires extra slide movements.
      var useCI = false;
      if (useCI) {
        lastMultiplyWasCI = true;
        currentExp = nextExp;
        exponentLogReason = 'multiply by ' + formatSigFig(manB.m, PREC) + '\u00d710^' + manB.exp;
        var ciMultiplyIndex = whichIndexCIMultiply(firstFactor, cursorCVal);
        var ciIndexLabel = (ciMultiplyIndex === 10) ? 'right index (10)' : 'left index (1)';
        steps.push({ action: function () { undimScales(['C', 'D', 'CI']); changeMarkings('hairline', true); }, delay: 500 });
        steps.push({ action: displayMessageWithExponent('First factor is already on D (under the cursor). Without moving the cursor, move the slide so ' + formatSigFig(cursorCVal, PREC) + ' on the CI scale is under the cursor. Read the product on D under the ' + ciIndexLabel + '.'), delay: delayMsg });
        var tValNum = Number(firstFactor);
        var cValNum = Number(cursorCVal);
        var idxNum = Number(ciMultiplyIndex);
        if (!isFinite(tValNum)) tValNum = firstFactor;
        if (!isFinite(cValNum)) cValNum = cursorCVal;
        if (!isFinite(idxNum)) idxNum = ciMultiplyIndex;
        steps.push({
          action: (function (tVal, cVal) {
            return function () {
              if (typeof currentSideHasScales === 'function' && !currentSideHasScales(['C', 'D', 'CI']) && typeof changeSide === 'function') changeSide('front');
              ensureSide(['C', 'D', 'CI']);
              cursorTo('D', tVal);
              slideTo('CI', cVal);
            };
          })(tValNum, cValNum),
          delay: delayAction
        });
        steps.push({
          action: (function (idx) {
            return function () {
              cursorTo('C', idx);
            };
          })(idxNum),
          delay: 400
        });
        steps.push({ action: displayMessageWithExponent('Read intermediate result ' + prodMsg + ' on D under the ' + ciIndexLabel + '.'), delay: delayMsg, resultScale: 'D', resultValue: prodMsg });
      } else if (useCF) {
        lastMultiplyWasCI = false;
        currentExp = nextExp;
        exponentLogReason = nextReason;
        steps.push({ action: function () { undimScales(['CF', 'DF']); changeMarkings('hairline', true); }, delay: 500 });
        steps.push({ action: displayMessageWithExponent('Second factor ' + formatSigFig(cursorCVal, PREC) + ' would be off C; use folded scales. Set cursor to ' + formatSigFig(firstFactor, PREC) + ' on DF, align index on CF, then cursor to ' + formatSigFig(cursorCVal, PREC) + ' on CF and read product on DF.'), delay: delayMsg });
        steps.push({ action: function () {
          if (typeof currentSideHasScales === 'function' && !currentSideHasScales(['CF', 'DF']) && typeof changeSide === 'function') changeSide('front');
          ensureSide(['CF', 'DF']);
          cursorTo('DF', firstFactor);
        }, delay: delayAction });
        steps.push({ action: function () { slideTo('CF', 1); }, delay: delayAction });
        steps.push({ action: function () { cursorTo('CF', cursorCVal); }, delay: delayAction });
        steps.push({ action: displayMessageWithExponent('Read intermediate result ' + prodMsg + ' on DF.'), delay: delayMsg, resultScale: 'DF', resultValue: prodMsg });
      } else {
        lastMultiplyWasCI = false;
        steps.push({ action: function () { undimScales(['C', 'D']); changeMarkings('hairline', true); }, delay: 500 });
        var msgSetSlide = (useRightIndex ? 'Move the slide so the right index (10) on C is over ' : (afterRScaleSqrt ? 'Set the first factor: move the slide so the left index (1) on C is over ' : 'Move the slide so the left index (1) on C is over ')) + formatSigFig(firstFactor, PREC) + ' on the D scale.';
        var msgCursor = rScaleCursorMsg || ('Move the cursor to ' + formatSigFig(cursorCVal, PREC) + ' on the C scale.');
        steps.push({ action: displayMessageWithExponent(msgSetSlide), delay: delayMsg });
        currentExp = nextExp;
        exponentLogReason = nextReason;
        steps.push({ action: function () {
          if (typeof currentSideHasScales === 'function' && !currentSideHasScales(['C', 'D']) && typeof changeSide === 'function') changeSide('front');
          ensureSide(['C', 'D']);
          cursorTo('D', firstFactor);
        }, delay: delayAction, resultScale: 'D', resultValue: formatSigFig(firstFactor, PREC) });
        steps.push({ action: function () { slideTo('C', cIndex); }, delay: delayAction });
        steps.push({ action: displayMessageWithExponent(msgCursor), delay: delayMsg });
        steps.push({ action: function () { cursorTo('C', cursorCVal); }, delay: delayAction, resultScale: 'C', resultValue: formatSigFig(cursorCVal, PREC) });
        var readMsg = afterRScaleSqrt ? ('Read result ' + formatSigFig(prod, PREC_FINAL) + ' on D.') : ('Read intermediate result ' + prodMsg + ' on D.' + (useRightIndex ? ' (Adjust decimal: result is ' + prodMsg + '.)' : ''));
        steps.push({ action: displayMessageWithExponent(readMsg), delay: delayMsg, resultScale: 'D', resultValue: prodMsg });
      }
    }

    function stepDivide(op, divisionIndexInChain, inDivisionChain, chainSlideShift, cursorAtIndex) {
      var divisor = op.right;
      var dividend = (op.left != null && op.left !== undefined) ? toMantissa(op.left).m : currentMantissa;
      if (dividend === 1 && op.left === 1 && profile.hasDI) {
        resultOnDI = true;
        lastResultOnD = false;
        var valueOnD = divisor;
        var recip = op.result;
        var manD = toMantissa(valueOnD);
        var manR = toMantissa(recip);
        currentMantissa = manR.m;
        currentExp = manR.exp;
        exponentLogReason = 'reciprocal: ' + formatSigFig(valueOnD, PREC) + ' = ' + formatSigFig(manD.m, PREC) + '\u00d710^' + manD.exp + ' \u2192 1/x = ' + formatSigFig(manR.m, PREC) + '\u00d710^' + manR.exp;
        steps.push({ action: displayMessageWithExponent('No movement needed. The value on D is ' + formatSigFig(valueOnD, PREC_FINAL) + '. Read its reciprocal on the DI scale: ' + formatSigFig(recip, PREC_FINAL) + '. \u2016 Exponent: ' + formatSigFig(valueOnD, PREC) + ' = ' + formatSigFig(manD.m, PREC) + '\u00d710^' + manD.exp + ', so 1/x = ' + formatSigFig(manR.m, PREC) + '\u00d710^' + manR.exp + '.'), delay: delayMsg, resultScale: 'DI', resultValue: formatSigFig(recip, PREC_FINAL) });
        steps.push({ action: function () {
          if (typeof currentSideHasScales === 'function' && !currentSideHasScales(['D', 'DI']) && typeof changeSide === 'function') changeSide('back');
          ensureSide(['D', 'DI']);
        }, delay: delayAction });
        return;
      }
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
      var readIndex = whichIndex(newSlideShift, manQuot.m);
      var indexLabel = (readIndex === 10) ? 'right index (10)' : 'left index (1)';

      // DI scale (Decilon): flip to back, cursor to dividend on D, slide so divisor on DI under cursor, read quotient on D under index.
      if (profile.hasDI && (!inDivisionChain || divisionIndexInChain === 0)) {
        sidesUsed.back = true;
        currentExp = manQuot.exp;
        exponentLogReason = 'divide by ' + formatSigFig(manDiv.m, PREC) + '\u00d710^' + manDiv.exp;
        steps.push({ action: displayMessageWithExponent('Divide by ' + formatSigFig(divisor, PREC) + ' using the DI scale (back side). Set the cursor to ' + formatSigFig(dividend, PREC) + ' on the D scale.'), delay: delayMsg });
        steps.push({ action: function () { undimScales(['D', 'DI']); changeMarkings('hairline', true); }, delay: 500 });
        steps.push({ action: displayMessageWithExponent('Move the slide so ' + formatSigFig(divisorM, PREC) + ' on the DI scale is under the cursor. The quotient (' + quotMsg + ') is on the D scale under the ' + indexLabel + '.'), delay: delayMsg });
        steps.push({ action: function () {
          if (typeof currentSideHasScales === 'function' && !currentSideHasScales(['D', 'DI']) && typeof changeSide === 'function') changeSide('back');
          ensureSide(['D', 'DI']);
          cursorTo('D', dividend);
          slideTo('DI', divisorM);
        }, delay: delayAction, resultScale: 'D', resultValue: quotMsg });
        return { slideShift: newSlideShift, cursorAtIndex: true };
      }

      var useCIorCIF = (inDivisionChain && divisionIndexInChain > 0 && cursorAtIndex &&
        chooseDivisionMethod(chainSlideShift, divisorM));
      var method = (useCIorCIF === 'CI' || useCIorCIF === 'CIF') ? useCIorCIF : 'C';

      if (method === 'CI') {
        currentExp = manQuot.exp;
        exponentLogReason = 'divide by ' + formatSigFig(manDiv.m, PREC) + '\u00d710^' + manDiv.exp;
        ensureFrontWithCI();
        steps.push({ action: function () { undimScales(['C', 'D', 'CI']); changeMarkings('hairline', true); }, delay: 500 });
        steps.push({ action: displayMessageWithExponent('Divide by ' + formatSigFig(divisor, PREC) + ': Move the cursor to ' + formatSigFig(divisorM, PREC) + ' on the CI scale. Read the intermediate result (' + quotMsg + ') on the D scale under the cursor.'), delay: delayMsg, resultScale: 'D', resultValue: quotMsg });
        steps.push({ action: function () { ensureSide(['C', 'D', 'CI']); cursorTo('CI', divisorM); }, delay: delayAction });
        return { slideShift: chainSlideShift, cursorAtIndex: false };
      }
      if (method === 'CIF') {
        currentExp = manQuot.exp;
        exponentLogReason = 'divide by ' + formatSigFig(manDiv.m, PREC) + '\u00d710^' + manDiv.exp;
        ensureFrontWithCI();
        steps.push({ action: function () { undimScales(['C', 'D', 'CI', 'CIF', 'DF']); changeMarkings('hairline', true); }, delay: 500 });
        steps.push({ action: displayMessageWithExponent('Divide by ' + formatSigFig(divisor, PREC) + ': Move the cursor to ' + formatSigFig(divisorM, PREC) + ' on the CIF scale. Read the intermediate result (' + quotMsg + ') on the D scale under the cursor.'), delay: delayMsg, resultScale: 'D', resultValue: quotMsg });
        steps.push({ action: function () { ensureSide(['C', 'D', 'CI', 'CIF', 'DF']); cursorTo('CIF', divisorM); }, delay: delayAction });
        return { slideShift: chainSlideShift, cursorAtIndex: false };
      }

      ensureFront();
      steps.push({ action: function () { undimScales(['C', 'D']); changeMarkings('hairline', true); }, delay: 500 });
      currentExp = manQuot.exp;
      exponentLogReason = 'divide by ' + formatSigFig(manDiv.m, PREC) + '\u00d710^' + manDiv.exp + (readIndex === 10 ? ' \u22121 (index shift: slide left)' : '');
      if (!inDivisionChain || divisionIndexInChain === 0) {
        steps.push({ action: displayMessageWithExponent('Set the cursor to ' + formatSigFig(dividend, PREC) + ' on the D scale (the dividend).'), delay: delayMsg });
        steps.push({
          action: function () {
            if (typeof currentSideHasScales === 'function' && !currentSideHasScales(['C', 'D']) && typeof changeSide === 'function') changeSide('front');
            ensureSide(['C', 'D']);
            cursorTo('D', dividend);
          },
          delay: delayAction
        });
      }
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
      steps.push({ action: displayMessageWithExponent((inDivisionChain ? 'Intermediate result (' : 'Result (') + quotMsg + ') on the D scale under the ' + indexLabel + '.'), delay: delayMsg, resultScale: 'D', resultValue: quotMsg });
      return { slideShift: newSlideShift, cursorAtIndex: true };
    }

    function llScaleForValue(value) {
      if (value <= 0 || value <= 1) return null;
      var ln = Math.log(value);
      if (ln <= 0.1) return 'Ln1';
      if (ln <= 1) return 'Ln2';
      if (ln <= 10) return 'Ln3';
      return null;
    }

    function llPowerCIndex(base, result) {
      var useRight = (base < 1 && result > 1);
      return { index: useRight ? 10 : 1, label: useRight ? 'right index (10)' : 'left index (1)' };
    }

    function llDownScaleForValue(value) {
      if (value <= 0 || value >= 1) return null;
      var x = -Math.log(value);
      if (x >= 0.1 && x < 1.25) return 'Ln-2';
      if (x >= 1.25 && x <= 10) return 'Ln-3';
      if (x >= 0.01 && x < 0.1) return 'Ln-1';
      if (x >= 0.001 && x < 0.01) return 'Ln-0';
      if (x > 10) return 'Ln-3';
      if (x > 0 && x < 0.001) return 'Ln-0';
      return 'Ln-3';
    }

    function isLLDownScaleLeft(left) {
      if (!left || typeof left !== 'string') return false;
      return left.indexOf('LL0') >= 0 || left.indexOf('LL/') >= 0 || left.indexOf('Ln-') >= 0;
    }

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
            var isUp = left && (left === 'LL1' || left === 'LL2' || left === 'LL3' || left.indexOf('LL2') >= 0 || left.indexOf('LL3') >= 0 || left.indexOf('LL1') >= 0 || left === 'Ln0' || left === 'Ln1' || left === 'Ln2' || left === 'Ln3' || (left.indexOf && left.indexOf('Ln') === 0 && left.indexOf('Ln-') < 0));
            if (isUp && typeof scale.location === 'function') {
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
      var r1 = scaleName('R1');
      var r2 = scaleName('R2');
      var kScale = scaleName('K');
      if (exp === 2) {
        ensureFront();
        if (profile.hasA) {
          steps.push({ action: function () { ensureSide(['A', 'D']); sidesUsed.front = true; }, delay: 100 });
          steps.push({ action: function () { undimScales(['A', 'D']); changeMarkings('hairline', true); }, delay: 500 });
          steps.push({ action: displayMessageWithExponent('Square: cursor to ' + formatSigFig(manBase.m, PREC) + ' on D, read ' + formatSigFig(result, PREC_FINAL) + ' on A.'), delay: delayMsg });
          steps.push({ action: function () { cursorTo('D', manBase.m); }, delay: delayAction });
          steps.push({ action: displayMessageWithExponent('Read result on A scale: ' + formatSigFig(result, PREC_FINAL)), delay: delayMsg, resultScale: 'A', resultValue: formatSigFig(result, PREC_FINAL) });
        } else {
          var nDigitsSq = digitsLeftOfDecimal(result);
          var useR1Sq = (nDigitsSq % 2 === 1);
          var rScaleSq = useR1Sq ? r1 : r2;
          var rHintSq = useR1Sq ? 'Odd number of digits in result → use ' + r1 + '.' : 'Even number of digits in result → use ' + r2 + '.';
          steps.push({ action: function () { ensureSide([r1, r2, 'D']); sidesUsed.front = true; }, delay: 100 });
          steps.push({ action: function () { undimScales([r1, r2, 'D']); changeMarkings('hairline', true); }, delay: 500 });
          steps.push({ action: displayMessageWithExponent('Square: cursor to ' + formatSigFig(manBase.m, PREC) + ' on D, read ' + formatSigFig(result, PREC_FINAL) + ' on ' + rScaleSq + '. ' + rHintSq), delay: delayMsg });
          steps.push({ action: function () { cursorTo('D', manBase.m); }, delay: delayAction });
          steps.push({ action: displayMessageWithExponent('Read result on ' + rScaleSq + ' scale: ' + formatSigFig(result, PREC_FINAL)), delay: delayMsg, resultScale: rScaleSq, resultValue: formatSigFig(result, PREC_FINAL) });
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
          steps.push({ action: displayMessageWithExponent('Read result on D scale: ' + formatSigFig(result, PREC_FINAL)), delay: delayMsg, resultScale: 'D', resultValue: formatSigFig(result, PREC_FINAL) });
        } else {
          var nDigitsSqrtPow = digitsLeftOfDecimal(base);
          var useR1SqrtPow = (nDigitsSqrtPow % 2 === 1);
          var rScaleSqrtPow = useR1SqrtPow ? r1 : r2;
          var rHintSqrtPow = useR1SqrtPow ? 'Odd number of digits to the left of the decimal → use ' + r1 + '.' : 'Even number of digits to the left of the decimal → use ' + r2 + '.';
          steps.push({ action: function () { ensureSide([r1, r2, 'D']); sidesUsed.front = true; }, delay: 100 });
          steps.push({ action: function () { undimScales([r1, r2, 'D']); changeMarkings('hairline', true); }, delay: 500 });
          steps.push({ action: displayMessageWithExponent('Square root of ' + formatSigFig(base, PREC) + ': use square scales. Set cursor on ' + formatSigFig(manBase.m, PREC) + ' on D, read ' + formatSigFig(result, PREC_FINAL) + ' on ' + rScaleSqrtPow + '. ' + rHintSqrtPow), delay: delayMsg });
          steps.push({ action: function () { cursorTo('D', manBase.m); }, delay: delayAction });
          steps.push({ action: displayMessageWithExponent('Result ' + formatSigFig(result, PREC_FINAL) + ' on ' + rScaleSqrtPow + ' scale.'), delay: delayMsg, resultScale: rScaleSqrtPow, resultValue: formatSigFig(result, PREC_FINAL) });
        }
        currentExp = Math.floor(currentExp / 2);
        exponentLogReason = 'sqrt: exponent \u00f7 2';
      } else if (exp === 3) {
        ensureFront();
        steps.push({ action: function () { ensureSide([kScale, 'D']); sidesUsed.front = true; }, delay: 100 });
        steps.push({ action: function () { undimScales([kScale, 'D']); changeMarkings('hairline', true); }, delay: 500 });
        steps.push({ action: displayMessageWithExponent('Cube: cursor to ' + formatSigFig(manBase.m, PREC) + ' on D, read ' + formatSigFig(result, PREC_FINAL) + ' on ' + kScale + '.'), delay: delayMsg });
        steps.push({ action: function () { cursorTo('D', manBase.m); }, delay: delayAction });
        steps.push({ action: displayMessageWithExponent('Read result on ' + kScale + ' scale: ' + formatSigFig(result, PREC_FINAL)), delay: delayMsg, resultScale: kScale, resultValue: formatSigFig(result, PREC_FINAL) });
        currentExp = currentExp * 3;
        exponentLogReason = 'cube: exponent \u00d7 3';
        lastResultOnD = false;
      } else if (Math.abs(exp - 1/3) < 1e-9) {
        ensureFront();
        var third = cubeRootThird(base);
        var thirdName = (third === 0) ? 'left' : (third === 1 ? 'middle' : 'right');
        steps.push({ action: function () { ensureSide([kScale, 'D']); sidesUsed.front = true; }, delay: 100 });
        steps.push({ action: function () { undimScales([kScale, 'D']); changeMarkings('hairline', true); }, delay: 500 });
        steps.push({ action: displayMessageWithExponent('Cube root: use ' + thirdName + ' third of ' + kScale + '. Cursor to ' + formatSigFig(base, PREC) + ' on ' + kScale + ', read ' + formatSigFig(result, PREC_FINAL) + ' on D.'), delay: delayMsg });
        steps.push({ action: function () { cursorTo(kScale, manBase.m); }, delay: delayAction });
        steps.push({ action: displayMessageWithExponent('Read result on D scale: ' + formatSigFig(result, PREC_FINAL)), delay: delayMsg, resultScale: 'D', resultValue: formatSigFig(result, PREC_FINAL) });
        currentExp = Math.floor(currentExp / 3);
        exponentLogReason = 'cube root: exponent \u00f7 3';
      } else {
        // LL power steps: use same structure as Hemmi but with Decilon scale names (Ln1, Ln2, Ln3, Ln-0..Ln-3)
        var baseScaleLabel = llScaleForValue(base);
        var baseScaleName = findLLScaleNameForValue(base);
        var resultDownLabel = llDownScaleForValue(result);
        var resultDownScaleName = findLLDownScaleNameForValue(result);
        if (base > 0 && exp < 0 && result > 0 && result < 1 && baseScaleName && resultDownScaleName) {
          ensureBack();
          var scalesToShow = [baseScaleName, resultDownScaleName, 'C', 'D'];
          steps.push({ action: function () { ensureSide(scalesToShow); sidesUsed.back = true; }, delay: 100 });
          steps.push({ action: function () { undimScales(scalesToShow); changeMarkings('hairline', true); }, delay: 500 });
          var expMag = -exp;
          var expM = (expMag <= 10) ? expMag : expMag / Math.pow(10, Math.floor(Math.log10(expMag)));
          var cIndexNeg = llPowerCIndex(base, result);
          steps.push({ action: displayMessageWithExponent('Negative power ' + formatSigFig(base, PREC) + '^(' + exp + ') = ' + formatSigFig(result, PREC_FINAL) + ': use the LL scale for the base and the LL down scale for the result.'), delay: delayMsg });
          steps.push({ action: function () { cursorTo(baseScaleName, base); }, delay: delayAction });
          steps.push({ action: function () { slideTo('C', cIndexNeg.index); }, delay: delayAction });
          steps.push({ action: function () { cursorTo('C', expM); }, delay: delayAction });
          steps.push({ action: displayMessageWithExponent('Read ' + formatSigFig(result, PREC_FINAL) + ' under the cursor on the ' + resultDownScaleName + ' scale.'), delay: delayMsg, resultScale: resultDownScaleName, resultValue: formatSigFig(result, PREC_FINAL) });
          currentMantissa = manResult.m;
          currentExp = manResult.exp;
          exponentLogReason = 'negative power: result exponent';
          lastWasBack = true;
          lastResultOnD = false;
        } else if (base > 0 && result > 0 && baseScaleName) {
          ensureBack();
          var scalesToShowP = [baseScaleName, 'C', 'D'];
          var resultScaleName = findLLScaleNameForValue(result);
          if (resultScaleName && resultScaleName !== baseScaleName) scalesToShowP.push(resultScaleName);
          steps.push({ action: function () { ensureSide(scalesToShowP); sidesUsed.back = true; }, delay: 100 });
          steps.push({ action: function () { undimScales(scalesToShowP); changeMarkings('hairline', true); }, delay: 500 });
          var expM = (exp < 0.1) ? exp * 100 : (exp < 1) ? exp * 10 : (exp <= 10) ? exp : exp / Math.pow(10, Math.floor(Math.log10(exp)));
          var cIndexPos = llPowerCIndex(base, result);
          steps.push({ action: displayMessageWithExponent('Power ' + formatSigFig(base, PREC) + '^' + exp + ': set the cursor over ' + formatSigFig(base, PREC) + ' on the ' + (baseScaleLabel || baseScaleName) + ' scale.'), delay: delayMsg });
          steps.push({ action: function () { cursorTo(baseScaleName, base); }, delay: delayAction });
          steps.push({ action: function () { slideTo('C', cIndexPos.index); }, delay: delayAction });
          steps.push({ action: function () { cursorTo('C', expM); }, delay: delayAction });
          steps.push({ action: displayMessageWithExponent('Read ' + formatSigFig(result, PREC_FINAL) + ' under the cursor on the ' + (resultScaleName || baseScaleName) + ' scale.'), delay: delayMsg, resultScale: resultScaleName || baseScaleName, resultValue: formatSigFig(result, PREC_FINAL) });
          currentExp = Math.floor(Math.log10(Math.abs(result)));
          exponentLogReason = 'power: result exponent';
          lastWasBack = true;
          lastResultOnD = false;
        } else {
          steps.push({ action: displayMessageWithExponent('Power ' + exp + ': result ' + formatSigFig(result, PREC_FINAL) + ' (use C/D or log method if needed).'), delay: delayMsg });
        }
      }
    }

    function stepSqrt(op, isFinalOp) {
      var arg = op.arg;
      var result = op.result;
      var manArg = toMantissa(arg);
      var manResult = toMantissa(result);
      currentMantissa = manResult.m;
      var r1 = scaleName('R1');
      var r2 = scaleName('R2');
      if (isFinalOp) {
        ensureBack();
        var nDigits = digitsLeftOfDecimal(arg);
        var useR1 = (nDigits % 2 === 1);
        var rScale = useR1 ? r1 : r2;
        var rHint = useR1 ? 'Odd number of digits to the left of the decimal → use ' + r1 + '.' : 'Even number of digits to the left of the decimal → use ' + r2 + '.';
        steps.push({ action: function () { ensureSide([r1, r2, 'D']); sidesUsed.back = true; }, delay: 100 });
        steps.push({ action: function () { undimScales([r1, r2, 'D']); changeMarkings('hairline', true); }, delay: 500 });
        currentExp = manResult.exp;
        exponentLogReason = 'sqrt: exponent \u00f7 2';
        steps.push({ action: displayMessageWithExponent('Square root of ' + formatSigFig(arg, PREC) + ' (final result): set the cursor on ' + formatSigFig(manArg.m, PREC) + ' on the D scale and read the result on ' + rScale + '. ' + rHint), delay: delayMsg });
        steps.push({ action: function () { cursorTo('D', manArg.m); }, delay: delayAction });
        steps.push({ action: displayMessageWithExponent('Result ' + formatSigFig(result, PREC_FINAL) + ' on ' + rScale + ' scale.'), delay: delayMsg, resultScale: rScale, resultValue: formatSigFig(result, PREC_FINAL) });
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
          steps.push({ action: displayMessageWithExponent('Result ' + formatSigFig(result, PREC_FINAL) + ' on D scale.'), delay: delayMsg, resultScale: 'D', resultValue: formatSigFig(result, PREC_FINAL) });
          currentExp = manResult.exp;
          exponentLogReason = 'sqrt: exponent \u00f7 2';
          lastResultOnD = true;
        } else {
          var nDigitsSqrt = digitsLeftOfDecimal(arg);
          var useR1Sqrt = (nDigitsSqrt % 2 === 1);
          var rScaleSqrt = useR1Sqrt ? r1 : r2;
          var rHintSqrt = useR1Sqrt ? 'Odd number of digits to the left of the decimal → use ' + r1 + '.' : 'Even number of digits to the left of the decimal → use ' + r2 + '.';
          steps.push({ action: function () { ensureSide([r1, r2, 'D']); sidesUsed.front = true; }, delay: 100 });
          steps.push({ action: function () { undimScales([r1, r2, 'D']); changeMarkings('hairline', true); }, delay: 500 });
          steps.push({ action: displayMessageWithExponent('Square root of ' + formatSigFig(arg, PREC) + ': set cursor on ' + formatSigFig(manArg.m, PREC) + ' on D, read ' + formatSigFig(result, PREC_FINAL) + ' on ' + rScaleSqrt + '. ' + rHintSqrt), delay: delayMsg });
          steps.push({ action: function () { cursorTo('D', manArg.m); }, delay: delayAction });
          steps.push({ action: displayMessageWithExponent('Result on ' + rScaleSqrt + ' scale. Re-enter this value on C or D for the next step.'), delay: delayMsg, resultScale: rScaleSqrt, resultValue: formatSigFig(result, PREC_FINAL) });
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
        steps.push({ action: displayMessageWithExponent('Angle ' + formatSigFig(arg, PREC) + '\u00b0 is below the S scale range (~5.7\u00b0). Use the SRT scale: cursor to ' + formatSigFig(arg, PREC) + ' on SRT, read on D.'), delay: delayMsg });
        steps.push({ action: function () { cursorTo('SRT', arg); }, delay: delayAction });
      } else {
        steps.push({ action: displayMessageWithExponent('Sine of ' + formatSigFig(arg, PREC) + ' degrees: cursor to angle on S, read value on D.'), delay: delayMsg });
        steps.push({ action: function () { cursorTo('S', arg); }, delay: delayAction });
      }
      steps.push({ action: displayMessageWithExponent('Read sin = ' + formatSigFig(result, PREC_FINAL) + ' on D (adjust decimal).'), delay: delayMsg, resultScale: 'D', resultValue: formatSigFig(result, PREC_FINAL) });
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
        steps.push({ action: displayMessageWithExponent('cos(θ) = sin(90−θ). Use SRT: cursor to ' + formatSigFig(comp, PREC) + '\u00b0 on SRT, read on D.'), delay: delayMsg });
        steps.push({ action: function () { cursorTo('SRT', comp); }, delay: delayAction });
      } else {
        steps.push({ action: displayMessageWithExponent('Cosine: cos(θ) = sin(90−θ). Cursor to ' + formatSigFig(comp, PREC) + '\u00b0 on S, read on D.'), delay: delayMsg });
        steps.push({ action: function () { cursorTo('S', comp); }, delay: delayAction });
      }
      steps.push({ action: displayMessageWithExponent('Read cos = ' + formatSigFig(result, PREC_FINAL) + ' on D.'), delay: delayMsg, resultScale: 'D', resultValue: formatSigFig(result, PREC_FINAL) });
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
      steps.push({ action: displayMessageWithExponent('Read tan = ' + formatSigFig(result, PREC_FINAL) + ' on D.'), delay: delayMsg, resultScale: 'D', resultValue: formatSigFig(result, PREC_FINAL) });
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
      var lScale = profile.scaleL || 'L';
      steps.push({ action: function () { ensureSide([lScale, 'D']); sidesUsed.back = true; }, delay: 100 });
      steps.push({ action: function () { undimScales([lScale, 'D']); changeMarkings('hairline', true); }, delay: 500 });
      var manArg = toMantissa(arg);
      steps.push({ action: displayMessageWithExponent('Log10 of ' + formatSigFig(arg, PREC) + ': cursor to value on D, read on L.'), delay: delayMsg });
      steps.push({ action: function () { cursorTo('D', manArg.m); }, delay: delayAction });
      steps.push({ action: displayMessageWithExponent('Read log10 = ' + formatSigFig(result, PREC_FINAL) + ' on the L scale.'), delay: delayMsg, resultScale: 'L', resultValue: formatSigFig(result, PREC_FINAL) });
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
        steps.push({ action: displayMessageWithExponent('Natural log of ' + formatSigFig(arg, PREC) + ': find ' + formatSigFig(arg, PREC) + ' on the ' + llScaleLabel + ' scale, read ln on D.'), delay: delayMsg });
        steps.push({ action: function () { cursorTo(llScaleName, arg); }, delay: delayAction });
        steps.push({ action: displayMessageWithExponent('Read ln = ' + formatSigFig(result, PREC_FINAL) + ' on the D scale.'), delay: delayMsg, resultScale: 'D', resultValue: formatSigFig(result, PREC_FINAL) });
        currentMantissa = result >= 1 && result < 10 ? result : (result < 1 ? result * 10 : result / 10);
        if (currentMantissa >= 10) currentMantissa /= 10;
        currentExp = result !== 0 && isFinite(result) ? Math.floor(Math.log10(Math.abs(result))) : 0;
        exponentLogReason = 'log result (value for next step)';
        lastWasBack = true;
        lastResultOnD = true;
      } else {
        ensureBack();
        var lScale = profile.scaleL || 'L';
        steps.push({ action: function () { ensureSide([lScale, 'D']); sidesUsed.back = true; }, delay: 100 });
        steps.push({ action: function () { undimScales([lScale, 'D']); changeMarkings('hairline', true); }, delay: 500 });
        steps.push({ action: displayMessageWithExponent('Natural log of ' + formatSigFig(arg, PREC) + ': cursor to value on D, read log10 on L. Then ln(x) = log10(x) × 2.303.'), delay: delayMsg });
        steps.push({ action: function () { cursorTo('D', manArg.m); }, delay: delayAction });
        steps.push({ action: displayMessageWithExponent('Read log10 on L, then ln(x) = log10(x) × 2.303 = ' + formatSigFig(result, PREC_FINAL)), delay: delayMsg, resultScale: 'L', resultValue: formatSigFig(result, PREC_FINAL) });
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
    var resultOnDI = false;
    var isReciprocalOnly = false;
    var loopStartIndex = 0;
    if (ops.length >= 2 && ops[0].op === 'init' && ops[0].value === 1 && ops[ops.length - 1].op === '/' && ops[ops.length - 1].left === 1) {
      loopStartIndex = 1;
    }

    if (profile.hasDI && ops.length === 3 && ops[0].op === 'init' && ops[0].value === 1 && ops[1].op === 'init' && ops[2].op === '/' && ops[2].left === 1) {
      isReciprocalOnly = true;
      resultOnDI = true;
      lastResultOnD = false;
      var valueOnD = ops[2].right;
      var recip = ops[2].result;
      var manD = toMantissa(valueOnD);
      var manR = toMantissa(recip);
      currentExp = manR.exp;
      exponentLogReason = 'reciprocal: ' + formatSigFig(valueOnD, PREC) + ' = ' + formatSigFig(manD.m, PREC) + '\u00d710^' + manD.exp + ' \u2192 1/x = ' + formatSigFig(manR.m, PREC) + '\u00d710^' + manR.exp;
      steps.push({ action: displayMessageWithExponent('Calculate: ' + equationStr), delay: 500 });
      steps.push({ action: function () { undimScales(['D', 'DI']); changeMarkings('hairline', true); }, delay: 500 });
      steps.push({ action: displayMessageWithExponent('No movement needed. The value on D is ' + formatSigFig(valueOnD, PREC_FINAL) + '. Read its reciprocal on the DI scale: ' + formatSigFig(recip, PREC_FINAL) + '. \u2016 Exponent: ' + formatSigFig(valueOnD, PREC) + ' = ' + formatSigFig(manD.m, PREC) + '\u00d710^' + manD.exp + ', so 1/x = ' + formatSigFig(manR.m, PREC) + '\u00d710^' + manR.exp + '.'), delay: delayMsg, resultScale: 'DI', resultValue: formatSigFig(recip, PREC_FINAL), isFinalStep: true });
      steps.push({ action: function () {
        if (typeof currentSideHasScales === 'function' && !currentSideHasScales(['D', 'DI']) && typeof changeSide === 'function') changeSide('back');
        ensureSide(['D', 'DI']);
      }, delay: delayAction });
    }

    if (!isReciprocalOnly) {
    for (var i = loopStartIndex; i < ops.length; i++) {
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
          } else if (i + 2 < ops.length && ops[i + 1].op === 'init' && ops[i + 2].op === '*') {
            var useRightIndexDenom = false;
            var secondValDenom = ops[i + 1].value;
            var manSecondDenom = toMantissa(secondValDenom);
            if (op.value * manSecondDenom.m >= 10) useRightIndexDenom = true;
            stepInit(op, useRightIndexDenom);
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
    }

    var finalVal = finalResult;
    var finalMan = toMantissa(finalResult);
    var r1 = scaleName('R1');
    var r2 = scaleName('R2');
    var finalResultScale = resultOnDI ? 'DI' : (lastWasFinalSqrt ? (digitsLeftOfDecimal(finalVal) % 2 === 1 ? r1 : r2) : 'D');
    if (!isReciprocalOnly) steps.unshift({ action: function () { if (typeof resetSlidePosition === 'function') resetSlidePosition(); ensureSide(['C', 'D']); cursorTo('D', 1); slideTo('C', 1); }, delay: 0 });
    var _resultExp = currentExp;
    var _resultReason = exponentLogReason;
    steps.push({ action: function () {
      if (resultOnDI) ensureSide(['D', 'DI']);
      else if (lastWasFinalSqrt) ensureSide([r1, r2, 'D']);
      else if (lastWasBack) ensureSide(['S', 'D']);
      else ensureSide(['C', 'D']);
      isolate();
      sliderules.objective = function () {
        var ok = false;
        if (resultOnDI) ok = checkValue('DI', finalMan.m);
        else if (lastResultOnD) ok = checkValue('D', finalMan.m);
        else ok = true;
        if (ok) {
          message('Result: ' + equationStr + ' = ' + formatSigFig(finalVal, PREC_FINAL) + ' \u2016 Exponent log: ' + _resultExp + (_resultReason ? ' \u2014 ' + _resultReason : ''));
          return true;
        }
        return false;
      };
    }, delay: delayObj, resultScale: finalResultScale, resultValue: formatSigFig(finalVal, PREC_FINAL), isFinalStep: true });
    steps.push({ action: function () { isolate(); message('Try again or enter another equation.'); }, delay: 4000 });

    for (var vi = 0; vi < steps.length; vi++) {
      var actionStr = steps[vi].action.toString();
      var setupOnly = (actionStr.indexOf('ensureSide') !== -1 && actionStr.indexOf('message') === -1 && actionStr.indexOf('cursorTo') === -1 && actionStr.indexOf('slideTo') === -1) ||
          (actionStr.indexOf('undimScales') !== -1 && actionStr.indexOf('message') === -1 && actionStr.indexOf('cursorTo') === -1 && actionStr.indexOf('slideTo') === -1);
      steps[vi].visible = !setupOnly;
    }
    return steps;
  }

  function generateTutorial(equationString, messageFn, options) {
    if (!parseEquation || !messageFn) return { error: true, message: 'Missing equation parser or message function', start: 0, end: 0 };
    var parsed = parseEquation(equationString, options);
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
