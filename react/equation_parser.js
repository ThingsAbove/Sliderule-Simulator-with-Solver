///////////////////////////////////////////////////////////////////////////////////
// Equation parser for slide-rule dynamic tutorials.
// Grammar: expression without + or - ; * / ^ and functions sqrt, sin, cos, tan, log, ln; pi, e.
// Returns AST or { error: true, message, start, end } for problem-area display.
///////////////////////////////////////////////////////////////////////////////////

(function () {
  'use strict';

  var FUNCTIONS = { sqrt: 1, sin: 1, cos: 1, tan: 1, log: 1, ln: 1 };
  var CONSTANTS = { pi: Math.PI, e: Math.E };

  function tokenize(s) {
    var tokens = [];
    var i = 0;
    var n = s.length;
    var start;

    function skipSpace() {
      while (i < n && /[\s]/.test(s[i])) i++;
    }

    function takeNumber() {
      start = i;
      var dot = false;
      if (i < n && s[i] === '.') { dot = true; i++; if (i >= n || !/\d/.test(s[i])) return { error: true, message: 'Invalid number', start: start, end: i }; }
      while (i < n && /\d/.test(s[i])) i++;
      if (!dot && i < n && s[i] === '.') { i++; while (i < n && /\d/.test(s[i])) i++; }
      if (i === start) return null;
      var raw = s.substring(start, i);
      var num = parseFloat(raw);
      if (num !== num) return { error: true, message: 'Invalid number', start: start, end: i };
      return { type: 'number', value: num, start: start, end: i };
    }

    function takeIdentifier() {
      start = i;
      if (i >= n || !/[a-zA-Z_]/.test(s[i])) return null;
      while (i < n && /[a-zA-Z0-9_]/.test(s[i])) i++;
      return { type: 'id', value: s.substring(start, i), start: start, end: i };
    }

    while (i < n) {
      skipSpace();
      if (i >= n) break;
      start = i;
      var c = s[i];
      if (c === '+') return { error: true, message: 'Addition is not supported on a slide rule', start: start, end: i + 1 };
      if (c === '-') return { error: true, message: 'Subtraction is not supported on a slide rule', start: start, end: i + 1 };
      if (c === '*' && i + 1 < n && s[i + 1] === '*') { tokens.push({ type: '^', start: i, end: i + 2 }); i += 2; continue; }
      if (c === '*') { tokens.push({ type: '*', start: i, end: i + 1 }); i++; continue; }
      if (c === '/') { tokens.push({ type: '/', start: i, end: i + 1 }); i++; continue; }
      if (c === '^') { tokens.push({ type: '^', start: i, end: i + 1 }); i++; continue; }
      if (c === '(') { tokens.push({ type: '(', start: i, end: i + 1 }); i++; continue; }
      if (c === ')') { tokens.push({ type: ')', start: i, end: i + 1 }); i++; continue; }
      if (/\d/.test(c) || (c === '.' && i + 1 < n && /\d/.test(s[i + 1]))) {
        var numTok = takeNumber();
        if (numTok && numTok.error) return numTok;
        if (numTok) { tokens.push(numTok); continue; }
      }
      if (/[a-zA-Z_]/.test(c)) {
        var idTok = takeIdentifier();
        tokens.push(idTok);
        continue;
      }
      return { error: true, message: 'Unexpected character: ' + c, start: start, end: i + 1 };
    }
    return tokens;
  }

  function parse(s) {
    var tokenResult = tokenize(s);
    if (tokenResult.error) return tokenResult;
    var tokens = tokenResult;
    var pos = 0;

    function peek() { return pos < tokens.length ? tokens[pos] : null; }
    function consume(type) {
      if (pos < tokens.length && (type === undefined || tokens[pos].type === type)) {
        var t = tokens[pos];
        pos++;
        return t;
      }
      return null;
    }
    function error(msg, start, end) {
      if (start == null && pos > 0) start = tokens[pos - 1].start;
      if (end == null && pos > 0) end = tokens[pos - 1].end;
      if (start == null) start = 0;
      if (end == null) end = s.length;
      return { error: true, message: msg, start: start, end: end };
    }

    function parseExpr() {
      var left = parseTerm();
      if (left && left.error) return left;
      if (!left) return null;
      while (peek() && (peek().type === '*' || peek().type === '/' || peek().type === '^')) {
        var opTok = consume();
        var right = parseTerm();
        if (right && right.error) return right;
        if (!right) return error('Missing expression after ' + opTok.type);
        left = { type: 'binary', op: opTok.type, left: left, right: right, start: left.start, end: right.end };
      }
      return left;
    }

    function parseTerm() {
      return parseFactor();
    }

    function parseFactor() {
      if (peek() && peek().type === 'number') {
        var t = consume('number');
        return { type: 'number', value: t.value, start: t.start, end: t.end };
      }
      if (peek() && peek().type === 'id') {
        var id = consume('id');
        var name = id.value.toLowerCase();
        if (CONSTANTS[name] !== undefined) return { type: 'name', id: name, value: CONSTANTS[name], start: id.start, end: id.end };
        if (FUNCTIONS[name]) {
          if (!consume('(')) return error('Expected ( after ' + name, id.start, id.end);
          var arg = parseExpr();
          if (arg && arg.error) return arg;
          if (!arg) return error('Expected expression after ' + name + '(');
          if (!consume(')')) return error('Expected )', arg.end, (peek() && peek().start) || s.length);
          return { type: 'call', fn: name, arg: arg, start: id.start, end: (peek() ? peek().start : s.length) };
        }
        return error('Unknown identifier: ' + id.value, id.start, id.end);
      }
      if (consume('(')) {
        var inner = parseExpr();
        if (inner && inner.error) return inner;
        if (!inner) return error('Expected expression after (');
        if (!consume(')')) return error('Expected )', inner.end, (peek() && peek().start) || s.length);
        return inner;
      }
      if (pos < tokens.length) return error('Expected number, function, or (', peek().start, peek().end);
      return null;
    }

    var ast = parseExpr();
    if (ast && ast.error) return ast;
    if (!ast) return error('Empty or invalid expression', 0, s.length);
    if (peek()) return error('Unexpected token', peek().start, peek().end);
    return ast;
  }

  function evaluate(ast) {
    if (!ast) return NaN;
    if (ast.type === 'number') return ast.value;
    if (ast.type === 'name') return ast.value;
    if (ast.type === 'binary') {
      var a = evaluate(ast.left);
      var b = evaluate(ast.right);
      if (a !== a || b !== b) return NaN;
      if (ast.op === '*') return a * b;
      if (ast.op === '/') { if (b === 0) return NaN; return a / b; }
      if (ast.op === '^') return Math.pow(a, b);
      return NaN;
    }
    if (ast.type === 'call') {
      var x = evaluate(ast.arg);
      if (x !== x) return NaN;
      switch (ast.fn) {
        case 'sqrt': return x < 0 ? NaN : Math.sqrt(x);
        case 'sin': return Math.sin(x * Math.PI / 180);
        case 'cos': return Math.cos(x * Math.PI / 180);
        case 'tan': return Math.tan(x * Math.PI / 180);
        case 'log': return x <= 0 ? NaN : Math.log10(x);
        case 'ln': return x <= 0 ? NaN : Math.log(x);
        default: return NaN;
      }
    }
    return NaN;
  }

  function checkDivisionByZero(ast) {
    if (!ast) return null;
    if (ast.type === 'binary' && ast.op === '/') {
      var r = evaluate(ast.right);
      if (r === 0) return { error: true, message: 'Division by zero', start: ast.right.start, end: ast.right.end };
      var leftErr = checkDivisionByZero(ast.left);
      if (leftErr) return leftErr;
      return checkDivisionByZero(ast.right);
    }
    if (ast.type === 'binary') { var e = checkDivisionByZero(ast.left); if (e) return e; return checkDivisionByZero(ast.right); }
    if (ast.type === 'call') return checkDivisionByZero(ast.arg);
    return null;
  }

  function parseEquation(s) {
    if (typeof s !== 'string') return { error: true, message: 'Expected string', start: 0, end: 0 };
    s = s.trim();
    if (!s.length) return { error: true, message: 'Empty equation', start: 0, end: 0 };
    var ast = parse(s);
    if (ast.error) return ast;
    var divErr = checkDivisionByZero(ast);
    if (divErr) return divErr;
    var result = evaluate(ast);
    if (result !== result) return { error: true, message: 'Invalid result (e.g. domain error)', start: 0, end: s.length };
    if (result === Infinity || result === -Infinity) return { error: true, message: 'Result is infinite', start: 0, end: s.length };
    return { ast: ast, value: result };
  }

  window.equation_parser = {
    tokenize: tokenize,
    parse: parse,
    evaluate: evaluate,
    parseEquation: parseEquation
  };
})();
