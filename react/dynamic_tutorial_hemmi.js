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
        steps.push({ action: function () { ensureSide(['S', 'C']); }, delay: 100 });
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
      steps.push({ action: function () { isolate(['C', 'D']); changeMarkings('hairline', true); dimmm(255, 80, 8); }, delay: 500 });
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
      steps.push({ action: function () { isolate(['C', 'D']); changeMarkings('hairline', true); dimmm(255, 80, 8); }, delay: 500 });
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
        steps.push({ action: function () { message('Result so far is on the other side. Switch to front and set cursor to ' + crnu(transferVal, 5) + ' on D.'); }, delay: delayMsg });
        steps.push({ action: function () { cursorTo('D', transferVal); }, delay: delayAction });
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
      var useRightIndex = (a * manB.m >= 10);
      var firstFactor = a;
      var cIndex = useRightIndex ? 10 : 1;
      steps.push({ action: function () {
        message(useRightIndex ? 'Move the slide so the right index (10) on C is over ' + crnu(firstFactor, 5) + ' on the D scale.' : 'Move the slide so the left index (1) on C is over ' + crnu(firstFactor, 5) + ' on the D scale.');
      }, delay: delayMsg });
      steps.push({ action: function () {
        if (typeof changeSide === 'function') changeSide('front');
        ensureSide(['C', 'D']);
        cursorTo('D', firstFactor);
      }, delay: delayAction });
      steps.push({ action: function () { slideTo('C', cIndex); }, delay: delayAction });
      steps.push({ action: function () { message('Move the cursor to ' + crnu(cursorCVal, 5) + ' on the C scale.'); }, delay: delayMsg });
      steps.push({ action: function () { cursorTo('C', cursorCVal); }, delay: delayAction });
      steps.push({ action: function () { message('Read intermediate result ' + prodMsg + ' on D.' + (useRightIndex ? ' (Adjust decimal: result is ' + prodMsg + '.)' : '')); }, delay: delayMsg });
    }

    // Standard division (all cases): cursor is on dividend or previous result. Move SLIDE so divisor on C
    // is under the cursor. Read quotient on D under left index (1) or right index (10) of C — use the
    // index that is on the body (left index at slide_shift; right at slide_shift+1).
    function stepDivide(op, divisionIndexInChain, inDivisionChain) {
      if (lastWasBack) {
        ensureFront();
        var transferVal = currentMantissa;
        steps.push({ action: function () { message('Result so far is on the other side. Switch to front and set cursor to ' + crnu(transferVal, 5) + ' on D.'); }, delay: delayMsg });
        steps.push({ action: function () { cursorTo('D', transferVal); }, delay: delayAction });
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
      ensureFront();
      var slideShift = Math.log10(dividend) - Math.log10(divisorM);
      var limitL = 0.03;
      var limitR = 0.03;
      var leftIndexOnBody = slideShift >= -limitL && slideShift <= 1 + limitR;
      var rightIndexOnBody = (slideShift + 1) >= -limitL && (slideShift + 1) <= 1 + limitR;
      var readIndex = 1;
      if (leftIndexOnBody && rightIndexOnBody) {
        readIndex = (manQuot.m >= 1) ? 1 : 10;
      } else if (rightIndexOnBody) {
        readIndex = 10;
      } else if (leftIndexOnBody) {
        readIndex = 1;
      } else {
        readIndex = (slideShift + 0.5 >= 0) ? 10 : 1;
      }
      var indexLabel = (readIndex === 10) ? 'right index (10)' : 'left index (1)';
      if (inDivisionChain && divisionIndexInChain > 0) {
        steps.push({ action: function () { message('Divide by ' + crnu(divisor, 5) + ': cursor is at the previous result. Move the slide so ' + crnu(divisorM, 5) + ' on C is under the cursor. Read ' + quotMsg + ' on D under the ' + indexLabel + '.'); }, delay: delayMsg });
      } else {
        steps.push({ action: function () { message('Divide by ' + crnu(divisor, 5) + ': move the slide so ' + crnu(divisorM, 5) + ' on C is under the cursor. Read ' + quotMsg + ' on D under the ' + indexLabel + '.'); }, delay: delayMsg });
      }
      steps.push({ action: function () { slideTo('C', divisorM); }, delay: delayAction });
      steps.push({ action: function () { cursorTo('C', readIndex); }, delay: delayAction });
      steps.push({ action: function () { message((inDivisionChain ? 'Intermediate result ' : 'Result ') + quotMsg + ' on D under the ' + indexLabel + '.'); }, delay: delayMsg });
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
        steps.push({ action: function () { isolate(['A', 'D']); changeMarkings('hairline', true); dimmm(255, 80, 8); }, delay: 500 });
        steps.push({ action: function () { message('Square: cursor to ' + crnu(manBase.m, 5) + ' on D, read ' + crnu(result, 5) + ' on A.'); }, delay: delayMsg });
        steps.push({ action: function () { cursorTo('D', manBase.m); }, delay: delayAction });
        steps.push({ action: function () { message('Read result on A scale: ' + crnu(result, 5)); }, delay: delayMsg });
        currentExp = currentExp * 2;
        lastResultOnD = false;
      } else if (exp === 0.5) {
        ensureFront();
        steps.push({ action: function () { ensureSide(['A', 'D']); sidesUsed.front = true; }, delay: 100 });
        steps.push({ action: function () { isolate(['A', 'D']); changeMarkings('hairline', true); dimmm(255, 80, 8); }, delay: 500 });
        steps.push({ action: function () { message('Square root: cursor to ' + crnu(base, 5) + ' on A, read ' + crnu(result, 5) + ' on D.'); }, delay: delayMsg });
        steps.push({ action: function () { cursorTo('A', manBase.m); }, delay: delayAction });
        steps.push({ action: function () { message('Read result on D scale: ' + crnu(result, 5)); }, delay: delayMsg });
        currentExp = Math.floor(currentExp / 2);
      } else if (exp === 3) {
        ensureFront();
        steps.push({ action: function () { ensureSide(['K', 'D']); sidesUsed.front = true; }, delay: 100 });
        steps.push({ action: function () { isolate(['K', 'D']); changeMarkings('hairline', true); dimmm(255, 80, 8); }, delay: 500 });
        steps.push({ action: function () { message('Cube: cursor to ' + crnu(manBase.m, 5) + ' on D, read ' + crnu(result, 5) + ' on K.'); }, delay: delayMsg });
        steps.push({ action: function () { cursorTo('D', manBase.m); }, delay: delayAction });
        steps.push({ action: function () { message('Read result on K scale: ' + crnu(result, 5)); }, delay: delayMsg });
        currentExp = currentExp * 3;
        lastResultOnD = false;
      } else if (Math.abs(exp - 1/3) < 1e-9) {
        ensureFront();
        steps.push({ action: function () { ensureSide(['K', 'D']); sidesUsed.front = true; }, delay: 100 });
        steps.push({ action: function () { isolate(['K', 'D']); changeMarkings('hairline', true); dimmm(255, 80, 8); }, delay: 500 });
        steps.push({ action: function () { message('Cube root: cursor to ' + crnu(base, 5) + ' on K, read ' + crnu(result, 5) + ' on D.'); }, delay: delayMsg });
        steps.push({ action: function () { cursorTo('K', manBase.m); }, delay: delayAction });
        steps.push({ action: function () { message('Read result on D scale: ' + crnu(result, 5)); }, delay: delayMsg });
        currentExp = Math.floor(currentExp / 3);
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
      steps.push({ action: function () { ensureSide(['A', 'D']); sidesUsed.front = true; }, delay: 100 });
      steps.push({ action: function () { isolate(['A', 'D']); changeMarkings('hairline', true); dimmm(255, 80, 8); }, delay: 500 });
      steps.push({ action: function () { message('Square root of ' + crnu(arg, 5) + ': cursor to value on A, read on D.'); }, delay: delayMsg });
      steps.push({ action: function () { cursorTo('A', manArg.m); }, delay: delayAction });
      steps.push({ action: function () { message('Result ' + crnu(result, 5) + ' on D scale.'); }, delay: delayMsg });
      lastResultOnD = true;
    }

    function stepSin(op) {
      var arg = op.arg;
      var result = op.result;
      ensureBack();
      steps.push({ action: function () { ensureSide(['S', 'C']); sidesUsed.back = true; }, delay: 100 });
      steps.push({ action: function () { isolate(['S', 'C']); changeMarkings('hairline', true); dimmm(255, 40, 8); }, delay: 500 });
      steps.push({ action: function () { message('Sine of ' + crnu(arg, 5) + ' degrees: cursor to angle on S, read value on C.'); }, delay: delayMsg });
      steps.push({ action: function () { cursorTo('S', arg); }, delay: delayAction });
      steps.push({ action: function () { message('Read sin = ' + crnu(result, 5) + ' on C (adjust decimal).'); }, delay: delayMsg });
      currentMantissa = result >= 1 && result < 10 ? result : (result * 10);
      if (currentMantissa >= 10) currentMantissa /= 10;
      lastWasBack = true;
      lastResultOnD = false;
    }

    function stepCos(op) {
      var arg = op.arg;
      var result = op.result;
      ensureBack();
      steps.push({ action: function () { ensureSide(['S', 'C']); sidesUsed.back = true; }, delay: 100 });
      steps.push({ action: function () { isolate(['S', 'C']); changeMarkings('hairline', true); dimmm(255, 40, 8); }, delay: 500 });
      steps.push({ action: function () { message('Cosine of ' + crnu(arg, 5) + ' degrees: use S scale; cos(θ) = sin(90-θ).'); }, delay: delayMsg });
      steps.push({ action: function () { cursorTo('S', 90 - arg); }, delay: delayAction });
      steps.push({ action: function () { message('Read cos = ' + crnu(result, 5) + ' on C.'); }, delay: delayMsg });
      currentMantissa = result >= 1 && result < 10 ? result : (result * 10);
      if (currentMantissa >= 10) currentMantissa /= 10;
    }

    function stepTan(op) {
      var arg = op.arg;
      var result = op.result;
      ensureBack();
      steps.push({ action: function () { ensureSide(['T', 'C']); sidesUsed.back = true; }, delay: 100 });
      steps.push({ action: function () { isolate(['T', 'C']); changeMarkings('hairline', true); dimmm(255, 40, 8); }, delay: 500 });
      steps.push({ action: function () { message('Tangent of ' + crnu(arg, 5) + ' degrees: cursor to angle on T, read on C.'); }, delay: delayMsg });
      steps.push({ action: function () { cursorTo('T', arg); }, delay: delayAction });
      steps.push({ action: function () { message('Read tan = ' + crnu(result, 5) + ' on C.'); }, delay: delayMsg });
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
      steps.push({ action: function () { isolate(['LogX     L', 'D']); changeMarkings('hairline', true); dimmm(255, 80, 8); }, delay: 500 });
      var manArg = toMantissa(arg);
      steps.push({ action: function () { message('Log10 of ' + crnu(arg, 5) + ': cursor to value on D, read on L.'); }, delay: delayMsg });
      steps.push({ action: function () { cursorTo('D', manArg.m); }, delay: delayAction });
      steps.push({ action: function () { message('Read log10 = ' + crnu(result, 5) + ' on L scale.'); }, delay: delayMsg });
      currentMantissa = result >= 1 && result < 10 ? result : (result < 1 ? result * 10 : result / 10);
    }

    function stepLn(op) {
      var arg = op.arg;
      var result = op.result;
      ensureBack();
      steps.push({ action: function () { ensureSide(['LogX     L', 'D']); sidesUsed.back = true; }, delay: 100 });
      steps.push({ action: function () { isolate(['LogX     L', 'D']); changeMarkings('hairline', true); dimmm(255, 80, 8); }, delay: 500 });
      var manArg = toMantissa(arg);
      steps.push({ action: function () { message('Natural log of ' + crnu(arg, 5) + ': find log10 on L, then multiply by 2.303.'); }, delay: delayMsg });
      steps.push({ action: function () { cursorTo('D', manArg.m); }, delay: delayAction });
      steps.push({ action: function () { message('Read log10 on L, then ln(x) = log10(x) × 2.303 = ' + crnu(result, 5)); }, delay: delayMsg });
      currentMantissa = result >= 1 && result < 10 ? result : (result < 1 ? result * 10 : result / 10);
      lastWasBack = true;
      lastResultOnD = false;
    }

    var isFirstInit = true;
    var divisionChain = isDivisionChain(ops);
    var divisionIndexInChain = 0;
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      if (op.op === 'init') {
        if (isFirstInit) {
          if (divisionChain) {
            stepInitForDivision(op);
          } else {
            var useRightIndex = false;
            if (i + 2 < ops.length && ops[i + 1].op === 'init' && ops[i + 2].op === '*') {
              var secondVal = ops[i + 1].value;
              var manSecond = toMantissa(secondVal);
              if (op.value * manSecond.m >= 10) useRightIndex = true;
            }
            stepInit(op, useRightIndex);
          }
          isFirstInit = false;
        }
        // Second and later inits (e.g. 3.5 in 2*3.5) are second factors; no steps here.
      } else if (op.op === '*') stepMultiply(op);
      else if (op.op === '/') {
        stepDivide(op, divisionChain ? divisionIndexInChain : -1, divisionChain);
        if (divisionChain) divisionIndexInChain += 1;
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
      if (sidesUsed.front) ensureSide(['C', 'D']);
      if (sidesUsed.back && !sidesUsed.front) ensureSide(['S', 'C']);
      isolate();
      dimmm(80, 255, 8);
      sliderules.objective = function () {
        var ok = false;
        if (lastResultOnD) ok = checkValue('D', finalMan.m);
        else ok = true;
        if (ok) {
          message('Mission accomplished! ' + equationStr + ' = ' + crnu(finalVal, 5));
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
