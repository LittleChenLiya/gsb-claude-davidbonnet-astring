// Acceptance tests for the explicit strict raw literal strategy.
//
// Runs with Node built-in test runner, no extra tooling needed:
//   node --test src/tests/strict-raw.test.mjs
// or:
//   npm run test:strict-raw
//
// The parser is injected through the explicit literalParser interface; this
// suite uses Acorn (already a dev dependency of Astring).

import test from 'node:test'
import assert from 'node:assert/strict'
import { Parser } from 'acorn'

import {
  generate,
  verifyLiterals,
  LiteralVerificationError,
} from '../astring.js'

const parseLiteral = (raw) =>
  Parser.parseExpressionAt(raw, 0, { ecmaVersion: 'latest' })

const strictOptions = { strictRaw: true, literalParser: parseLiteral }

function expressionStatement(expression) {
  return { type: 'ExpressionStatement', expression }
}

function countWriter() {
  const state = { calls: 0, code: '' }
  state.output = {
    write(code) {
      state.calls++
      state.code += code
    },
  }
  return state
}

test('value 1 with raw "0;evil()" is rejected and the writer count is 0', () => {
  const ast = expressionStatement({
    type: 'Literal',
    value: 1,
    raw: '0;evil()',
  })
  const { output, calls } = countWriter()
  assert.throws(
    () => generate(ast, { ...strictOptions, output }),
    LiteralVerificationError,
  )
  assert.equal(calls, 0)
})

test('unknown expressions in raw are rejected with no output', () => {
  for (const raw of ['evil()', 'foo', '{}', 'a + b', 'function(){}', '']) {
    const ast = expressionStatement({ type: 'Literal', value: 1, raw })
    const { output, calls } = countWriter()
    assert.throws(
      () => generate(ast, { ...strictOptions, output }),
      LiteralVerificationError,
      `raw ${JSON.stringify(raw)} must be rejected`,
    )
    assert.equal(calls, 0, `nothing written for raw ${JSON.stringify(raw)}`)
  }
})

test('a number raw must be identity-equivalent to the declared value', () => {
  assert.throws(
    () =>
      generate(
        expressionStatement({ type: 'Literal', value: 1, raw: '0' }),
        strictOptions,
      ),
    LiteralVerificationError,
  )
  assert.throws(
    () =>
      generate(
        expressionStatement({ type: 'Literal', value: 1, raw: 'true' }),
        strictOptions,
      ),
    LiteralVerificationError,
  )
  assert.equal(
    generate(
      expressionStatement({ type: 'Literal', value: 1, raw: '1' }),
      strictOptions,
    ),
    '1;',
  )
})

test('legal escape sequences keep corresponding to the original value', () => {
  const cases = [
    ['line1\nline2\ttabbed', String.raw`"line1\nline2\ttabbed"`],
    ['café', String.raw`"café"`],
    ['she said "hi"', String.raw`'she said "hi"'`],
    ['path\\to\\file', String.raw`"path\\to\\file"`],
  ]
  for (const [value, raw] of cases) {
    const output = generate(
      expressionStatement({ type: 'Literal', value, raw }),
      strictOptions,
    )
    assert.equal(output, raw + ';')
    assert.equal(parseLiteral(raw).value, value)
  }
})

test('RegExp pattern and flags are verified together', () => {
  const valid = expressionStatement({
    type: 'Literal',
    value: null,
    raw: String.raw`/^\s+$/gim`,
    regex: { pattern: String.raw`^\s+$`, flags: 'gim' },
  })
  assert.equal(generate(valid, strictOptions), String.raw`/^\s+$/gim;`)
  const reorderedFlags = expressionStatement({
    type: 'Literal',
    value: null,
    raw: '/abc/ig',
    regex: { pattern: 'abc', flags: 'gi' },
  })
  assert.equal(generate(reorderedFlags, strictOptions), '/abc/ig;')
  const badFlags = expressionStatement({
    type: 'Literal',
    value: null,
    raw: '/abc/g',
    regex: { pattern: 'abc', flags: 'gi' },
  })
  const badPattern = expressionStatement({
    type: 'Literal',
    value: null,
    raw: '/abc/g',
    regex: { pattern: 'xyz', flags: 'g' },
  })
  assert.throws(
    () => generate(badFlags, strictOptions),
    LiteralVerificationError,
  )
  assert.throws(
    () => generate(badPattern, strictOptions),
    LiteralVerificationError,
  )
})

test('BigInt digits are compared by identity', () => {
  assert.equal(
    generate(
      expressionStatement({
        type: 'Literal',
        value: null,
        raw: '9007199254740993n',
        bigint: '9007199254740993',
      }),
      strictOptions,
    ),
    '9007199254740993n;',
  )
  assert.throws(
    () =>
      generate(
        expressionStatement({
          type: 'Literal',
          value: null,
          raw: '123n',
          bigint: '456',
        }),
        strictOptions,
      ),
    LiteralVerificationError,
  )
})

test('negative zero keeps its own identity', () => {
  const unary = Parser.parse('-0', { ecmaVersion: 'latest' })
  assert.equal(generate(unary, strictOptions), '-0;\n')
  assert.equal(
    generate(
      expressionStatement({ type: 'Literal', value: -0, raw: '-0' }),
      strictOptions,
    ),
    '-0;',
  )
  assert.throws(
    () =>
      generate(
        expressionStatement({ type: 'Literal', value: 0, raw: '-0' }),
        strictOptions,
      ),
    LiteralVerificationError,
  )
  assert.throws(
    () =>
      generate(
        expressionStatement({ type: 'Literal', value: -0, raw: '0' }),
        strictOptions,
      ),
    LiteralVerificationError,
  )
  assert.equal(
    generate(
      expressionStatement({ type: 'Literal', value: -0 }),
      strictOptions,
    ),
    '-0;',
  )
})

test('the whole AST is preflighted: one bad node blocks every write', () => {
  const ast = Parser.parse('const a = 1; const b = { c: [2, 3] };', {
    ecmaVersion: 'latest',
  })
  ast.body[1].declarations[0].init.properties[0].value.elements[1].raw =
    '666;evil()'
  const { output, calls } = countWriter()
  assert.throws(
    () => generate(ast, { ...strictOptions, output }),
    LiteralVerificationError,
  )
  assert.equal(calls, 0)
})

test('legitimate parser-generated programs verify and regenerate', () => {
  const code = String.raw`
const s = "a\nb\té\"q";
const n = 1e3, h = 0xFF, bi = 42n;
const r = /^x+/gim;
const arr = [1, "x", /a/g, 9007199254740993n, true, null];
const obj = { a: { b: [{ c: "\x41" }] }, d: -0 };
`
  const ast = Parser.parse(code, { ecmaVersion: 'latest' })
  const output = generate(ast, strictOptions)
  const reparsed = Parser.parse(output, { ecmaVersion: 'latest' })
  generate(reparsed, strictOptions)
})

test('default generation stays unchanged without strictRaw', () => {
  const ast = expressionStatement({
    type: 'Literal',
    value: 1,
    raw: '0;evil()',
  })
  assert.equal(generate(ast), '0;evil();')
  assert.equal(generate(ast, {}), '0;evil();')
})

test('strictRaw requires an explicitly injected parser', () => {
  const ast = expressionStatement({ type: 'Literal', value: 1, raw: '1' })
  assert.throws(
    () => generate(ast, { strictRaw: true }),
    LiteralVerificationError,
  )
  assert.throws(
    () => generate(ast, { strictRaw: true, literalParser: {} }),
    LiteralVerificationError,
  )
  const parserObject = { parseLiteral }
  assert.equal(
    generate(ast, { strictRaw: true, literalParser: parserObject }),
    '1;',
  )
})

test('verifyLiterals validates a tree and returns it', () => {
  const ok = expressionStatement({ type: 'Literal', value: 1, raw: '1' })
  assert.equal(verifyLiterals(ok, parseLiteral), ok)
  const bad = expressionStatement({ type: 'Literal', value: 1, raw: '0;x()' })
  assert.throws(
    () => verifyLiterals(bad, parseLiteral),
    LiteralVerificationError,
  )
})
