# Explicit strict raw literal strategy

By default Astring renders the non-standard `raw` property of `Literal`
nodes verbatim. A forged node such as `{ type: 'Literal', value: 1, raw:
'0;evil()' }` would therefore inject arbitrary code into the output.

The strict raw strategy prevents this:

- a literal `raw` is accepted **only** if it parses into exactly one literal
  equivalent to the node's declared `value`;
- strings, numbers, BigInts and RegExps are compared by their true identity
  (numbers use `Object.is`, so negative zero is distinguished from positive
  zero; RegExp pattern **and** flags must both match);
- unknown expressions (calls, identifiers, operators, …) are rejected;
- `eval` is never used: the parser is injected by the caller through an
  explicit interface;
- the **whole AST** passes preflight before anything is written, so one bad
  node means the writer is never called;
- without `strictRaw`, generation is exactly the same as before.

## Parser injection

The parser is passed through `options.literalParser`, either as a bare
function or as an object exposing `parseLiteral`:

```js
import { Parser } from 'acorn'

const literalParser = (raw) =>
  Parser.parseExpressionAt(raw, 0, { ecmaVersion: 'latest' })

generate(ast, { strictRaw: true, literalParser })
```

A ready-made Acorn adapter is provided in
[`acorn-literal-parser.js`](./acorn-literal-parser.js).

## Negative-zero convention

`-0` parsed from source is a unary minus applied to the literal `0`
(`UnaryExpression` → `Literal(0)`), and a `Literal` node declaring
`value: -0` may legitimately carry the raw `-0`. In strict mode a `-0`
literal without a `raw` renders as `-0` (default generation renders `0`).

## AST examples

| File | What it demonstrates |
| --- | --- |
| [`ast-malicious.js`](./ast-malicious.js) | `value: 1`, `raw: '0;evil()'` — rejected, writer count `0` |
| [`ast-escaped-string.js`](./ast-escaped-string.js) | Legal escape sequences still denote their original string values |
| [`ast-regexp-bigint-negzero.js`](./ast-regexp-bigint-negzero.js) | RegExp pattern+flags, BigInt, negative-zero identity |

## Run with Node

From the repository root (Acorn is installed by `npm install` as a dev
dependency):

```sh
node examples/strict-raw/run.mjs
# or
npm run test:strict-raw
```
