// AST example 1/3: a forged literal whose declared `value` is `1` but whose
// `raw` carries arbitrary code (`0;evil()`).
//
// Under the strict raw strategy the whole tree is verified before anything is
// written, so generating this program throws a `LiteralVerificationError` and
// the writer is never called. With default generation, the injected code is
// emitted verbatim.

export const astMalicious = {
  type: 'Program',
  body: [
    {
      type: 'ExpressionStatement',
      expression: {
        type: 'Literal',
        value: 1,
        raw: '0;evil()',
      },
    },
  ],
}
