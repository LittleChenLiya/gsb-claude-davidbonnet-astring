/*
Tests for the explicit syntax target profile (the `target` option of
`generate`). Runs with plain Node.js, without any test framework:

    node src/tests/target.js

or through the local command:

    npm run test:target
*/

import assert from 'assert/strict'
import { parse } from 'acorn'

import { generate, SYNTAX_PROFILE, SyntaxTargetError } from '../astring.js'

const tests = []

function test(name, run) {
  tests.push([name, run])
}

function parseCode(code, options) {
  return parse(code, {
    ecmaVersion: 13,
    sourceType: 'module',
    locations: true,
    ...options,
  })
}

function makeWriter() {
  return {
    chunks: [],
    write(code) {
      this.chunks.push(code)
    },
    get text() {
      return this.chunks.join('')
    },
  }
}

function assertTargetError(run, pattern) {
  let error = null
  try {
    run()
  } catch (caught) {
    error = caught
  }
  assert.ok(error != null, 'Expected a SyntaxTargetError to be thrown')
  assert.ok(
    error instanceof SyntaxTargetError,
    `Expected a SyntaxTargetError, got ${error}`,
  )
  assert.ok(error instanceof SyntaxError)
  if (pattern != null) {
    assert.match(error.message, pattern)
  }
  return error
}

function editionTarget(edition) {
  return edition === 5 ? 'es5' : `es${edition + 2009}`
}

function checkFeature(code, minEdition, options) {
  /*
  Checks that `code` is rejected one edition below `minEdition` and accepted
  at `minEdition`, producing the same output as the default `generate`.
  */
  const ast = parseCode(code, options)
  const writer = makeWriter()
  assertTargetError(
    () =>
      generate(ast, { target: editionTarget(minEdition - 1), output: writer }),
    new RegExp(`ES${minEdition + 2009}`),
  )
  assert.equal(writer.chunks.length, 0)
  assert.equal(
    generate(ast, { target: editionTarget(minEdition) }),
    generate(ast),
  )
}

test('optional chaining is rejected at ES2019 and accepted at ES2020', () => {
  const ast = parseCode('a?.b?.(c)?.d;')
  const writer = makeWriter()
  const error = assertTargetError(
    () => generate(ast, { target: 'es2019', output: writer }),
    /requires ES2020, but the target is ES2019/,
  )
  assert.match(error.message, /\(line 1, column \d+\)/)
  assert.equal(writer.chunks.length, 0)
  assert.equal(generate(ast, { target: 'es2020' }), generate(ast))
})

test('nullish coalescing is rejected at ES2019 and accepted at ES2020', () => {
  checkFeature('a ?? b;', 11)
})

test('await in a non-async function is rejected, before any write', () => {
  const ast = parseCode('async function f() { await 1 }', {
    sourceType: 'script',
  })
  // Turn the async function into a regular one, keeping the await inside
  ast.body[0].async = false
  const writer = makeWriter()
  const error = assertTargetError(
    () => generate(ast, { target: 'es2020', output: writer }),
    /"await" requires an async function/,
  )
  assert.match(error.message, /\(line 1, column \d+\)/)
  assert.equal(writer.chunks.length, 0)
})

test('await in an async function is accepted from ES2017', () => {
  checkFeature('async function f() { await g() }', 8, { sourceType: 'script' })
})

test('await is not allowed in a class static block', () => {
  const ast = parseCode('class A { static { setup() } }')
  const awaitStatement = parseCode('async function f() { await 1 }', {
    sourceType: 'script',
  }).body[0].body.body[0]
  ast.body[0].body.body[0].body[0] = awaitStatement
  const writer = makeWriter()
  assertTargetError(
    () => generate(ast, { target: 'es2022', output: writer }),
    /not allowed in a class static block/,
  )
  assert.equal(writer.chunks.length, 0)
})

test('top-level await requires a module with target ES2022', () => {
  const ast = parseCode('await 1;')
  assertTargetError(
    () => generate(ast, { target: 'es2021' }),
    /target ES2022 or later/,
  )
  ast.sourceType = 'script'
  assertTargetError(
    () => generate(ast, { target: 'es2022' }),
    /target ES2022 or later/,
  )
  ast.sourceType = 'module'
  assert.equal(generate(ast, { target: 'es2022' }), generate(ast))
})

test('yield requires a generator function', () => {
  const ast = parseCode('function* g() { yield 1 }', { sourceType: 'script' })
  ast.body[0].generator = false
  assertTargetError(
    () => generate(ast, { target: 'es2022' }),
    /"yield" requires a generator function/,
  )
})

test('return requires a function', () => {
  const ast = {
    type: 'Program',
    sourceType: 'script',
    body: [{ type: 'ReturnStatement', argument: null }],
  }
  assertTargetError(
    () => generate(ast, { target: 'es2022' }),
    /"return" requires a function/,
  )
})

test('super requires a method or a class static block', () => {
  // `super.x` is accepted inside a method…
  checkFeature('class A extends B { m() { super.m() } }', 6)
  // …but not inside a plain function
  const superStatement = parseCode('class A extends B { m() { super.m() } }')
    .body[0].body.body[0].value.body.body[0]
  const ast = {
    type: 'Program',
    sourceType: 'script',
    body: [
      {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'f' },
        params: [],
        async: false,
        generator: false,
        body: { type: 'BlockStatement', body: [superStatement] },
      },
    ],
  }
  assertTargetError(
    () => generate(ast, { target: 'es2022' }),
    /"super" requires a method or a class static block/,
  )
})

test('super() calls require a class constructor', () => {
  const ast = parseCode('class A extends B { constructor() { super() } }')
  assert.equal(generate(ast, { target: 'es2015' }), generate(ast))
  // Downgrade the constructor to a regular method
  ast.body[0].body.body[0].kind = 'method'
  assertTargetError(
    () => generate(ast, { target: 'es2022' }),
    /calls require a class constructor/,
  )
})

test('new.target requires a function', () => {
  const statement = parseCode('function f() { new.target }', {
    sourceType: 'script',
  }).body[0].body.body[0]
  const ast = { type: 'Program', sourceType: 'script', body: [statement] }
  assertTargetError(
    () => generate(ast, { target: 'es2022' }),
    /"new.target" requires a function/,
  )
})

test('private identifiers require an enclosing class', () => {
  checkFeature('class A { #x = 1; get() { return this.#x } }', 13)
  const statement = parseCode('class A { #x = 1; get() { return this.#x } }')
    .body[0].body.body[1].value.body.body[0]
  const ast = {
    type: 'Program',
    sourceType: 'script',
    body: [
      {
        type: 'FunctionDeclaration',
        id: { type: 'Identifier', name: 'f' },
        params: [],
        async: false,
        generator: false,
        body: { type: 'BlockStatement', body: [statement] },
      },
    ],
  }
  assertTargetError(
    () => generate(ast, { target: 'es2022' }),
    /requires an enclosing class/,
  )
})

test('import.meta requires a module and ES2020', () => {
  const ast = parseCode('import.meta;')
  assertTargetError(() => generate(ast, { target: 'es2019' }), /ES2020/)
  ast.sourceType = 'script'
  assertTargetError(
    () => generate(ast, { target: 'es2020' }),
    /"import.meta" requires a module/,
  )
  ast.sourceType = 'module'
  assert.equal(generate(ast, { target: 'es2020' }), generate(ast))
})

test('unknown node types are rejected with their source location', () => {
  const ast = parseCode('let x = 1;', { sourceType: 'script' })
  const statement = ast.body[0]
  statement.type = 'WibbleDeclaration'
  statement.loc = {
    start: { line: 3, column: 7 },
    end: { line: 3, column: 24 },
  }
  const writer = makeWriter()
  const error = assertTargetError(
    () => generate(ast, { target: 'es2020', output: writer }),
    /Unknown node type "WibbleDeclaration" \(line 3, column 7\)/,
  )
  assert.equal(error.loc.start.line, 3)
  assert.equal(error.loc.start.column, 7)
  assert.equal(writer.chunks.length, 0)
})

test('unknown operators are rejected with their source location', () => {
  const ast = parseCode('x + y;', { sourceType: 'script' })
  ast.body[0].expression.operator = '***'
  const writer = makeWriter()
  assertTargetError(
    () => generate(ast, { target: 'es2022', output: writer }),
    /Unknown binary operator "\*\*\*" \(line 1, column 0\)/,
  )
  assert.equal(writer.chunks.length, 0)
  ast.body[0].expression.type = 'LogicalExpression'
  ast.body[0].expression.operator = '=>'
  assertTargetError(
    () => generate(ast, { target: 'es2022' }),
    /Unknown logical operator "=>" \(line 1, column 0\)/,
  )
})

test('unknown variable declaration kinds are rejected', () => {
  const ast = parseCode('var x = 1;', { sourceType: 'script' })
  ast.body[0].kind = 'using'
  assertTargetError(
    () => generate(ast, { target: 'es2022' }),
    /Unknown variable declaration kind "using"/,
  )
})

test('version table: ES2015 features', () => {
  checkFeature('let x = 1;', 6)
  checkFeature('const f = (a) => a * 2;', 6)
  checkFeature('class A {}', 6)
  checkFeature('var s = `a${b}c`;', 6)
  checkFeature('function* g() { yield 1 }', 6)
  checkFeature('for (const x of xs) {}', 6)
  checkFeature('var [a, ...b] = c;', 6)
  checkFeature('var o = { [k]: v, m() {}, shorthand };', 6)
  checkFeature('f(...args);', 6)
  checkFeature('import def from "mod";', 6)
  checkFeature('export const e = 1;', 6)
})

test('version table: ES2016 exponentiation operator', () => {
  checkFeature('x ** y;', 7)
  checkFeature('x **= 2;', 7)
})

test('version table: ES2018 features', () => {
  checkFeature('var { a, ...rest } = obj;', 9)
  checkFeature('var o = { ...spread };', 9)
  checkFeature('async function* g() { yield 1 }', 9)
  checkFeature('async function f() { for await (const x of xs) {} }', 9)
})

test('version table: ES2019 optional catch binding', () => {
  checkFeature('try {} catch {}', 10)
})

test('version table: ES2020 features', () => {
  checkFeature('a?.b;', 11)
  checkFeature('a ?? b;', 11)
  checkFeature('var b = 10n;', 11)
  checkFeature('import(source);', 11)
  checkFeature('export * as ns from "mod";', 11)
})

test('version table: ES2021 features', () => {
  checkFeature('a &&= b;', 12)
  checkFeature('a ||= b;', 12)
  checkFeature('a ??= b;', 12)
  checkFeature('var n = 1_000;', 12)
})

test('version table: ES2022 features', () => {
  checkFeature('class A { x = 1 }', 13)
  checkFeature('class A { static { setup() } }', 13)
  checkFeature('class A { #x; static has(o) { return #x in o } }', 13)
})

test('generated code is checked with an independent parser', () => {
  // `let await` fits the AST profile at ES2015, but `await` is a reserved
  // word in modules: the generated code does not parse at the target
  const ast = {
    type: 'Program',
    sourceType: 'module',
    body: [
      {
        type: 'VariableDeclaration',
        kind: 'let',
        declarations: [
          {
            type: 'VariableDeclarator',
            id: { type: 'Identifier', name: 'await' },
            init: null,
          },
        ],
      },
    ],
  }
  const writer = makeWriter()
  assertTargetError(
    () => generate(ast, { target: 'es2015', output: writer }),
    /Generated code does not conform to ES2015/,
  )
  assert.equal(writer.chunks.length, 0)
})

test('a custom parser can be provided', () => {
  const ast = parseCode('let x = 1;', { sourceType: 'script' })
  const calls = []
  const parser = (code, options) => {
    calls.push([code, options])
    return parse(code, options)
  }
  generate(ast, { target: 'es2015', parser })
  assert.equal(calls.length, 1)
  assert.equal(calls[0][1].ecmaVersion, 6)
  assert.equal(calls[0][1].sourceType, 'script')
})

test('target accepts name, edition, and year forms', () => {
  const ast = parseCode('a?.b;')
  for (const target of ['es2020', 'ES2020', 'es11', '2020', 2020, 11]) {
    assert.equal(generate(ast, { target }), generate(ast))
  }
  assertTargetError(
    () => generate(ast, { target: 'es1999' }),
    /Unsupported syntax target "es1999"/,
  )
  assertTargetError(
    () => generate(ast, { target: 'es2023' }),
    /Unsupported syntax target "es2023"/,
  )
  assertTargetError(() => generate(ast, { target: 'soon' }), /Unsupported/)
})

test('generate without a target keeps the default behavior', () => {
  const ast = parseCode('a?.b ?? c;')
  // No target: no validation, output is written directly to the stream
  const writer = makeWriter()
  const result = generate(ast, { output: writer })
  assert.equal(result, writer)
  assert.ok(writer.chunks.length > 0)
  assert.equal(writer.text, generate(ast))
})

test('the syntax profile exposes the documented version table', () => {
  assert.equal(SYNTAX_PROFILE.nodes.ChainExpression, 11)
  assert.equal(SYNTAX_PROFILE.nodes.ArrowFunctionExpression, 6)
  assert.equal(SYNTAX_PROFILE.nodes.AwaitExpression, 8)
  assert.equal(SYNTAX_PROFILE.nodes.StaticBlock, 13)
  assert.equal(SYNTAX_PROFILE.operators.logical['??'], 11)
  assert.equal(SYNTAX_PROFILE.operators.binary['**'], 7)
  assert.equal(SYNTAX_PROFILE.operators.assignment['??='], 12)
  assert.ok(SyntaxTargetError.prototype instanceof SyntaxError)
})

let failures = 0
for (const [name, run] of tests) {
  try {
    run()
    console.log(`ok - ${name}`)
  } catch (error) {
    failures++
    console.error(`not ok - ${name}`)
    console.error(error)
  }
}
if (failures > 0) {
  console.error(`${failures} test(s) failed`)
  process.exit(1)
}
console.log(`1..${tests.length}`)
console.log(`${tests.length} tests passed`)
