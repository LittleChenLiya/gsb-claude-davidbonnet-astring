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
 * ECMAScript syntax target, as a name (`'es5'`, `'es2015'`, …, `'es2022'`), an
 * edition number (`5`, `6`, …, `13`), or a year number (`2015`, …, `2022`).
 */
export type SyntaxTarget = string | number

/**
 * Parser function used to check the generated code against the syntax target.
 * Defaults to Acorn's `parse`.
 */
export type SyntaxTargetParser = (
  code: string,
  options: { ecmaVersion: number; sourceType: 'script' | 'module' },
) => unknown

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
   * Explicit syntax target profile: the AST and the generated code are checked
   * against the minimum ECMAScript edition of each used feature, before
   * anything is written. Defaults to `null` (no check).
   */
  target?: SyntaxTarget
  /**
   * Parser used to check the generated code when `target` is set, defaults to
   * Acorn's `parse`.
   */
  parser?: SyntaxTargetParser
  /**
   * Source type used when checking the generated code, derived from the AST
   * if omitted.
   */
  sourceType?: 'script' | 'module'
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
 * Base code generator.
 */
export const GENERATOR: Generator

/**
 * Base code generator.
 *
 * @deprecated Use {@link GENERATOR} instead.
 */
export const baseGenerator: Generator

/**
 * Error thrown when an AST or the generated code does not conform to the
 * requested syntax `target`. The offending `node` and its `loc` source
 * location are exposed when available.
 */
export class SyntaxTargetError extends SyntaxError {
  node?: Node
  loc?: unknown
}

/**
 * Explicit syntax target profile: minimum ECMAScript edition (`5` for ES5,
 * `6` for ES2015, …, `13` for ES2022) required by each known AST node type
 * and operator. Node types and operators that are not listed here are unknown
 * to the profile and rejected when a `target` is set.
 */
export const SYNTAX_PROFILE: {
  nodes: { [nodeType: string]: number }
  operators: {
    unary: { [operator: string]: number }
    update: { [operator: string]: number }
    binary: { [operator: string]: number }
    logical: { [operator: string]: number }
    assignment: { [operator: string]: number }
  }
}
