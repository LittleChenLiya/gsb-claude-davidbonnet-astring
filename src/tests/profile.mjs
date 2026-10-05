/* eslint-env node */
/* eslint-disable import/no-unresolved */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { Parser } from 'acorn'
import { importAttributesOrAssertions } from 'acorn-import-attributes'

import {
  generate,
  checkSyntaxProfile,
  ProfileError,
  NODE_VERSIONS,
} from '../astring.js'

const parser = Parser.extend(importAttributesOrAssertions)

const parse = (code, options = {}) =>
  parser.parse(code, {
    ecmaVersion: 2025,
    sourceType: 'module',
    locations: true,
    ...options,
  })

const generateAt = (code, target, options = {}) =>
  generate(parse(code, options), { target, ...options })

test('optional chaining is rejected before ES2020', () => {
  assert.throws(
    () => generateAt('const x = a?.b;\n', 2019),
    (error) => {
      assert.ok(error instanceof ProfileError)
      assert.ok(error.message.includes('ChainExpression'))
      assert.ok(error.message.includes('ES2020'))
      return true
    },
  )
})

test('optional chaining is accepted at ES2020', () => {
  assert.equal(generateAt('const x = a?.b;\n', 2020), 'const x = a?.b;\n')
  assert.equal(generateAt('f?.();\n', 2020), 'f?.();\n')
  assert.equal(generateAt('a?.[0];\n', 2020), 'a?.[0];\n')
})

test('illegal context await is rejected', () => {
  // `await` inside a non-async function
  const ast = {
    type: 'Program',
    body: [
      {
        type: 'FunctionDeclaration',
        async: false,
        generator: false,
        id: { type: 'Identifier', name: 'f' },
        params: [],
        body: {
          type: 'BlockStatement',
          body: [
            {
              type: 'ExpressionStatement',
              expression: {
                type: 'AwaitExpression',
                argument: { type: 'Identifier', name: 'x' },
              },
            },
          ],
        },
      },
    ],
  }
  assert.throws(
    () => generate(ast, { target: 2020 }),
    (error) => {
      assert.ok(error instanceof ProfileError)
      assert.ok(
        error.message.includes('"await" is only allowed in async functions'),
      )
      return true
    },
  )
})

test('top-level await requires a module and ES2022', () => {
  const ast = {
    type: 'Program',
    body: [
      {
        type: 'ExpressionStatement',
        expression: {
          type: 'AwaitExpression',
          argument: { type: 'Identifier', name: 'x' },
        },
      },
    ],
  }
  // Script target: rejected
  assert.throws(
    () => generate(ast, { target: 2022, sourceType: 'script' }),
    ProfileError,
  )
  // Module target below ES2022: rejected
  assert.throws(
    () => generate(ast, { target: 2021, sourceType: 'module' }),
    ProfileError,
  )
  // Module target at ES2022: accepted
  assert.equal(
    generate(ast, { target: 2022, sourceType: 'module' }),
    'await x;\n',
  )
})

test('illegal context yield is rejected', () => {
  const ast = {
    type: 'Program',
    body: [
      {
        type: 'FunctionDeclaration',
        async: false,
        generator: false,
        id: { type: 'Identifier', name: 'f' },
        params: [],
        body: {
          type: 'BlockStatement',
          body: [
            {
              type: 'ExpressionStatement',
              expression: {
                type: 'YieldExpression',
                argument: { type: 'Identifier', name: 'x' },
              },
            },
          ],
        },
      },
    ],
  }
  assert.throws(
    () => generate(ast, { target: 2020 }),
    (error) => {
      assert.ok(error instanceof ProfileError)
      assert.ok(
        error.message.includes(
          '"yield" is only allowed in generator functions',
        ),
      )
      return true
    },
  )
})

test('unknown node types are rejected with their source location', () => {
  const ast = {
    type: 'Program',
    body: [
      {
        type: 'JSXElement',
        loc: { start: { line: 3, column: 5 } },
        children: [],
      },
    ],
  }
  assert.throws(
    () => generate(ast, { target: 2020 }),
    (error) => {
      assert.ok(error instanceof ProfileError)
      assert.ok(error.message.includes('Unknown node type "JSXElement"'))
      assert.ok(error.message.includes('line 3, column 5'))
      return true
    },
  )
})

test('all errors are reported before writing', () => {
  const ast = {
    type: 'Program',
    body: [
      {
        type: 'JSXElement',
        loc: { start: { line: 1, column: 0 } },
        children: [],
      },
      {
        type: 'JSXFragment',
        loc: { start: { line: 2, column: 0 } },
        children: [],
      },
    ],
  }
  const violations = checkSyntaxProfile(ast, { target: 2020 })
  assert.equal(violations.length, 2)
  assert.throws(
    () => generate(ast, { target: 2020 }),
    (error) => {
      assert.ok(error instanceof ProfileError)
      assert.ok(error.message.includes('JSXElement'))
      assert.ok(error.message.includes('JSXFragment'))
      return true
    },
  )
})

test('on failure the writer is never called', () => {
  const ast = parse('const x = a?.b;\n')
  let writes = 0
  const stream = {
    write() {
      writes++
    },
  }
  assert.throws(
    () => generate(ast, { target: 2019, output: stream }),
    ProfileError,
  )
  assert.equal(writes, 0)
})

test('default generate is unchanged', () => {
  const code = 'const x = a?.b;\n'
  assert.equal(generate(parse(code)), code)
  assert.equal(generate(parse(code), {}), code)
  assert.equal(generate(parse(code), { target: null }), code)
})

test('operators are checked against the target', () => {
  assert.throws(() => generateAt('const x = 2 ** 3;\n', 2015), ProfileError)
  assert.equal(generateAt('const x = 2 ** 3;\n', 2016), 'const x = 2 ** 3;\n')
  assert.throws(() => generateAt('x ?? y;\n', 2019), ProfileError)
  assert.equal(generateAt('x ?? y;\n', 2020), 'x ?? y;\n')
  assert.throws(() => generateAt('x ||= 1;\n', 2020), ProfileError)
  assert.equal(generateAt('x ||= 1;\n', 2021), 'x ||= 1;\n')
})

test('output is verified by an independent parser at the target edition', () => {
  const code = 'const x = a?.b;\n'
  assert.equal(generateAt(code, 2020, { parser: Parser }), code)
  // Verification failure throws after generation
  assert.throws(() => generateAt(code, 2019, { parser: Parser }), ProfileError)
})

test('year-based targets are normalized', () => {
  assert.equal(generateAt('const x = 1n;\n', 2020), 'const x = 1n;\n')
  assert.throws(() => generateAt('const x = 1n;\n', 2019), ProfileError)
})

test('NODE_VERSIONS covers every generator node type', () => {
  const generatorNodeTypes = [
    'Program',
    'ExpressionStatement',
    'BlockStatement',
    'StaticBlock',
    'EmptyStatement',
    'DebuggerStatement',
    'Identifier',
    'PrivateIdentifier',
    'Literal',
    'RegExpLiteral',
    'ArrayExpression',
    'ObjectExpression',
    'Property',
    'PropertyDefinition',
    'FunctionDeclaration',
    'FunctionExpression',
    'ArrowFunctionExpression',
    'VariableDeclaration',
    'VariableDeclarator',
    'ClassDeclaration',
    'ClassExpression',
    'ClassBody',
    'MethodDefinition',
    'ImportDeclaration',
    'ImportAttribute',
    'ImportExpression',
    'ExportDefaultDeclaration',
    'ExportNamedDeclaration',
    'ExportAllDeclaration',
    'Super',
    'RestElement',
    'SpreadElement',
    'YieldExpression',
    'AwaitExpression',
    'TemplateLiteral',
    'TemplateElement',
    'TaggedTemplateExpression',
    'ArrayPattern',
    'ObjectPattern',
    'SequenceExpression',
    'UnaryExpression',
    'UpdateExpression',
    'BinaryExpression',
    'LogicalExpression',
    'ConditionalExpression',
    'AssignmentExpression',
    'AssignmentPattern',
    'NewExpression',
    'CallExpression',
    'ChainExpression',
    'MemberExpression',
    'MetaProperty',
    'ReturnStatement',
    'ThrowStatement',
    'TryStatement',
    'SwitchStatement',
    'BreakStatement',
    'ContinueStatement',
    'LabeledStatement',
    'IfStatement',
    'WhileStatement',
    'DoWhileStatement',
    'ForStatement',
    'ForInStatement',
    'ForOfStatement',
    'WithStatement',
  ]
  for (const type of generatorNodeTypes) {
    assert.ok(NODE_VERSIONS[type] != null, `NODE_VERSIONS is missing ${type}`)
  }
})

test('profile covers all node types used in the fixtures', () => {
  const fixturesDir = path.join(
    path.dirname(new URL(import.meta.url).pathname.slice(1)),
    'fixtures',
    'syntax',
  )
  for (const filename of fs.readdirSync(fixturesDir).sort()) {
    const code = fs.readFileSync(path.join(fixturesDir, filename), 'utf8')
    const ast = parse(code)
    const violations = checkSyntaxProfile(ast, { target: 2025 })
    const unknown = violations.filter((v) =>
      v.message.includes('Unknown node type'),
    )
    assert.deepEqual(
      unknown,
      [],
      `${filename}: unexpected unknown node types: ${unknown
        .map((v) => v.message)
        .join(', ')}`,
    )
  }
})
