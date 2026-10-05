// Node-directed acceptance script for Astring's explicit strict raw strategy.
//
// Run from the repository root with:
//
//   node examples/strict-raw/run.mjs
//
// or through npm:
//
//   npm run test:strict-raw
//
// It exercises the three AST fixtures shipped in this folder:
//   1. ast-malicious.js              -> rejected, writer receives nothing
//   2. ast-escaped-string.js         -> legal escapes keep their original value
//   3. ast-regexp-bigint-negzero.js  -> RegExp pattern+flags, BigInt and -0
//
// Acorn must be installed (`npm install` installs it as a dev dependency).

import assert from 'node:assert/strict'

import { generate, LiteralVerificationError } from '../../src/astring.js'
import { createAcornLiteralParser } from './acorn-literal-parser.js'
import { astMalicious } from './ast-malicious.js'
import { astEscapedString } from './ast-escaped-string.js'
import { astRegexpBigIntNegZero } from './ast-regexp-bigint-negzero.js'

const literalParser = createAcornLiteralParser()

let checks = 0

// 1. Malicious raw: value 1, raw "0;evil()" -> verification fails and the
// writer count stays at zero. Default generation remains unchanged.
{
  let writerCalls = 0
  const output = {
    write() {
      writerCalls++
    },
  }
  assert.throws(
    () =>
      generate(astMalicious, {
        strictRaw: true,
        literalParser,
        output,
      }),
    LiteralVerificationError,
  )
  assert.equal(writerCalls, 0, 'the writer must not be called at all')
  // Default generation is not modified.
  assert.equal(generate(astMalicious), '0;evil();\n')
  checks++
}

// 2. Legal escape sequences still denote their original string values.
{
  const output = generate(astEscapedString, { strictRaw: true, literalParser })
  const multiline = astEscapedString.body[0].declarations[0].init
  const unicode = astEscapedString.body[0].declarations[1].init
  assert.ok(output.includes(multiline.raw), 'original escaped raw is kept')
  assert.ok(output.includes(unicode.raw), 'unicode raw is kept')
  assert.equal(multiline.value, 'line1\nline2\ttabbed')
  assert.equal(unicode.value, 'café')
  checks++
}

// 3. RegExp pattern and flags are verified together; BigInt and negative zero
// keep their identities.
{
  const output = generate(astRegexpBigIntNegZero, {
    strictRaw: true,
    literalParser,
  })
  assert.ok(
    output.includes(String.raw`/^\s+$/gim;`),
    'regexp pattern and flags',
  )
  assert.ok(output.includes('9007199254740993n;'), 'bigint literal')
  assert.equal(
    output.match(/-0;/g).length,
    2,
    'both -0 forms are negative zero',
  )
  checks++
}

console.log(`strict-raw examples: ${checks} example groups passed`)
