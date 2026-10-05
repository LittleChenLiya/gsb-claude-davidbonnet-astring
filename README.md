# Astring

[![NPM Version](https://img.shields.io/npm/v/astring.svg)](https://www.npmjs.org/package/astring)
[![Coverage](https://codecov.io/gh/davidbonnet/astring/branch/master/graph/badge.svg)](https://codecov.io/gh/davidbonnet/astring)

🌳 Tiny and fast JavaScript code generator from an [ESTree](https://github.com/estree/estree)-compliant AST.

### Key features

- Generates JavaScript code up to [version 15 (2024)](https://tc39.github.io/ecma262/) and [stage 3 proposals](https://github.com/tc39/proposals#stage-3).
- Works on [ESTree](https://github.com/estree/estree)-compliant ASTs such as the ones produced by [Meriyah](https://github.com/meriyah/meriyah) or [Acorn](https://github.com/acornjs/acorn).
- Extendable with custom AST node handlers.
- Considerably faster than [Bublé](https://gitlab.com/Rich-Harris/buble) (up to 5×), [Escodegen](https://github.com/estools/escodegen) (up to 10×), [Babel](https://github.com/babel/babel) (up to 50×), [UglifyJS](https://github.com/mishoo/UglifyJS2) (up to 125×), and [Prettier](https://github.com/prettier/prettier) (up to 380×).
- Supports source map generation with [Source Map](https://github.com/mozilla/source-map#sourcemapgenerator).
- Supports comment generation with [Astravel](https://github.com/davidbonnet/astravel).
- No dependencies and small footprint (≈ 16 KB minified, ≈ 4 KB gziped).
- Runs on [🦕 Deno](https://deno.land/x/astring).

## Installation

> :warning: Astring relies on `String.prototype.repeat(amount)` and `String.prototype.endsWith(string)`. If the environment running Astring does not define these methods, use [`string.prototype.repeat`](https://www.npmjs.com/package/string.prototype.repeat), [`string.prototype.endsWith`](https://www.npmjs.com/package/string.prototype.endswith) or [`babel-polyfill`](https://www.npmjs.com/package/babel-polyfill).

Install with the [Node Package Manager](https://www.npmjs.com/package/astring):

```bash
npm install astring
```

Or install with [JSR](https://jsr.io/@davidbonnet/astring):

```bash
deno add @davidbonnet/astring
```

Alternatively, checkout this repository and install the development dependencies to build the module file:

```bash
git clone https://github.com/davidbonnet/astring.git
cd astring
npm install
```

## Import

Import it from [Deno's third party module repository](https://deno.land/x/astring/src/astring.js):

```js
const { generate } = await import('https://deno.land/x/astring/src/astring.js')
```

With JavaScript 6 modules:

```js
import { generate } from 'astring'
```

With CommonJS:

```js
const { generate } = require('astring')
```

A browser-ready minified bundle containing Astring is available at `dist/astring.min.js`. The module exposes a global variable `astring`:

```html
<script src="astring.min.js" type="text/javascript"></script>
<script type="text/javascript">
  var generate = astring.generate
</script>
```

## API

The `astring` module exposes the following properties:

### `generate(node: object, options: object): string | object`

Returns a string representing the rendered code of the provided AST `node`. However, if an `output` stream is provided in the `options`, it writes to that stream and returns it.

The `options` are:

- `indent`: string to use for indentation (defaults to `"␣␣"`)
- `lineEnd`: string to use for line endings (defaults to `"\n"`)
- `startingIndentLevel`: indent level to start from (defaults to `0`)
- `comments`: generate comments if `true` (defaults to `false`)
- `output`: output stream to write the rendered code to (defaults to `null`)
- `generator`: custom code generator (defaults to `GENERATOR`)
- `sourceMap`: [source map generator](https://github.com/mozilla/source-map#sourcemapgenerator) (defaults to `null`)
- `expressionsPrecedence`: custom map of node types and their precedence level (defaults to `EXPRESSIONS_PRECEDENCE`)
- `target`: ECMAScript syntax target (`'es5'`, `'es2015'`, …, `'es2022'`, or the corresponding edition or year number) that enables the [syntax target profile](#syntax-targets) (defaults to `null`, no check)
- `parser`: parser function used to check the generated code when `target` is set (defaults to [Acorn](https://github.com/acornjs/acorn)'s `parse`)
- `sourceType`: source type (`'script'` or `'module'`) used when checking the generated code, derived from the AST if omitted (defaults to `null`)

### `GENERATOR: object`

Base generator that can be used to [extend Astring](#extending).

### `EXPRESSIONS_PRECEDENCE: object`

Mapping of node types and their precedence level to let the generator know when to use parentheses.

### `NEEDS_PARENTHESES: number`

Default precedence level that always triggers the use of parentheses.

### `baseGenerator: object`

> :warning: Deprecated, use `GENERATOR` instead.

### `SYNTAX_PROFILE: object`

Explicit syntax target profile used when the `target` option is set: a `nodes` map and an `operators` map (`unary`, `update`, `binary`, `logical`, `assignment`) giving the minimum ECMAScript edition required by each known AST node type and operator. Editions are numbers: `5` for ES5, `6` for ES2015, …, `13` for ES2022. Node types and operators that are not listed are unknown to the profile and rejected.

### `SyntaxTargetError: class`

Error (a `SyntaxError` subclass) thrown when an AST or the generated code does not conform to the requested syntax `target`. The message carries the source location of the offending node when available, and the `node` and `loc` properties expose it.

## Syntax targets

Setting the `target` option enables an explicit syntax target profile:

1. The AST is checked node by node and operator by operator against the minimum ECMAScript edition that each used feature requires (see the version table below). Unknown node types, operators, declaration kinds, and meta properties are rejected instead of being silently passed through, and the reported error carries the source location of the offending node.
2. Function and class context restrictions are checked: `await` requires an async function (or the top level of a module with target ES2022 or later), `yield` requires a generator function, `return` requires a function, `super` requires a method or a class static block, `super(…)` calls require a class constructor, `new.target` requires a function, `import.meta` requires a module, private identifiers (`#x`) require an enclosing class, and `await`, `yield`, and `return` are not allowed directly in a class static block.
3. The generated code is checked again with an independent parser ([Acorn](https://github.com/acornjs/acorn) by default, overridable with the `parser` option) set to the target edition.

Every check runs _before_ anything is written: when a check fails, the provided `output` stream has received zero bytes. No transpilation is performed: code that does not fit the target is rejected. When `target` is not set, `generate` behaves exactly as before.

Supported targets are `es5` and `es2015` to `es2022` (also accepted as edition or year numbers, such as `11` or `2020`). The profile intentionally covers only the syntax listed in this version table:

| Minimum target | Syntax                                                                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ES5            | All ES5 syntax (baseline)                                                                                                                                          |
| ES2015         | `let`/`const`, arrow functions, classes, template literals, generators/`yield`, `for…of`, destructuring, rest/spread in arrays and calls, computed/shorthand/method properties, modules (`import`/`export`), `super`, `new.target` |
| ES2016         | Exponentiation operator `**` and `**=`                                                                                                                             |
| ES2017         | `async` functions and `await`                                                                                                                                      |
| ES2018         | Object rest/spread properties, async generator functions, `for await…of`                                                                                           |
| ES2019         | Optional catch binding (`try {} catch {}`)                                                                                                                         |
| ES2020         | Optional chaining (`?.`), nullish coalescing (`??`), BigInt literals, dynamic `import()`, `import.meta`, `export * as ns`                                           |
| ES2021         | Logical assignment (`&&=`, `\|\|=`, `??=`), numeric separators (`1_000`)                                                                                            |
| ES2022         | Class fields, private identifiers (`#x`, including `#x in obj`), class static blocks, top-level `await`                                                            |

Example:

```js
import { parse } from 'acorn'
import { generate } from 'astring'

const ast = parse('a?.b ?? c;', { ecmaVersion: 2020, locations: true })
generate(ast, { target: 'es2019' })
// SyntaxTargetError: Node type "ChainExpression" requires ES2020, but the
// target is ES2019 (line 1, column 0)
generate(ast, { target: 'es2020' }) // → 'a?.b ?? c;\n'
```

### Checking the syntax target profile locally

The profile is covered by a dependency-light test suite that runs with plain Node.js (only `acorn` needs to be installed):

```bash
npm run test:target
# which runs:
node src/tests/target.js
```

The command line interface also accepts the target:

```bash
astring --target es2020 ast.json > result.js
```

## Benchmark

### Generating code

Operations per second for generating each sample code from a pre-parsed AST:

| code sample (length) | escodegen |   astring |  uglify |   babel | prettier |
| :------------------- | --------: | --------: | ------: | ------: | -------: |
| tiny code (11)       | 1,257,527 | 7,185,642 | 129,467 | 156,184 |      333 |
| everything (8532)    |     1,366 |     8,008 |       0 |     346 |       64 |

### Parsing and generating code

Operations per second for parsing and generating each sample code:

| code sample (length) | acorn + astring | meriyah + astring |  buble | sucrase |
| :------------------- | --------------: | ----------------: | -----: | ------: |
| tiny code (11)       |          92,578 |           864,665 | 25,911 | 575,370 |
| everything (8532)    |             706 |             1,425 |    132 |   1,403 |

## Examples

The following examples are written in JavaScript 5 with Astring imported _à la CommonJS_.

### Generating code

This example uses [Acorn](https://github.com/acornjs/acorn), a blazingly fast JavaScript AST producer and therefore the perfect companion of Astring.

```javascript
// Make sure acorn and astring modules are imported

// Set example code
var code = 'let answer = 4 + 7 * 5 + 3;\n'
// Parse it into an AST
var ast = acorn.parse(code, { ecmaVersion: 6 })
// Format it into a code string
var formattedCode = astring.generate(ast)
// Check it
console.log(code === formattedCode ? 'It works!' : 'Something went wrong…')
```

### Generating source maps

This example uses the source map generator from the [Source Map](https://github.com/mozilla/source-map#sourcemapgenerator) module.

```javascript
// Make sure acorn, sourceMap and astring modules are imported

var code = 'function add(a, b) { return a + b; }\n'
var ast = acorn.parse(code, {
  ecmaVersion: 6,
  sourceType: 'module',
  // Locations are needed in order for the source map generator to work
  locations: true,
})
// Create empty source map generator
var map = new sourceMap.SourceMapGenerator({
  // Source file name must be set and will be used for mappings
  file: 'script.js',
})
var formattedCode = generate(ast, {
  // Enable source maps
  sourceMap: map,
})
// Display generated source map
console.log(map.toString())
```

### Using writable streams

This example for [Node](http://nodejs.org) shows how to use writable streams to get the rendered code.

```javascript
// Make sure acorn and astring modules are imported

// Set example code
var code = 'let answer = 4 + 7 * 5 + 3;\n'
// Parse it into an AST
var ast = acorn.parse(code, { ecmaVersion: 6 })
// Format it and write the result to stdout
var stream = astring.generate(ast, {
  output: process.stdout,
})
// The returned value is the output stream
console.log('Does stream equal process.stdout?', stream === process.stdout)
```

### Generating comments

Astring supports comment generation, provided they are stored on the AST nodes. To do so, this example uses [Astravel](https://github.com/davidbonnet/astravel), a fast AST traveller and modifier.

```javascript
// Make sure acorn, astravel and astring modules are imported

// Set example code
var code =
  [
    '// Compute the answer to everything',
    'let answer = 4 + 7 * 5 + 3;',
    '// Display it',
    'console.log(answer);',
  ].join('\n') + '\n'
// Parse it into an AST and retrieve the list of comments
var comments = []
var ast = acorn.parse(code, {
  ecmaVersion: 6,
  locations: true,
  onComment: comments,
})
// Attach comments to AST nodes
astravel.attachComments(ast, comments)
// Format it into a code string
var formattedCode = astring.generate(ast, {
  comments: true,
})
// Check it
console.log(code === formattedCode ? 'It works!' : 'Something went wrong…')
```

### Extending

Astring can easily be extended by updating or passing a custom code `generator`. A code `generator` consists of a mapping of node names and functions that take two arguments: `node` and `state`. The `node` points to the node from which to generate the code and the `state` exposes the `write` method that takes generated code strings.

This example shows how to support the `await` keyword which is part of the [asynchronous functions proposal](https://github.com/tc39/ecmascript-asyncawait). The corresponding `AwaitExpression` node is based on [this suggested definition](https://github.com/estree/estree/blob/master/es2017.md).

```javascript
// Make sure the astring module is imported and that `Object.assign` is defined

// Create a custom generator that inherits from Astring's base generator
var customGenerator = Object.assign({}, astring.GENERATOR, {
  AwaitExpression: function (node, state) {
    state.write('await ')
    var argument = node.argument
    if (argument != null) {
      this[argument.type](argument, state)
    }
  },
})
// Obtain a custom AST somehow (note that this AST is not obtained from a valid code)
var ast = {
  type: 'AwaitExpression',
  argument: {
    type: 'CallExpression',
    callee: {
      type: 'Identifier',
      name: 'callable',
    },
    arguments: [],
  },
}
// Format it
var code = astring.generate(ast, {
  generator: customGenerator,
})
// Check it
console.log(
  code === 'await callable();\n' ? 'It works!' : 'Something went wrong…',
)
```

## Command line interface

The `bin/astring` utility can be used to convert a JSON-formatted ESTree compliant AST of a JavaScript code. It accepts the following arguments:

- `-i`, `--indent`: string to use as indentation (defaults to `"␣␣"`)
- `-l`, `--line-end`: string to use for line endings (defaults to `"\n"`)
- `-s`, `--starting-indent-level`: indent level to start from (defaults to `0`)
- `-t`, `--target`: ECMAScript syntax target to check the AST and the generated code against, such as `es2020` (defaults to no check)
- `-h`, `--help`: print a usage message and exit
- `-v`, `--version`: print package version and exit

The utility reads the AST from a provided list of files or from `stdin` if none is supplied and prints the generated code.

### Example

As in the previous example, these examples use [Acorn](https://github.com/acornjs/acorn) to get the JSON-formatted AST. This command pipes the AST output by Acorn from a `script.js` file to Astring and writes the formatted JavaScript code into a `result.js` file:

```bash
acorn --ecma6 script.js | astring > result.js
```

This command does the same, but reads the AST from an intermediary file:

```bash
acorn --ecma6 script.js > ast.json
astring ast.json > result.js
```

This command reads JavaScript 6 code from `stdin` and outputs a prettified version:

```bash
cat | acorn --ecma6 | astring
```
