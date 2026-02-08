///////////////////////////////////////////////////////////////////////////////////
// Dynamic tutorial generator for Hemmi Versalog II.
// Converts a parsed equation (AST + value) into tutorial steps.
// Depends: equation_parser.js, sliderule_ctrl.js, crnu/rndlist from construction kit.
///////////////////////////////////////////////////////////////////////////////////

(function () {
  'use strict';

  var evaluate = window.equation_parser && window.equation_parser.evaluate;
  var parseEquation = window.equation_parser && window.equation_parser.parseEquation;

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
    var currentMantissa = null;
    var currentExp = 0;
    var sidesUsed = { front: false, back: false };
    var lastWasBack = false;
    var lastResultOnD = true;

    // ——— Rule book: body limits, scale positions, division/mult and index choice ———
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
      lastWasBack = false;
      lastResultOnD = true;
      ensureFront();
      var cIndex = (useRightIndex === true) ? 10 : 1;
      var indexLabel = (useRightIndex === true) ? 'right index (10)' : 'left index (1)';
      var indexReason = (useRightIndex === true) ? ' (Product will be over 10; use right index so the result stays on the D scale.)' : '';
      steps.push({ action: function () { message('Calculate: ' + equationStr); }, delay: 500 });
      steps.push({ action: function () { undimScales(['C', 'D']); changeMarkings('hairline', true); }, delay: 500 });
      steps.push({ action: function () { message('First factor is ' + crnu(v, 5) + '. Move the slide so the ' + indexLabel + ' on C is over ' + crnu(v, 5) + ' on the D scale.' + indexReason); }, delay: delayMsg });
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
      lastWasBack = false;
      lastResultOnD = true;
      ensureFront();
      steps.push({ action: function () { message('Calculate: ' + equationStr); }, delay: 500 });
      steps.push({ action: function () { undimScales(['C', 'D']); changeMarkings('hairline', true); }, delay: 500 });
      steps.push({ action: function () { message('Division chain: set the dividend. Move the cursor to ' + crnu(v, 5) + ' on the D scale.'); }, delay: delayMsg });
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
        steps.push({
          action: function () {
            var flipMsg = (typeof currentSideHasScales === 'function' && currentSideHasScales(['C', 'D']))
              ? 'The cursor is linked—it is already at the correct position. The value you are multiplying is ' + crnu(actualVal, 5) + ' (mantissa ' + crnu(transferVal, 5) + ' on D). C and D are on this side; no need to flip.'
              : 'Flip the rule to the front. The cursor is linked—it is already at the correct position. The value you are multiplying is ' + crnu(actualVal, 5) + ' (mantissa ' + crnu(transferVal, 5) + ' on D).';
            message(flipMsg);
          },
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
      var a = currentMantissa;
      var b = op.right;
      var manB = toMantissa(b);
      var prod = op.result;
      var manProd = toMantissa(prod);
      var cursorCVal = manB.m;
      var prodMsg = crnu(prod, 5);
      currentMantissa = manProd.m;
      currentExp = currentExp + manB.exp;
      lastResultOnD = true;
      ensureFront();
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
      var firstFactor = a;
      var cIndex = useRightIndex ? 10 : 1;
      if (useCF) {
        steps.push({ action: function () { undimScales(['CF', 'DF']); changeMarkings('hairline', true); }, delay: 500 });
        steps.push({ action: function () { message('Second factor ' + crnu(cursorCVal, 5) + ' would be off C; use folded scales. Set cursor to ' + crnu(firstFactor, 5) + ' on DF, align index on CF, then cursor to ' + crnu(cursorCVal, 5) + ' on CF and read product on DF.'); }, delay: delayMsg });
        steps.push({ action: function () {
          if (typeof currentSideHasScales === 'function' && !currentSideHasScales(['CF', 'DF']) && typeof changeSide === 'function') changeSide('front');
          ensureSide(['CF', 'DF']);
          cursorTo('DF', firstFactor);
        }, delay: delayAction });
        steps.push({ action: function () { slideTo('CF', 1); }, delay: delayAction });
        steps.push({ action: function () { cursorTo('CF', cursorCVal); }, delay: delayAction });
        steps.push({ action: function () { message('Read intermediate result ' + prodMsg + ' on DF.'); }, delay: delayMsg });
      } else {
        steps.push({ action: function () { undimScales(['C', 'D']); changeMarkings('hairline', true); }, delay: 500 });
        steps.push({ action: function () {
          message(useRightIndex ? 'Move the slide so the right index (10) on C is over ' + crnu(firstFactor, 5) + ' on the D scale.' : 'Move the slide so the left index (1) on C is over ' + crnu(firstFactor, 5) + ' on the D scale.');
        }, delay: delayMsg });
        steps.push({ action: function () {
          if (typeof currentSideHasScales === 'function' && !currentSideHasScales(['C', 'D']) && typeof changeSide === 'function') changeSide('front');
          ensureSide(['C', 'D']);
          cursorTo('D', firstFactor);
        }, delay: delayAction });
        steps.push({ action: function () { slideTo('C', cIndex); }, delay: delayAction });
        steps.push({ action: function () { message('Move the cursor to ' + crnu(cursorCVal, 5) + ' on the C scale.'); }, delay: delayMsg });
        steps.push({ action: function () { cursorTo('C', cursorCVal); }, delay: delayAction });
        steps.push({ action: function () { message('Read intermediate result ' + prodMsg + ' on D.' + (useRightIndex ? ' (Adjust decimal: result is ' + prodMsg + '.)' : '')); }, delay: delayMsg });
      }
    }

    // Division: CI/CIF shortcut only when cursor is AT THE INDEX (result under index).
    // After using CI/CIF, cursor is over the quotient on D (not at index); next division must move the slide.
    function stepDivide(op, divisionIndexInChain, inDivisionChain, chainSlideShift, cursorAtIndex) {
      if (lastWasBack) {
        ensureFront();
        var transferVal = currentMantissa;
        steps.push({
          action: function () {
            var msg = (typeof currentSideHasScales === 'function' && currentSideHasScales(['C', 'D']))
              ? 'Set cursor to ' + crnu(transferVal, 5) + ' on D (C and D are on this side; no need to flip).'
              : 'Result so far is on the other side. Switch to front and set cursor to ' + crnu(transferVal, 5) + ' on D.';
            message(msg);
          },
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
      var dividend = currentMantissa;
      var divisor = op.right;
      var manDiv = toMantissa(divisor);
      var quot = op.result;
      var manQuot = toMantissa(quot);
      var divisorM = manDiv.m;
      var quotMsg = crnu(quot, 5);
      currentMantissa = manQuot.m;
      currentExp = currentExp - manDiv.exp;
      lastResultOnD = true;
      var newSlideShift = Math.log10(dividend) - Math.log10(divisorM);

      var useCIorCIF = (inDivisionChain && divisionIndexInChain > 0 && cursorAtIndex &&
        chooseDivisionMethod(chainSlideShift, divisorM));
      var method = (useCIorCIF === 'CI' || useCIorCIF === 'CIF') ? useCIorCIF : 'C';

      if (method === 'CI') {
        ensureFrontWithCI();
        steps.push({ action: function () { undimScales(['C', 'D', 'CI']); changeMarkings('hairline', true); }, delay: 500 });
        steps.push({ action: function () { message('Divide by ' + crnu(divisor, 5) + ': Move the cursor to ' + crnu(divisorM, 5) + ' on the CI scale. Read the intermediate result (' + quotMsg + ') on the D scale under the cursor.'); }, delay: delayMsg });
        steps.push({ action: function () { ensureSide(['C', 'D', 'CI']); cursorTo('CI', divisorM); }, delay: delayAction });
        return { slideShift: chainSlideShift, cursorAtIndex: false };
      }
      if (method === 'CIF') {
        ensureFrontWithCI();
        steps.push({ action: function () { undimScales(['C', 'D', 'CI', 'CIF', 'DF']); changeMarkings('hairline', true); }, delay: 500 });
        steps.push({ action: function () { message('Divide by ' + crnu(divisor, 5) + ': Move the cursor to ' + crnu(divisorM, 5) + ' on the CIF scale. Read the intermediate result (' + quotMsg + ') on the D scale under the cursor.'); }, delay: delayMsg });
        steps.push({ action: function () { ensureSide(['C', 'D', 'CI', 'CIF', 'DF']); cursorTo('CIF', divisorM); }, delay: delayAction });
        return { slideShift: chainSlideShift, cursorAtIndex: false };
      }

      ensureFront();
      steps.push({ action: function () { undimScales(['C', 'D']); changeMarkings('hairline', true); }, delay: 500 });
      var readIndex = whichIndex(newSlideShift, manQuot.m);
      var indexLabel = (readIndex === 10) ? 'right index (10)' : 'left index (1)';
      if (inDivisionChain && divisionIndexInChain > 0) {
        if (cursorAtIndex) {
          steps.push({ action: function () { message('Divide by ' + crnu(divisor, 5) + ': Move the slide so ' + crnu(divisorM, 5) + ' on the C scale is under the cursor. The intermediate result (' + quotMsg + ') is now located on the D scale under the slide index.'); }, delay: delayMsg });
        } else {
          steps.push({ action: function () { message('Divide by ' + crnu(divisor, 5) + ': You must move the slide to continue the chain. Move the slide so the index (or ' + crnu(divisorM, 5) + ' on the C scale) is aligned with the previous result (' + crnu(dividend, 5) + ') on the D scale. The new result (' + quotMsg + ') will be found under the slide index on the D scale.'); }, delay: delayMsg });
        }
      } else {
        steps.push({ action: function () { message('Divide by ' + crnu(divisor, 5) + ': Move the slide so ' + crnu(divisorM, 5) + ' on the C scale is under the cursor. The intermediate result (' + quotMsg + ') is now located on the D scale under the slide index.'); }, delay: delayMsg });
      }
      steps.push({ action: function () { slideTo('C', divisorM); }, delay: delayAction });
      steps.push({ action: function () { cursorTo('C', readIndex); }, delay: delayAction });
      steps.push({ action: function () { message((inDivisionChain ? 'Intermediate result (' : 'Result (') + quotMsg + ') on the D scale under the ' + indexLabel + '.'); }, delay: delayMsg });
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

    function stepPower(op) {
      var base = op.left;
      var exp = op.right;
      var result = op.result;
      var manBase = toMantissa(base);
      var manResult = toMantissa(result);
      currentMantissa = manResult.m;
      if (exp === 2) {
        ensureFront();
        steps.push({ action: function () { ensureSide(['A', 'D']); sidesUsed.front = true; }, delay: 100 });
        steps.push({ action: function () { undimScales(['A', 'D']); changeMarkings('hairline', true); }, delay: 500 });
        steps.push({ action: function () { message('Square: cursor to ' + crnu(manBase.m, 5) + ' on D, read ' + crnu(result, 5) + ' on A.'); }, delay: delayMsg });
        steps.push({ action: function () { cursorTo('D', manBase.m); }, delay: delayAction });
        steps.push({ action: function () { message('Read result on A scale: ' + crnu(result, 5)); }, delay: delayMsg });
        currentExp = currentExp * 2;
        lastResultOnD = false;
      } else if (exp === 0.5) {
        ensureFront();
        var half = squareRootHalf(base);
        var aVal = half === 'left' ? manBase.m : manBase.m * 10;
        steps.push({ action: function () { ensureSide(['A', 'D']); sidesUsed.front = true; }, delay: 100 });
        steps.push({ action: function () { undimScales(['A', 'D']); changeMarkings('hairline', true); }, delay: 500 });
        steps.push({ action: function () { message('Square root: use ' + half + ' half of A (exponent ' + (half === 'left' ? 'even' : 'odd') + '). Cursor to ' + crnu(base, 5) + ' on A, read ' + crnu(result, 5) + ' on D.'); }, delay: delayMsg });
        steps.push({ action: function () { cursorTo('A', aVal); }, delay: delayAction });
        steps.push({ action: function () { message('Read result on D scale: ' + crnu(result, 5)); }, delay: delayMsg });
        currentExp = Math.floor(currentExp / 2);
      } else if (exp === 3) {
        ensureFront();
        steps.push({ action: function () { ensureSide(['K', 'D']); sidesUsed.front = true; }, delay: 100 });
        steps.push({ action: function () { undimScales(['K', 'D']); changeMarkings('hairline', true); }, delay: 500 });
        steps.push({ action: function () { message('Cube: cursor to ' + crnu(manBase.m, 5) + ' on D, read ' + crnu(result, 5) + ' on K.'); }, delay: delayMsg });
        steps.push({ action: function () { cursorTo('D', manBase.m); }, delay: delayAction });
        steps.push({ action: function () { message('Read result on K scale: ' + crnu(result, 5)); }, delay: delayMsg });
        currentExp = currentExp * 3;
        lastResultOnD = false;
      } else if (Math.abs(exp - 1/3) < 1e-9) {
        ensureFront();
        var third = cubeRootThird(base);
        var thirdName = (third === 0) ? 'left' : (third === 1 ? 'middle' : 'right');
        steps.push({ action: function () { ensureSide(['K', 'D']); sidesUsed.front = true; }, delay: 100 });
        steps.push({ action: function () { undimScales(['K', 'D']); changeMarkings('hairline', true); }, delay: 500 });
        steps.push({ action: function () { message('Cube root: use ' + thirdName + ' third of K. Cursor to ' + crnu(base, 5) + ' on K, read ' + crnu(result, 5) + ' on D.'); }, delay: delayMsg });
        steps.push({ action: function () { cursorTo('K', manBase.m); }, delay: delayAction });
        steps.push({ action: function () { message('Read result on D scale: ' + crnu(result, 5)); }, delay: delayMsg });
        currentExp = Math.floor(currentExp / 3);
      } else if (base > 0 && result > 0) {
        var LL_LIMIT = Math.exp(10);
        var resultOffScale = result > LL_LIMIT;
        var resultExp = Math.floor(Math.log10(Math.abs(result)));

        if (resultOffScale) {
          // Result exceeds LL3 (~22,026). LL scales cannot show it. Use log method: log10(a^b) = b × log10(a).
          var log10Base = Math.log10(base);
          var product = exp * log10Base;
          var characteristic = Math.floor(product);
          var logMantissa = product - characteristic;
          if (logMantissa < 0) logMantissa += 1;
          var resultMantissaFromLog = Math.pow(10, logMantissa);
          var dVal = log10Base >= 1 ? log10Base : log10Base * 10;
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
          var indexLabel = useRightIndex ? 'right index (10)' : 'left index (1)';
          var lScaleName = 'LogX     L';
          ensureBack();
          steps.push({ action: function () { ensureSide([lScaleName, 'C', 'D']); sidesUsed.back = true; }, delay: 100 });
          steps.push({ action: function () { undimScales([lScaleName, 'C', 'D']); changeMarkings('hairline', true); }, delay: 500 });
          steps.push({ action: function () {
            message(crnu(base, 2) + '^' + exp + ' = ' + resultD + '×10^' + characteristic + ' exceeds the end of the LL3 scale (~22,026). Use the log method: log₁₀(a^b) = b × log₁₀(a).');
          }, delay: delayMsg });
          steps.push({ action: function () {
            message('Step A: Find log₁₀(' + crnu(base, 2) + '). Cursor to ' + crnu(manBase.m, 3) + ' on D; read on L: log₁₀(' + crnu(base, 2) + ') ≈ ' + log10BaseD + '.');
          }, delay: delayMsg });
          steps.push({ action: function () { cursorTo('D', manBase.m); }, delay: delayAction });
          steps.push({ action: function () {
            message('Step B: Compute ' + exp + ' × ' + log10BaseD + ' on C and D. Set the ' + indexLabel + ' of C over ' + crnu(dVal, 3) + ' on D (representing ' + log10BaseD + '). Move the cursor to ' + crnu(cVal, 3) + ' on the C scale (representing ' + exp + ').' + (useRightIndex ? ' Using the right index keeps 6.6 on C to the left, over the result on D.' : ''));
          }, delay: delayMsg });
          steps.push({ action: function () { cursorTo('D', dVal); slideTo('C', cIndex); }, delay: delayAction });
          steps.push({ action: function () { cursorTo('C', cVal); }, delay: delayAction });
          steps.push({ action: function () {
            message('Step C: Read ' + crnu(readOnD, 3) + ' on D (i.e. ' + productD + '). Characteristic ' + characteristic + ', mantissa of log ≈ ' + logMantissaD + '.');
          }, delay: delayMsg });
          steps.push({ action: function () {
            message('Step D: Antilog: cursor to ' + logMantissaD + ' on the L scale; read result mantissa on D ≈ ' + resultMantD + ' (slide rule reading, 3–4 significant figures).');
          }, delay: delayMsg });
          steps.push({ action: function () { cursorTo(lScaleName, logMantissa); }, delay: delayAction });
          steps.push({ action: function () {
            message('Result: ' + crnu(base, 2) + '^' + exp + ' = ' + resultMantD + ' × 10^' + characteristic + ' ≈ ' + resultD + '×10^' + characteristic + '.');
          }, delay: delayMsg });
          currentMantissa = manResult.m;
          currentExp = resultExp;
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
            var resultReadD = (result >= 1 && result < 10) ? crnu(result, 4) : (result >= 0.1 && result < 1 ? crnu(result, 4) : Number(result).toPrecision(4));
            steps.push({ action: function () {
              message('Power ' + crnu(base, 3) + '^' + exp + ' using LL scales: set the cursor so the hairline is over ' + crnu(manBase.m, 3) + ' on the ' + baseScaleLabel + ' scale.');
            }, delay: delayMsg });
            steps.push({ action: function () { cursorTo(baseScaleName, manBase.m); }, delay: delayAction });
            steps.push({ action: function () {
              message('Move the slide so the left index (1) of the C scale is under the cursor. The rule is now set for base ' + crnu(base, 3) + '.');
            }, delay: delayMsg });
            steps.push({ action: function () { slideTo('C', 1); }, delay: delayAction });
            steps.push({ action: function () {
              message('Move the cursor to ' + crnu(expM, 3) + ' on the C scale (representing exponent ' + exp + ').' + (exp > 10 ? ' Use ' + crnu(expM, 3) + ' because ' + exp + ' is off the physical C scale.' : (exp < 1 ? ' For exponent &lt; 1 the result appears on a lower LL scale.' : '')) + scaleJumpHint);
            }, delay: delayMsg });
            steps.push({ action: function () { cursorTo('C', expM); }, delay: delayAction });
            steps.push({ action: function () {
              message('Read ' + resultReadD + ' under the cursor on the ' + (resultScaleLabel || baseScaleLabel) + ' scale. (Do not use the D scale here—it is log-log; the value under the cursor on D is not the result mantissa.)');
            }, delay: delayMsg });
            currentExp = resultExp;
            lastWasBack = true;
            lastResultOnD = false;
          } else {
            steps.push({ action: function () { message('Power ' + exp + ': use C/D chain or not supported; result is ' + crnu(result, 5)); }, delay: delayMsg });
          }
        }
      } else {
        steps.push({ action: function () { message('Power ' + exp + ': use C/D chain or not supported; result is ' + crnu(result, 5)); }, delay: delayMsg });
      }
    }

    function stepSqrt(op) {
      var arg = op.arg;
      var result = op.result;
      var manArg = toMantissa(arg);
      var manResult = toMantissa(result);
      currentMantissa = manResult.m;
      ensureFront();
      var half = squareRootHalf(arg);
      var aVal = half === 'left' ? manArg.m : manArg.m * 10;
      steps.push({ action: function () { ensureSide(['A', 'D']); sidesUsed.front = true; }, delay: 100 });
      steps.push({ action: function () { undimScales(['A', 'D']); changeMarkings('hairline', true); }, delay: 500 });
      steps.push({ action: function () { message('Square root of ' + crnu(arg, 5) + ': use ' + half + ' half of A. Cursor to value on A, read ' + crnu(result, 5) + ' on D.'); }, delay: delayMsg });
      steps.push({ action: function () { cursorTo('A', aVal); }, delay: delayAction });
      steps.push({ action: function () { message('Result ' + crnu(result, 5) + ' on D scale.'); }, delay: delayMsg });
      lastResultOnD = true;
    }

    function stepSin(op) {
      var arg = op.arg;
      var result = op.result;
      ensureBack();
      steps.push({ action: function () { ensureSide(['S', 'D']); sidesUsed.back = true; }, delay: 100 });
      steps.push({ action: function () { undimScales(['S', 'D']); changeMarkings('hairline', true); }, delay: 500 });
      steps.push({ action: function () { message('Sine of ' + crnu(arg, 5) + ' degrees: cursor to angle on S, read value on D.'); }, delay: delayMsg });
      steps.push({ action: function () { cursorTo('S', arg); }, delay: delayAction });
      steps.push({ action: function () { message('Read sin = ' + crnu(result, 5) + ' on D (adjust decimal).'); }, delay: delayMsg });
      currentMantissa = result >= 1 && result < 10 ? result : (result * 10);
      if (currentMantissa >= 10) currentMantissa /= 10;
      lastWasBack = true;
      lastResultOnD = false;
    }

    function stepCos(op) {
      var arg = op.arg;
      var result = op.result;
      ensureBack();
      steps.push({ action: function () { ensureSide(['S', 'D']); sidesUsed.back = true; }, delay: 100 });
      steps.push({ action: function () { undimScales(['S', 'D']); changeMarkings('hairline', true); }, delay: 500 });
      steps.push({ action: function () { message('Cosine of ' + crnu(arg, 5) + ' degrees: cos(θ) = sin(90−θ). Cursor to ' + crnu(90 - arg, 5) + ' on S, read on D.'); }, delay: delayMsg });
      steps.push({ action: function () { cursorTo('S', 90 - arg); }, delay: delayAction });
      steps.push({ action: function () { message('Read cos = ' + crnu(result, 5) + ' on D.'); }, delay: delayMsg });
      currentMantissa = result >= 1 && result < 10 ? result : (result * 10);
      if (currentMantissa >= 10) currentMantissa /= 10;
      lastWasBack = true;
    }

    function stepTan(op) {
      var arg = op.arg;
      var result = op.result;
      ensureBack();
      steps.push({ action: function () { ensureSide(['T', 'D']); sidesUsed.back = true; }, delay: 100 });
      steps.push({ action: function () { undimScales(['T', 'D']); changeMarkings('hairline', true); }, delay: 500 });
      steps.push({ action: function () { message('Tangent of ' + crnu(arg, 5) + ' degrees: cursor to angle on T, read on D.'); }, delay: delayMsg });
      steps.push({ action: function () { cursorTo('T', arg); }, delay: delayAction });
      steps.push({ action: function () { message('Read tan = ' + crnu(result, 5) + ' on D.'); }, delay: delayMsg });
      currentMantissa = result >= 1 && result < 10 ? result : (result * 10);
      if (currentMantissa >= 10) currentMantissa /= 10;
      lastWasBack = true;
      lastResultOnD = false;
    }

    function stepLog(op) {
      var arg = op.arg;
      var result = op.result;
      ensureBack();
      steps.push({ action: function () { ensureSide(['LogX     L', 'D']); sidesUsed.back = true; }, delay: 100 });
      steps.push({ action: function () { undimScales(['LogX     L', 'D']); changeMarkings('hairline', true); }, delay: 500 });
      var manArg = toMantissa(arg);
      steps.push({ action: function () { message('Log10 of ' + crnu(arg, 5) + ': cursor to value on D, read on L.'); }, delay: delayMsg });
      steps.push({ action: function () { cursorTo('D', manArg.m); }, delay: delayAction });
      steps.push({ action: function () { message('Read log10 = ' + crnu(result, 5) + ' on the L scale. The L scale gives the mantissa (decimal part)—' + crnu(result, 5) + ' is the actual value for the next step.'); }, delay: delayMsg });
      currentMantissa = result >= 1 && result < 10 ? result : (result < 1 ? result * 10 : result / 10);
      lastWasBack = true;
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
        var resultRead = (result >= 1 && result < 10) ? crnu(result, 3) : (result >= 0.1 && result < 1 ? crnu(result, 3) : (result >= 0.01 && result < 0.1 ? crnu(result, 4) : Number(result).toPrecision(3)));
        var rangeHint = (llScaleLabel === 'LL3') ? '1.0 to 10.0' : (llScaleLabel === 'LL2') ? '0.1 to 1.0' : '0.01 to 0.1';
        steps.push({ action: function () {
          message('Natural log of ' + crnu(arg, 3) + ': On the Versalog II, the D scale and LL scales are aligned so ln(y) is read directly. Find ' + crnu(manArg.m, 3) + ' on the ' + llScaleLabel + ' scale.');
        }, delay: delayMsg });
        steps.push({ action: function () { cursorTo(llScaleName, manArg.m); }, delay: delayAction });
        steps.push({ action: function () {
          message('Place the hairline over ' + crnu(manArg.m, 3) + ' on ' + llScaleLabel + '. Read the digits under the cursor on the D scale. ' + llScaleLabel + ' gives ln between ' + rangeHint + ', so ln(' + crnu(arg, 3) + ') = ' + resultRead + '.');
        }, delay: delayMsg });
        currentMantissa = result >= 1 && result < 10 ? result : (result < 1 ? result * 10 : result / 10);
        if (currentMantissa >= 10) currentMantissa /= 10;
        lastWasBack = true;
        lastResultOnD = true;
      } else {
        ensureBack();
        steps.push({ action: function () { ensureSide(['LogX     L', 'D']); sidesUsed.back = true; }, delay: 100 });
        steps.push({ action: function () { undimScales(['LogX     L', 'D']); changeMarkings('hairline', true); }, delay: 500 });
        steps.push({ action: function () { message('Natural log of ' + crnu(arg, 5) + ': cursor to value on D, read log10 on L. Then ln(x) = log10(x) × 2.303.'); }, delay: delayMsg });
        steps.push({ action: function () { cursorTo('D', manArg.m); }, delay: delayAction });
        steps.push({ action: function () { message('Read log10 on L, then ln(x) = log10(x) × 2.303 = ' + crnu(result, 5)); }, delay: delayMsg });
        currentMantissa = result >= 1 && result < 10 ? result : (result < 1 ? result * 10 : result / 10);
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
            steps.push({ action: function () { message('Calculate: ' + equationStr); }, delay: 500 });
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
              currentExp = man.exp;
              lastWasBack = false;
              lastResultOnD = true;
              steps.push({ action: function () { message('Calculate: ' + equationStr); }, delay: 500 });
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
      else if (op.op === 'sqrt') stepSqrt(op);
      else if (op.op === 'sin') stepSin(op);
      else if (op.op === 'cos') stepCos(op);
      else if (op.op === 'tan') stepTan(op);
      else if (op.op === 'log') stepLog(op);
      else if (op.op === 'ln') stepLn(op);
    }

    var finalVal = finalResult;
    var finalMan = toMantissa(finalResult);
    steps.unshift({ action: function () { ensureSide(['C', 'D']); cursorTo('D', 1); slideTo('C', 1); }, delay: 0 });
    steps.unshift({ action: function () { message('Resetting slide rule to index (1 on C and D).'); }, delay: 100 });
    steps.push({ action: function () {
      if (lastWasBack) ensureSide(['S', 'D']);
      else ensureSide(['C', 'D']);
      isolate();
      sliderules.objective = function () {
        var ok = false;
        if (lastResultOnD) ok = checkValue('D', finalMan.m);
        else ok = true;
        if (ok) {
          message('Result: ' + equationStr + ' = ' + crnu(finalVal, 5));
          return true;
        }
        return false;
      };
    }, delay: delayObj });
    steps.push({ action: function () { isolate(); message('Try again or enter another equation.'); }, delay: 4000 });

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
