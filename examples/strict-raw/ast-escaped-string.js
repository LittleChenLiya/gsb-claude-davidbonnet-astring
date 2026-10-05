// AST example 2/3: strings using legal escape sequences.
//
// Each `raw` parses back into exactly one string literal whose value is the
// declared `value` (note that `\n` in a raw source is two source characters:
// a backslash followed by `n`).

export const astEscapedString = {
  type: 'Program',
  body: [
    {
      type: 'VariableDeclaration',
      kind: 'const',
      declarations: [
        {
          type: 'VariableDeclarator',
          id: { type: 'Identifier', name: 'multiline' },
          init: {
            type: 'Literal',
            value: 'line1\nline2\ttabbed',
            // In raw source: "line1\nline2\ttabbed"
            raw: String.raw`"line1\nline2\ttabbed"`,
          },
        },
        {
          type: 'VariableDeclarator',
          id: { type: 'Identifier', name: 'unicode' },
          init: {
            type: 'Literal',
            value: 'café',
            // In raw source: "café"
            raw: String.raw`"café"`,
          },
        },
        {
          type: 'VariableDeclarator',
          id: { type: 'Identifier', name: 'quote' },
          init: {
            type: 'Literal',
            value: 'she said "hi"',
            raw: String.raw`'she said "hi"'`,
          },
        },
      ],
    },
  ],
}
