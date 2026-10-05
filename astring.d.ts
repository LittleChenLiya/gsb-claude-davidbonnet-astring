import type { Node as EstreeNode } from 'estree'
import type { Mapping, SourceMapGenerator } from 'source-map'
import type { Writable } from 'stream'

/**
 * State object passed to generator functions.
 */
export interface State {
  output: string
  write(code: string, node?: EstreeNode): void
  writeComments: boolean
  indent: string
  lineEnd: string
  indentLevel: number
  line?: number
  column?: number
  lineEndSize?: number
  mapping?: Mapping
}

/**
 * Code generator for each node type.
 */
export type Generator = {
  [T in EstreeNode['type']]: (
    node: EstreeNode & { type: T },
    state: State,
  ) => void
}

/**
 * Parses the `raw` source of a literal node into the single ESTree expression
 * node it denotes. Injected explicitly by the caller; Astring never evaluates
 * the raw source itself.
 */
export type LiteralParser = {
  parseLiteral: (raw: string, node: EstreeNode) => EstreeNode
}

/**
 * Code generator options.
 */
export interface Options<Output = null> {
  /**
   * If present, source mappings will be written to the generator.
   */
  sourceMap?: SourceMapGenerator
  /**
   * String to use for indentation, defaults to `"␣␣"`.
   */
  indent?: string
  /**
   * String to use for line endings, defaults to `"\n"`.
   */
  lineEnd?: string
  /**
   * Indent level to start from, defaults to `0`.
   */
  startingIndentLevel?: number
  /**
   * Generate comments if `true`, defaults to `false`.
   */
  comments?: boolean
  /**
   * Output stream to write the render code to, defaults to `null`.
   */
  output?: Output
  /**
   * Custom code generator logic.
   */
  generator?: Generator
  /**
   * When `true`, the whole AST is verified before anything is written: every
   * literal `raw` must parse into a single literal equivalent to its declared
   * value. Defaults to `false`, which leaves generation unchanged.
   */
  strictRaw?: boolean
  /**
   * Parser used to verify literal `raw` sources when `strictRaw` is enabled.
   * It can be a bare function `(raw, node) => expressionNode` or an object
   * exposing `parseLiteral(raw, node)`.
   */
  literalParser?:
    | ((raw: string, node: EstreeNode) => EstreeNode)
    | LiteralParser
}

/**
 * Core Estree Node type to accommodate derived node types from parsers.
 */
interface Node {
  type: string
}

/**
 * Returns a string representing the rendered code of the provided AST `node`.
 * However, if an `output` stream is provided in the `options`, it writes to that stream and returns it.
 */
export function generate(node: Node, options?: Options<null>): string
export function generate(node: Node, options?: Options<Writable>): Writable

/**
 * Error thrown when a literal `raw` does not parse into a single literal
 * equivalent to its declared value, or when no parser is provided while
 * `strictRaw` is enabled.
 */
export class LiteralVerificationError extends Error {
  node: Node
}

/**
 * Verifies every literal node reachable from the provided AST `node` using
 * the explicitly injected `parser`. Throws a `LiteralVerificationError` at
 * the first node whose `raw` does not denote a single literal equivalent to
 * its declared value. Returns the `node` when the whole tree is valid.
 */
export function verifyLiterals(
  node: Node,
  parser:
    | ((raw: string, node: EstreeNode) => EstreeNode)
    | LiteralParser,
): Node

/**
 * Base code generator.
 */
export const GENERATOR: Generator

/**
 * Base code generator.
 *
 * @deprecated Use {@link GENERATOR} instead.
 */
export const baseGenerator: Generator
