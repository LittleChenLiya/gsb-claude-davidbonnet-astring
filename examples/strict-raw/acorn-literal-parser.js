// Explicit parser injection for the strict raw strategy.
//
// Astring never parses code itself and never uses `eval`. Instead, a parser is
// injected through an explicit interface: either a bare function
// `(raw, node) => expressionNode`, or an object exposing
// `parseLiteral(raw, node)`.
//
// This adapter wraps Acorn (a dev dependency of Astring). Any other
// ESTree-compliant parser can be used instead, provided `parseLiteral`
// returns the single expression node found at the start of `raw`.
//
// Usage:
//   import { createAcornLiteralParser } from './acorn-literal-parser.js'
//   generate(ast, {
//     strictRaw: true,
//     literalParser: createAcornLiteralParser({ ecmaVersion: 'latest' }),
//   })

import { Parser } from 'acorn'

export function createAcornLiteralParser(options = {}) {
  const parseOptions = { ecmaVersion: 'latest', ...options }
  return function parseLiteral(raw) {
    return Parser.parseExpressionAt(raw, 0, parseOptions)
  }
}
