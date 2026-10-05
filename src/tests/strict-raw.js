import test from 'ava'
import * as acorn from 'acorn'
import { generate } from '../astring.js'

const parser = { parse: (code) => acorn.parse(code, { ecmaVersion: 2023 }) }

test('evil raw is rejected and writer count stays zero', (assert) => {
  const ast = {
    type: 'Program',
    body: [
      {
        type: 'ExpressionStatement',
        expression: { type: 'Literal', value: 1, raw: '0;evil()' },
      },
    ],
  }
  let count = 0
  const writer = {
    write() {
      count++
    },
  }
  assert.throws(() => generate(ast, { strict: true, parser, output: writer }))
  assert.is(count, 0)
})

test('legal escaped string still corresponds to original value', (assert) => {
  const raw = String.raw`"a\nb"`
  const ast = {
    type: 'Program',
    body: [
      {
        type: 'ExpressionStatement',
        expression: { type: 'Literal', value: 'a\nb', raw },
      },
    ],
  }
  const out = generate(ast, { strict: true, parser })
  assert.is(out, String.fromCharCode(34, 97, 92, 110, 98, 34, 59, 10))
  const reparsed = acorn.parse(out, { ecmaVersion: 2023 }).body[0].expression
  assert.is(reparsed.value, 'a\nb')
})

test('regexp pattern and flags are verified together', (assert) => {
  const ast = {
    type: 'Program',
    body: [
      {
        type: 'ExpressionStatement',
        expression: {
          type: 'Literal',
          regex: { pattern: 'abc', flags: 'g' },
          raw: '/abc/g',
        },
      },
    ],
  }
  assert.is(generate(ast, { strict: true, parser }), '/abc/g;\n')
  const wrongFlags = {
    type: 'Program',
    body: [
      {
        type: 'ExpressionStatement',
        expression: {
          type: 'Literal',
          regex: { pattern: 'abc', flags: 'g' },
          raw: '/abc/gi',
        },
      },
    ],
  }
  assert.throws(() => generate(wrongFlags, { strict: true, parser }))
  const wrongPattern = {
    type: 'Program',
    body: [
      {
        type: 'ExpressionStatement',
        expression: {
          type: 'Literal',
          regex: { pattern: 'abc', flags: 'g' },
          raw: '/abd/g',
        },
      },
    ],
  }
  assert.throws(() => generate(wrongPattern, { strict: true, parser }))
})

test('negative zero identity follows the SameValue convention', (assert) => {
  const negZero = {
    type: 'Program',
    body: [
      {
        type: 'ExpressionStatement',
        expression: { type: 'Literal', value: -0, raw: '-0' },
      },
    ],
  }
  assert.is(generate(negZero, { strict: true, parser }), '-0;\n')
  const posZeroForNegZero = {
    type: 'Program',
    body: [
      {
        type: 'ExpressionStatement',
        expression: { type: 'Literal', value: -0, raw: '0' },
      },
    ],
  }
  assert.throws(() => generate(posZeroForNegZero, { strict: true, parser }))
  const posZero = {
    type: 'Program',
    body: [
      {
        type: 'ExpressionStatement',
        expression: { type: 'Literal', value: 0, raw: '0' },
      },
    ],
  }
  assert.is(generate(posZero, { strict: true, parser }), '0;\n')
})

test('bigint identity is checked', (assert) => {
  const ast = {
    type: 'Program',
    body: [
      {
        type: 'ExpressionStatement',
        expression: { type: 'Literal', bigint: '1', raw: '1n' },
      },
    ],
  }
  assert.is(generate(ast, { strict: true, parser }), '1n;\n')
  const wrong = {
    type: 'Program',
    body: [
      {
        type: 'ExpressionStatement',
        expression: { type: 'Literal', bigint: '2', raw: '1n' },
      },
    ],
  }
  assert.throws(() => generate(wrong, { strict: true, parser }))
})

test('unknown expressions are rejected', (assert) => {
  for (const raw of ['foo', 'evil()', '1+1', '`t${x}`', '1;2', '']) {
    const ast = {
      type: 'Program',
      body: [
        {
          type: 'ExpressionStatement',
          expression: { type: 'Literal', value: 1, raw },
        },
      ],
    }
    assert.throws(() => generate(ast, { strict: true, parser }))
  }
})

test('default generation is unchanged', (assert) => {
  const ast = {
    type: 'Program',
    body: [
      {
        type: 'ExpressionStatement',
        expression: { type: 'Literal', value: 1, raw: '0;evil()' },
      },
    ],
  }
  assert.is(generate(ast), '0;evil();\n')
  assert.is(generate(ast, { strict: false }), '0;evil();\n')
})

test('strict mode without an injected parser throws', (assert) => {
  const ast = {
    type: 'Program',
    body: [
      {
        type: 'ExpressionStatement',
        expression: { type: 'Literal', value: 1, raw: '1' },
      },
    ],
  }
  assert.throws(() => generate(ast, { strict: true }))
})

test('the whole AST is prechecked before any write happens', (assert) => {
  const ast = {
    type: 'Program',
    body: [
      {
        type: 'ExpressionStatement',
        expression: { type: 'Literal', value: 1, raw: '1' },
      },
      {
        type: 'ExpressionStatement',
        expression: { type: 'Literal', value: 2, raw: '0;evil()' },
      },
      {
        type: 'ExpressionStatement',
        expression: { type: 'Literal', value: 3, raw: '3' },
      },
    ],
  }
  let count = 0
  const writer = {
    write() {
      count++
    },
  }
  assert.throws(() => generate(ast, { strict: true, parser, output: writer }))
  assert.is(count, 0)
})
