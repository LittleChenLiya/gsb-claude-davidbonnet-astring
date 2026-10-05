// AST example 3/3: RegExp literals (pattern and flags verified together),
// BigInt literals, and the negative-zero identity convention.
//
// Negative zero has its own identity: `-0` parsed by ESTree parsers is a
// unary minus applied to the literal `0`, and a `Literal` node declaring
// `value: -0` may legitimately carry the raw `-0`.

export const astRegexpBigIntNegZero = {
  type: 'Program',
  body: [
    {
      type: 'ExpressionStatement',
      expression: {
        type: 'Literal',
        value: null,
        regex: { pattern: String.raw`^\s+$`, flags: 'gim' },
        raw: String.raw`/^\s+$/gim`,
      },
    },
    {
      type: 'ExpressionStatement',
      expression: {
        type: 'Literal',
        value: null,
        bigint: '9007199254740993',
        raw: '9007199254740993n',
      },
    },
    {
      // The unary form produced by parsers for `-0`
      type: 'ExpressionStatement',
      expression: {
        type: 'UnaryExpression',
        operator: '-',
        prefix: true,
        argument: {
          type: 'Literal',
          value: 0,
          raw: '0',
        },
      },
    },
    {
      // A literal node declaring the negative-zero identity directly
      type: 'ExpressionStatement',
      expression: {
        type: 'Literal',
        value: -0,
        raw: '-0',
      },
    },
  ],
}
