// Astring is a tiny and fast JavaScript code generator from an ESTree-compliant AST.
//
// Astring was written by David Bonnet and released under an MIT license.
//
// The Git repository for Astring is available at:
// https://github.com/davidbonnet/astring.git
//
// Please use the GitHub bug tracker to report issues:
// https://github.com/davidbonnet/astring/issues

import { parse as parseWithAcorn } from 'acorn'

const { stringify } = JSON

/* c8 ignore if */
if (!String.prototype.repeat) {
  /* c8 ignore next */
  throw new Error(
    'String.prototype.repeat is undefined, see https://github.com/davidbonnet/astring#installation',
  )
}

/* c8 ignore if */
if (!String.prototype.endsWith) {
  /* c8 ignore next */
  throw new Error(
    'String.prototype.endsWith is undefined, see https://github.com/davidbonnet/astring#installation',
  )
}

const OPERATOR_PRECEDENCE = {
  '||': 2,
  '??': 3,
  '&&': 4,
  '|': 5,
  '^': 6,
  '&': 7,
  '==': 8,
  '!=': 8,
  '===': 8,
  '!==': 8,
  '<': 9,
  '>': 9,
  '<=': 9,
  '>=': 9,
  in: 9,
  instanceof: 9,
  '<<': 10,
  '>>': 10,
  '>>>': 10,
  '+': 11,
  '-': 11,
  '*': 12,
  '%': 12,
  '/': 12,
  '**': 13,
}

// Enables parenthesis regardless of precedence
export const NEEDS_PARENTHESES = 17

export const EXPRESSIONS_PRECEDENCE = {
  // Definitions
  ArrayExpression: 20,
  TaggedTemplateExpression: 20,
  ThisExpression: 20,
  Identifier: 20,
  PrivateIdentifier: 20,
  Literal: 18,
  TemplateLiteral: 20,
  Super: 20,
  SequenceExpression: 20,
  // Operations
  MemberExpression: 19,
  ChainExpression: 19,
  CallExpression: 19,
  NewExpression: 19,
  // Other definitions
  ArrowFunctionExpression: NEEDS_PARENTHESES,
  ClassExpression: NEEDS_PARENTHESES,
  FunctionExpression: NEEDS_PARENTHESES,
  ObjectExpression: NEEDS_PARENTHESES,
  // Other operations
  UpdateExpression: 16,
  UnaryExpression: 15,
  AwaitExpression: 15,
  BinaryExpression: 14,
  LogicalExpression: 13,
  ConditionalExpression: 4,
  AssignmentExpression: 3,
  YieldExpression: 2,
  RestElement: 1,
}

function formatSequence(state, nodes) {
  /*
  Writes into `state` a sequence of `nodes`.
  */
  const { generator } = state
  state.write('(')
  if (nodes != null && nodes.length > 0) {
    generator[nodes[0].type](nodes[0], state)
    const { length } = nodes
    for (let i = 1; i < length; i++) {
      const param = nodes[i]
      state.write(', ')
      generator[param.type](param, state)
    }
  }
  state.write(')')
}

function expressionNeedsParenthesis(state, node, parentNode, isRightHand) {
  const nodePrecedence = state.expressionsPrecedence[node.type]
  if (nodePrecedence === NEEDS_PARENTHESES) {
    return true
  }
  const parentNodePrecedence = state.expressionsPrecedence[parentNode.type]
  if (nodePrecedence !== parentNodePrecedence) {
    // Different node types
    return (
      (!isRightHand &&
        nodePrecedence === 15 &&
        parentNodePrecedence === 14 &&
        parentNode.operator === '**') ||
      nodePrecedence < parentNodePrecedence
    )
  }
  if (nodePrecedence !== 13 && nodePrecedence !== 14) {
    // Not a `LogicalExpression` or `BinaryExpression`
    return false
  }
  if (node.operator === '**' && parentNode.operator === '**') {
    // Exponentiation operator has right-to-left associativity
    return !isRightHand
  }
  if (
    nodePrecedence === 13 &&
    parentNodePrecedence === 13 &&
    (node.operator === '??' || parentNode.operator === '??')
  ) {
    // Nullish coalescing and boolean operators cannot be combined
    return true
  }
  if (isRightHand) {
    // Parenthesis are used if both operators have the same precedence
    return (
      OPERATOR_PRECEDENCE[node.operator] <=
      OPERATOR_PRECEDENCE[parentNode.operator]
    )
  }
  return (
    OPERATOR_PRECEDENCE[node.operator] <
    OPERATOR_PRECEDENCE[parentNode.operator]
  )
}

function formatExpression(state, node, parentNode, isRightHand) {
  /*
  Writes into `state` the provided `node`, adding parenthesis around if the provided `parentNode` needs it. If `node` is a right-hand argument, the provided `isRightHand` parameter should be `true`.
  */
  const { generator } = state
  if (expressionNeedsParenthesis(state, node, parentNode, isRightHand)) {
    state.write('(')
    generator[node.type](node, state)
    state.write(')')
  } else {
    generator[node.type](node, state)
  }
}

function reindent(state, text, indent, lineEnd) {
  /*
  Writes into `state` the `text` string reindented with the provided `indent`.
  */
  const lines = text.split('\n')
  const end = lines.length - 1
  state.write(lines[0].trim())
  if (end > 0) {
    state.write(lineEnd)
    for (let i = 1; i < end; i++) {
      state.write(indent + lines[i].trim() + lineEnd)
    }
    state.write(indent + lines[end].trim())
  }
}

function formatComments(state, comments, indent, lineEnd) {
  /*
  Writes into `state` the provided list of `comments`, with the given `indent` and `lineEnd` strings.
  Line comments will end with `"\n"` regardless of the value of `lineEnd`.
  Expects to start on a new unindented line.
  */
  const { length } = comments
  for (let i = 0; i < length; i++) {
    const comment = comments[i]
    state.write(indent)
    if (comment.type[0] === 'L') {
      // Line comment
      state.write('// ' + comment.value.trim() + '\n', comment)
    } else {
      // Block comment
      state.write('/*')
      reindent(state, comment.value, indent, lineEnd)
      state.write('*/' + lineEnd)
    }
  }
}

function hasCallExpression(node) {
  /*
  Returns `true` if the provided `node` contains a call expression and `false` otherwise.
  */
  let currentNode = node
  while (currentNode != null) {
    const { type } = currentNode
    if (type[0] === 'C' && type[1] === 'a') {
      // Is CallExpression
      return true
    } else if (type[0] === 'M' && type[1] === 'e' && type[2] === 'm') {
      // Is MemberExpression
      currentNode = currentNode.object
    } else {
      return false
    }
  }
}

function formatVariableDeclaration(state, node) {
  /*
  Writes into `state` a variable declaration.
  */
  const { generator } = state
  const { declarations } = node
  state.write(node.kind + ' ')
  const { length } = declarations
  if (length > 0) {
    generator.VariableDeclarator(declarations[0], state)
    for (let i = 1; i < length; i++) {
      state.write(', ')
      generator.VariableDeclarator(declarations[i], state)
    }
  }
}

let ForInStatement,
  FunctionDeclaration,
  RestElement,
  BinaryExpression,
  ArrayExpression,
  BlockStatement

export const GENERATOR = {
  /*
  Default generator.
  */
  Program(node, state) {
    const indent = state.indent.repeat(state.indentLevel)
    const { lineEnd, writeComments } = state
    if (writeComments && node.comments != null) {
      formatComments(state, node.comments, indent, lineEnd)
    }
    const statements = node.body
    const { length } = statements
    for (let i = 0; i < length; i++) {
      const statement = statements[i]
      if (writeComments && statement.comments != null) {
        formatComments(state, statement.comments, indent, lineEnd)
      }
      state.write(indent)
      this[statement.type](statement, state)
      state.write(lineEnd)
    }
    if (writeComments && node.trailingComments != null) {
      formatComments(state, node.trailingComments, indent, lineEnd)
    }
  },
  BlockStatement: (BlockStatement = function (node, state) {
    const indent = state.indent.repeat(state.indentLevel++)
    const { lineEnd, writeComments } = state
    const statementIndent = indent + state.indent
    state.write('{')
    const statements = node.body
    if (statements != null && statements.length > 0) {
      state.write(lineEnd)
      if (writeComments && node.comments != null) {
        formatComments(state, node.comments, statementIndent, lineEnd)
      }
      const { length } = statements
      for (let i = 0; i < length; i++) {
        const statement = statements[i]
        if (writeComments && statement.comments != null) {
          formatComments(state, statement.comments, statementIndent, lineEnd)
        }
        state.write(statementIndent)
        this[statement.type](statement, state)
        state.write(lineEnd)
      }
      state.write(indent)
    } else {
      if (writeComments && node.comments != null) {
        state.write(lineEnd)
        formatComments(state, node.comments, statementIndent, lineEnd)
        state.write(indent)
      }
    }
    if (writeComments && node.trailingComments != null) {
      formatComments(state, node.trailingComments, statementIndent, lineEnd)
    }
    state.write('}')
    state.indentLevel--
  }),
  ClassBody: BlockStatement,
  StaticBlock(node, state) {
    state.write('static ')
    this.BlockStatement(node, state)
  },
  EmptyStatement(node, state) {
    state.write(';')
  },
  ExpressionStatement(node, state) {
    const precedence = state.expressionsPrecedence[node.expression.type]
    if (
      precedence === NEEDS_PARENTHESES ||
      (precedence === 3 && node.expression.left.type[0] === 'O')
    ) {
      // Should always have parentheses or is an AssignmentExpression to an ObjectPattern
      state.write('(')
      this[node.expression.type](node.expression, state)
      state.write(')')
    } else {
      this[node.expression.type](node.expression, state)
    }
    state.write(';')
  },
  IfStatement(node, state) {
    state.write('if (')
    this[node.test.type](node.test, state)
    state.write(') ')
    this[node.consequent.type](node.consequent, state)
    if (node.alternate != null) {
      state.write(' else ')
      this[node.alternate.type](node.alternate, state)
    }
  },
  LabeledStatement(node, state) {
    this[node.label.type](node.label, state)
    state.write(': ')
    this[node.body.type](node.body, state)
  },
  BreakStatement(node, state) {
    state.write('break')
    if (node.label != null) {
      state.write(' ')
      this[node.label.type](node.label, state)
    }
    state.write(';')
  },
  ContinueStatement(node, state) {
    state.write('continue')
    if (node.label != null) {
      state.write(' ')
      this[node.label.type](node.label, state)
    }
    state.write(';')
  },
  WithStatement(node, state) {
    state.write('with (')
    this[node.object.type](node.object, state)
    state.write(') ')
    this[node.body.type](node.body, state)
  },
  SwitchStatement(node, state) {
    const indent = state.indent.repeat(state.indentLevel++)
    const { lineEnd, writeComments } = state
    state.indentLevel++
    const caseIndent = indent + state.indent
    const statementIndent = caseIndent + state.indent
    state.write('switch (')
    this[node.discriminant.type](node.discriminant, state)
    state.write(') {' + lineEnd)
    const { cases: occurences } = node
    const { length: occurencesCount } = occurences
    for (let i = 0; i < occurencesCount; i++) {
      const occurence = occurences[i]
      if (writeComments && occurence.comments != null) {
        formatComments(state, occurence.comments, caseIndent, lineEnd)
      }
      if (occurence.test) {
        state.write(caseIndent + 'case ')
        this[occurence.test.type](occurence.test, state)
        state.write(':' + lineEnd)
      } else {
        state.write(caseIndent + 'default:' + lineEnd)
      }
      const { consequent } = occurence
      const { length: consequentCount } = consequent
      for (let i = 0; i < consequentCount; i++) {
        const statement = consequent[i]
        if (writeComments && statement.comments != null) {
          formatComments(state, statement.comments, statementIndent, lineEnd)
        }
        state.write(statementIndent)
        this[statement.type](statement, state)
        state.write(lineEnd)
      }
    }
    state.indentLevel -= 2
    state.write(indent + '}')
  },
  ReturnStatement(node, state) {
    state.write('return')
    if (node.argument) {
      state.write(' ')
      this[node.argument.type](node.argument, state)
    }
    state.write(';')
  },
  ThrowStatement(node, state) {
    state.write('throw ')
    this[node.argument.type](node.argument, state)
    state.write(';')
  },
  TryStatement(node, state) {
    state.write('try ')
    this[node.block.type](node.block, state)
    if (node.handler) {
      const { handler } = node
      if (handler.param == null) {
        state.write(' catch ')
      } else {
        state.write(' catch (')
        this[handler.param.type](handler.param, state)
        state.write(') ')
      }
      this[handler.body.type](handler.body, state)
    }
    if (node.finalizer) {
      state.write(' finally ')
      this[node.finalizer.type](node.finalizer, state)
    }
  },
  WhileStatement(node, state) {
    state.write('while (')
    this[node.test.type](node.test, state)
    state.write(') ')
    this[node.body.type](node.body, state)
  },
  DoWhileStatement(node, state) {
    state.write('do ')
    this[node.body.type](node.body, state)
    state.write(' while (')
    this[node.test.type](node.test, state)
    state.write(');')
  },
  ForStatement(node, state) {
    state.write('for (')
    if (node.init != null) {
      const { init } = node
      if (init.type[0] === 'V') {
        formatVariableDeclaration(state, init)
      } else {
        this[init.type](init, state)
      }
    }
    state.write('; ')
    if (node.test) {
      this[node.test.type](node.test, state)
    }
    state.write('; ')
    if (node.update) {
      this[node.update.type](node.update, state)
    }
    state.write(') ')
    this[node.body.type](node.body, state)
  },
  ForInStatement: (ForInStatement = function (node, state) {
    state.write(`for ${node.await ? 'await ' : ''}(`)
    const { left } = node
    if (left.type[0] === 'V') {
      formatVariableDeclaration(state, left)
    } else {
      this[left.type](left, state)
    }
    // Identifying whether node.type is `ForInStatement` or `ForOfStatement`
    state.write(node.type[3] === 'I' ? ' in ' : ' of ')
    this[node.right.type](node.right, state)
    state.write(') ')
    this[node.body.type](node.body, state)
  }),
  ForOfStatement: ForInStatement,
  DebuggerStatement(node, state) {
    state.write('debugger;', node)
  },
  FunctionDeclaration: (FunctionDeclaration = function (node, state) {
    state.write(
      (node.async ? 'async ' : '') +
        (node.generator ? 'function* ' : 'function ') +
        (node.id ? node.id.name : ''),
      node,
    )
    formatSequence(state, node.params)
    state.write(' ')
    this[node.body.type](node.body, state)
  }),
  FunctionExpression: FunctionDeclaration,
  VariableDeclaration(node, state) {
    formatVariableDeclaration(state, node)
    state.write(';')
  },
  VariableDeclarator(node, state) {
    this[node.id.type](node.id, state)
    if (node.init != null) {
      state.write(' = ')
      this[node.init.type](node.init, state)
    }
  },
  ClassDeclaration(node, state) {
    state.write('class ' + (node.id ? `${node.id.name} ` : ''), node)
    if (node.superClass) {
      state.write('extends ')
      const { superClass } = node
      const { type } = superClass
      const precedence = state.expressionsPrecedence[type]
      if (
        (type[0] !== 'C' || type[1] !== 'l' || type[5] !== 'E') &&
        (precedence === NEEDS_PARENTHESES ||
          precedence < state.expressionsPrecedence.ClassExpression)
      ) {
        // Not a ClassExpression that needs parentheses
        state.write('(')
        this[node.superClass.type](superClass, state)
        state.write(')')
      } else {
        this[superClass.type](superClass, state)
      }
      state.write(' ')
    }
    this.ClassBody(node.body, state)
  },
  ImportDeclaration(node, state) {
    state.write('import ')
    const { specifiers, attributes } = node
    const { length } = specifiers
    // TODO: Once babili is fixed, put this after condition
    // https://github.com/babel/babili/issues/430
    let i = 0
    if (length > 0) {
      for (; i < length; ) {
        if (i > 0) {
          state.write(', ')
        }
        const specifier = specifiers[i]
        const type = specifier.type[6]
        if (type === 'D') {
          // ImportDefaultSpecifier
          state.write(specifier.local.name, specifier)
          i++
        } else if (type === 'N') {
          // ImportNamespaceSpecifier
          state.write('* as ' + specifier.local.name, specifier)
          i++
        } else {
          // ImportSpecifier
          break
        }
      }
      if (i < length) {
        state.write('{')
        for (;;) {
          const specifier = specifiers[i]
          const { name } = specifier.imported
          state.write(name, specifier)
          if (name !== specifier.local.name) {
            state.write(' as ' + specifier.local.name)
          }
          if (++i < length) {
            state.write(', ')
          } else {
            break
          }
        }
        state.write('}')
      }
      state.write(' from ')
    }
    this.Literal(node.source, state)

    if (attributes && attributes.length > 0) {
      state.write(' with { ')
      for (let i = 0; i < attributes.length; i++) {
        this.ImportAttribute(attributes[i], state)
        if (i < attributes.length - 1) state.write(', ')
      }

      state.write(' }')
    }
    state.write(';')
  },
  ImportAttribute(node, state) {
    this.Identifier(node.key, state)
    state.write(': ')
    this.Literal(node.value, state)
  },
  ImportExpression(node, state) {
    state.write('import(')
    this[node.source.type](node.source, state)
    state.write(')')
  },
  ExportDefaultDeclaration(node, state) {
    state.write('export default ')
    this[node.declaration.type](node.declaration, state)
    if (
      state.expressionsPrecedence[node.declaration.type] != null &&
      node.declaration.type[0] !== 'F'
    ) {
      // All expression nodes except `FunctionExpression`
      state.write(';')
    }
  },
  ExportNamedDeclaration(node, state) {
    state.write('export ')
    if (node.declaration) {
      this[node.declaration.type](node.declaration, state)
    } else {
      state.write('{')
      const { specifiers } = node,
        { length } = specifiers
      if (length > 0) {
        for (let i = 0; ; ) {
          const specifier = specifiers[i]
          const { name } = specifier.local
          state.write(name, specifier)
          if (name !== specifier.exported.name) {
            state.write(' as ' + specifier.exported.name)
          }
          if (++i < length) {
            state.write(', ')
          } else {
            break
          }
        }
      }
      state.write('}')
      if (node.source) {
        state.write(' from ')
        this.Literal(node.source, state)
      }

      if (node.attributes && node.attributes.length > 0) {
        state.write(' with { ')
        for (let i = 0; i < node.attributes.length; i++) {
          this.ImportAttribute(node.attributes[i], state)
          if (i < node.attributes.length - 1) state.write(', ')
        }

        state.write(' }')
      }

      state.write(';')
    }
  },
  ExportAllDeclaration(node, state) {
    if (node.exported != null) {
      state.write('export * as ' + node.exported.name + ' from ')
    } else {
      state.write('export * from ')
    }
    this.Literal(node.source, state)

    if (node.attributes && node.attributes.length > 0) {
      state.write(' with { ')
      for (let i = 0; i < node.attributes.length; i++) {
        this.ImportAttribute(node.attributes[i], state)
        if (i < node.attributes.length - 1) state.write(', ')
      }

      state.write(' }')
    }

    state.write(';')
  },
  MethodDefinition(node, state) {
    if (node.static) {
      state.write('static ')
    }
    const kind = node.kind[0]
    if (kind === 'g' || kind === 's') {
      // Getter or setter
      state.write(node.kind + ' ')
    }
    if (node.value.async) {
      state.write('async ')
    }
    if (node.value.generator) {
      state.write('*')
    }
    if (node.computed) {
      state.write('[')
      this[node.key.type](node.key, state)
      state.write(']')
    } else {
      this[node.key.type](node.key, state)
    }
    formatSequence(state, node.value.params)
    state.write(' ')
    this[node.value.body.type](node.value.body, state)
  },
  ClassExpression(node, state) {
    this.ClassDeclaration(node, state)
  },
  ArrowFunctionExpression(node, state) {
    state.write(node.async ? 'async ' : '', node)
    const { params } = node
    if (params != null) {
      // Omit parenthesis if only one named parameter
      if (params.length === 1 && params[0].type[0] === 'I') {
        // If params[0].type[0] starts with 'I', it can't be `ImportDeclaration` nor `IfStatement` and thus is `Identifier`
        state.write(params[0].name, params[0])
      } else {
        formatSequence(state, node.params)
      }
    }
    state.write(' => ')
    if (node.body.type[0] === 'O') {
      // Body is an object expression
      state.write('(')
      this.ObjectExpression(node.body, state)
      state.write(')')
    } else {
      this[node.body.type](node.body, state)
    }
  },
  ThisExpression(node, state) {
    state.write('this', node)
  },
  Super(node, state) {
    state.write('super', node)
  },
  RestElement: (RestElement = function (node, state) {
    state.write('...')
    this[node.argument.type](node.argument, state)
  }),
  SpreadElement: RestElement,
  YieldExpression(node, state) {
    state.write(node.delegate ? 'yield*' : 'yield')
    if (node.argument) {
      state.write(' ')
      this[node.argument.type](node.argument, state)
    }
  },
  AwaitExpression(node, state) {
    state.write('await ', node)
    formatExpression(state, node.argument, node)
  },
  TemplateLiteral(node, state) {
    const { quasis, expressions } = node
    state.write('`')
    const { length } = expressions
    for (let i = 0; i < length; i++) {
      const expression = expressions[i]
      const quasi = quasis[i]
      state.write(quasi.value.raw, quasi)
      state.write('${')
      this[expression.type](expression, state)
      state.write('}')
    }
    const quasi = quasis[quasis.length - 1]
    state.write(quasi.value.raw, quasi)
    state.write('`')
  },
  TemplateElement(node, state) {
    state.write(node.value.raw, node)
  },
  TaggedTemplateExpression(node, state) {
    formatExpression(state, node.tag, node)
    this[node.quasi.type](node.quasi, state)
  },
  ArrayExpression: (ArrayExpression = function (node, state) {
    state.write('[')
    if (node.elements.length > 0) {
      const { elements } = node,
        { length } = elements
      for (let i = 0; ; ) {
        const element = elements[i]
        if (element != null) {
          this[element.type](element, state)
        }
        if (++i < length) {
          state.write(', ')
        } else {
          if (element == null) {
            state.write(', ')
          }
          break
        }
      }
    }
    state.write(']')
  }),
  ArrayPattern: ArrayExpression,
  ObjectExpression(node, state) {
    const indent = state.indent.repeat(state.indentLevel++)
    const { lineEnd, writeComments } = state
    const propertyIndent = indent + state.indent
    state.write('{')
    if (node.properties.length > 0) {
      state.write(lineEnd)
      if (writeComments && node.comments != null) {
        formatComments(state, node.comments, propertyIndent, lineEnd)
      }
      const comma = ',' + lineEnd
      const { properties } = node,
        { length } = properties
      for (let i = 0; ; ) {
        const property = properties[i]
        if (writeComments && property.comments != null) {
          formatComments(state, property.comments, propertyIndent, lineEnd)
        }
        state.write(propertyIndent)
        this[property.type](property, state)
        if (++i < length) {
          state.write(comma)
        } else {
          break
        }
      }
      state.write(lineEnd)
      if (writeComments && node.trailingComments != null) {
        formatComments(state, node.trailingComments, propertyIndent, lineEnd)
      }
      state.write(indent + '}')
    } else if (writeComments) {
      if (node.comments != null) {
        state.write(lineEnd)
        formatComments(state, node.comments, propertyIndent, lineEnd)
        if (node.trailingComments != null) {
          formatComments(state, node.trailingComments, propertyIndent, lineEnd)
        }
        state.write(indent + '}')
      } else if (node.trailingComments != null) {
        state.write(lineEnd)
        formatComments(state, node.trailingComments, propertyIndent, lineEnd)
        state.write(indent + '}')
      } else {
        state.write('}')
      }
    } else {
      state.write('}')
    }
    state.indentLevel--
  },
  Property(node, state) {
    if (node.method || node.kind[0] !== 'i') {
      // Either a method or of kind `set` or `get` (not `init`)
      this.MethodDefinition(node, state)
    } else {
      if (!node.shorthand) {
        if (node.computed) {
          state.write('[')
          this[node.key.type](node.key, state)
          state.write(']')
        } else {
          this[node.key.type](node.key, state)
        }
        state.write(': ')
      }
      this[node.value.type](node.value, state)
    }
  },
  PropertyDefinition(node, state) {
    if (node.static) {
      state.write('static ')
    }
    if (node.computed) {
      state.write('[')
    }
    this[node.key.type](node.key, state)
    if (node.computed) {
      state.write(']')
    }
    if (node.value == null) {
      if (node.key.type[0] !== 'F') {
        state.write(';')
      }
      return
    }
    state.write(' = ')
    this[node.value.type](node.value, state)
    state.write(';')
  },
  ObjectPattern(node, state) {
    state.write('{')
    if (node.properties.length > 0) {
      const { properties } = node,
        { length } = properties
      for (let i = 0; ; ) {
        this[properties[i].type](properties[i], state)
        if (++i < length) {
          state.write(', ')
        } else {
          break
        }
      }
    }
    state.write('}')
  },
  SequenceExpression(node, state) {
    formatSequence(state, node.expressions)
  },
  UnaryExpression(node, state) {
    if (node.prefix) {
      const {
        operator,
        argument,
        argument: { type },
      } = node
      state.write(operator)
      const needsParentheses = expressionNeedsParenthesis(state, argument, node)
      if (
        !needsParentheses &&
        (operator.length > 1 ||
          (type[0] === 'U' &&
            (type[1] === 'n' || type[1] === 'p') &&
            argument.prefix &&
            argument.operator[0] === operator &&
            (operator === '+' || operator === '-')))
      ) {
        // Large operator or argument is UnaryExpression or UpdateExpression node
        state.write(' ')
      }
      if (needsParentheses) {
        state.write(operator.length > 1 ? ' (' : '(')
        this[type](argument, state)
        state.write(')')
      } else {
        this[type](argument, state)
      }
    } else {
      // FIXME: This case never occurs
      this[node.argument.type](node.argument, state)
      state.write(node.operator)
    }
  },
  UpdateExpression(node, state) {
    // Always applied to identifiers or members, no parenthesis check needed
    if (node.prefix) {
      state.write(node.operator)
      this[node.argument.type](node.argument, state)
    } else {
      this[node.argument.type](node.argument, state)
      state.write(node.operator)
    }
  },
  AssignmentExpression(node, state) {
    this[node.left.type](node.left, state)
    state.write(' ' + node.operator + ' ')
    this[node.right.type](node.right, state)
  },
  AssignmentPattern(node, state) {
    this[node.left.type](node.left, state)
    state.write(' = ')
    this[node.right.type](node.right, state)
  },
  BinaryExpression: (BinaryExpression = function (node, state) {
    const isIn = node.operator === 'in'
    if (isIn) {
      // Avoids confusion in `for` loops initializers
      state.write('(')
    }
    formatExpression(state, node.left, node, false)
    state.write(' ' + node.operator + ' ')
    formatExpression(state, node.right, node, true)
    if (isIn) {
      state.write(')')
    }
  }),
  LogicalExpression: BinaryExpression,
  ConditionalExpression(node, state) {
    const { test } = node
    const precedence = state.expressionsPrecedence[test.type]
    if (
      precedence === NEEDS_PARENTHESES ||
      precedence <= state.expressionsPrecedence.ConditionalExpression
    ) {
      state.write('(')
      this[test.type](test, state)
      state.write(')')
    } else {
      this[test.type](test, state)
    }
    state.write(' ? ')
    this[node.consequent.type](node.consequent, state)
    state.write(' : ')
    this[node.alternate.type](node.alternate, state)
  },
  NewExpression(node, state) {
    state.write('new ')
    const precedence = state.expressionsPrecedence[node.callee.type]
    if (
      precedence === NEEDS_PARENTHESES ||
      precedence < state.expressionsPrecedence.CallExpression ||
      hasCallExpression(node.callee)
    ) {
      state.write('(')
      this[node.callee.type](node.callee, state)
      state.write(')')
    } else {
      this[node.callee.type](node.callee, state)
    }
    formatSequence(state, node['arguments'])
  },
  CallExpression(node, state) {
    const precedence = state.expressionsPrecedence[node.callee.type]
    if (
      precedence === NEEDS_PARENTHESES ||
      precedence < state.expressionsPrecedence.CallExpression
    ) {
      state.write('(')
      this[node.callee.type](node.callee, state)
      state.write(')')
    } else {
      this[node.callee.type](node.callee, state)
    }
    if (node.optional) {
      state.write('?.')
    }
    formatSequence(state, node['arguments'])
  },
  ChainExpression(node, state) {
    this[node.expression.type](node.expression, state)
  },
  MemberExpression(node, state) {
    const precedence = state.expressionsPrecedence[node.object.type]
    if (
      precedence === NEEDS_PARENTHESES ||
      precedence < state.expressionsPrecedence.MemberExpression
    ) {
      state.write('(')
      this[node.object.type](node.object, state)
      state.write(')')
    } else {
      this[node.object.type](node.object, state)
    }
    if (node.computed) {
      if (node.optional) {
        state.write('?.')
      }
      state.write('[')
      this[node.property.type](node.property, state)
      state.write(']')
    } else {
      if (node.optional) {
        state.write('?.')
      } else {
        state.write('.')
      }
      this[node.property.type](node.property, state)
    }
  },
  MetaProperty(node, state) {
    state.write(node.meta.name + '.' + node.property.name, node)
  },
  Identifier(node, state) {
    state.write(node.name, node)
  },
  PrivateIdentifier(node, state) {
    state.write(`#${node.name}`, node)
  },
  Literal(node, state) {
    if (node.raw != null) {
      // Non-standard property
      state.write(node.raw, node)
    } else if (node.regex != null) {
      this.RegExpLiteral(node, state)
    } else if (node.bigint != null) {
      state.write(node.bigint + 'n', node)
    } else {
      state.write(stringify(node.value), node)
    }
  },
  RegExpLiteral(node, state) {
    const { regex } = node
    state.write(`/${regex.pattern}/${regex.flags}`, node)
  },
}

const EMPTY_OBJECT = {}

/*
DEPRECATED: Alternate export of `GENERATOR`.
*/
export const baseGenerator = GENERATOR

/*
Explicit syntax target profile.

The `target` option of `generate` enables an explicit syntax target profile:
the AST is checked node by node and operator by operator against the minimum
ECMAScript edition that each feature requires, function and class context
restrictions are verified, and the generated code is checked again with an
independent parser (Acorn by default) set to the target edition. Every check
runs before anything is written to the output, and no transpilation is
performed: code that does not fit the target is rejected.

Editions are identified by a number: `5` for ES5, `6` for ES2015, …, `13` for
ES2022.
*/

const MIN_TARGET_EDITION = 5
const MAX_TARGET_EDITION = 13

function editionName(edition) {
  /*
  Returns the display name of the provided ECMAScript `edition` number.
  */
  return edition === MIN_TARGET_EDITION ? 'ES5' : `ES${edition + 2009}`
}

/*
Error thrown when the provided AST or the generated code does not conform to
the requested syntax target. The offending `node` and its `loc` source
location are exposed when available.
*/
export class SyntaxTargetError extends SyntaxError {
  constructor(message, node) {
    if (node != null && node.loc != null && node.loc.start != null) {
      const { line, column } = node.loc.start
      message += ` (line ${line}, column ${column})`
    } else {
      message += ' (location unknown)'
    }
    super(message)
    this.name = 'SyntaxTargetError'
    if (node != null) {
      this.node = node
      if (node.loc != null) {
        this.loc = node.loc
      }
    }
  }
}

const NODE_VERSIONS = {
  // ES5 (baseline)
  Program: 5,
  Identifier: 5,
  Literal: 5,
  RegExpLiteral: 5,
  ThisExpression: 5,
  ArrayExpression: 5,
  ObjectExpression: 5,
  Property: 5,
  FunctionDeclaration: 5,
  FunctionExpression: 5,
  ExpressionStatement: 5,
  BlockStatement: 5,
  EmptyStatement: 5,
  DebuggerStatement: 5,
  WithStatement: 5,
  ReturnStatement: 5,
  LabeledStatement: 5,
  BreakStatement: 5,
  ContinueStatement: 5,
  IfStatement: 5,
  SwitchStatement: 5,
  SwitchCase: 5,
  ThrowStatement: 5,
  TryStatement: 5,
  CatchClause: 5,
  WhileStatement: 5,
  DoWhileStatement: 5,
  ForStatement: 5,
  ForInStatement: 5,
  VariableDeclaration: 5,
  VariableDeclarator: 5,
  UnaryExpression: 5,
  UpdateExpression: 5,
  BinaryExpression: 5,
  LogicalExpression: 5,
  AssignmentExpression: 5,
  ConditionalExpression: 5,
  CallExpression: 5,
  NewExpression: 5,
  MemberExpression: 5,
  SequenceExpression: 5,
  // ES2015
  ArrowFunctionExpression: 6,
  ClassBody: 6,
  ClassDeclaration: 6,
  ClassExpression: 6,
  MethodDefinition: 6,
  Super: 6,
  MetaProperty: 6,
  TemplateLiteral: 6,
  TemplateElement: 6,
  TaggedTemplateExpression: 6,
  YieldExpression: 6,
  ForOfStatement: 6,
  SpreadElement: 6,
  RestElement: 6,
  ObjectPattern: 6,
  ArrayPattern: 6,
  AssignmentPattern: 6,
  ImportDeclaration: 6,
  ImportSpecifier: 6,
  ImportDefaultSpecifier: 6,
  ImportNamespaceSpecifier: 6,
  ExportNamedDeclaration: 6,
  ExportDefaultDeclaration: 6,
  ExportAllDeclaration: 6,
  ExportSpecifier: 6,
  // ES2017
  AwaitExpression: 8,
  // ES2020
  ChainExpression: 11,
  ImportExpression: 11,
  // ES2022
  PropertyDefinition: 13,
  PrivateIdentifier: 13,
  StaticBlock: 13,
}

const OPERATOR_VERSIONS = {
  unary: {
    '-': 5,
    '+': 5,
    '!': 5,
    '~': 5,
    typeof: 5,
    void: 5,
    delete: 5,
  },
  update: {
    '++': 5,
    '--': 5,
  },
  binary: {
    '==': 5,
    '!=': 5,
    '===': 5,
    '!==': 5,
    '<': 5,
    '<=': 5,
    '>': 5,
    '>=': 5,
    '<<': 5,
    '>>': 5,
    '>>>': 5,
    '+': 5,
    '-': 5,
    '*': 5,
    '/': 5,
    '%': 5,
    '|': 5,
    '^': 5,
    '&': 5,
    in: 5,
    instanceof: 5,
    '**': 7,
  },
  logical: {
    '&&': 5,
    '||': 5,
    '??': 11,
  },
  assignment: {
    '=': 5,
    '+=': 5,
    '-=': 5,
    '*=': 5,
    '/=': 5,
    '%=': 5,
    '<<=': 5,
    '>>=': 5,
    '>>>=': 5,
    '&=': 5,
    '|=': 5,
    '^=': 5,
    '**=': 7,
    '&&=': 12,
    '||=': 12,
    '??=': 12,
  },
}

/*
Explicit syntax target profile: minimum ECMAScript edition required by each
known AST node type and operator. Node types and operators that are not listed
here are unknown to the profile and rejected when a `target` is set.
*/
export const SYNTAX_PROFILE = {
  nodes: NODE_VERSIONS,
  operators: OPERATOR_VERSIONS,
}

function normalizeTarget(target) {
  /*
  Returns the ECMAScript edition number of the provided `target`, which can be
  a name (`'es5'`, `'es2015'`, …), an edition number (`5`, `6`, …), or a year
  number (`2015`, …). Throws a `SyntaxTargetError` if the target is not
  supported.
  */
  let edition = target
  if (typeof edition === 'string') {
    const name = edition.trim().toLowerCase()
    edition = Number(
      name[0] === 'e' && name[1] === 's' ? name.substring(2) : name,
    )
  }
  if (typeof edition === 'number' && edition >= 2015) {
    edition -= 2009
  }
  if (
    typeof edition !== 'number' ||
    !Number.isInteger(edition) ||
    (edition !== MIN_TARGET_EDITION &&
      (edition < 6 || edition > MAX_TARGET_EDITION))
  ) {
    throw new SyntaxTargetError(
      `Unsupported syntax target "${target}"; supported targets are "es5" and "es2015" to "es2022"`,
    )
  }
  return edition
}

function fail(node, message) {
  throw new SyntaxTargetError(message, node)
}

function requireEdition(node, context, edition, feature) {
  /*
  Throws a `SyntaxTargetError` if the `feature` requiring the provided
  `edition` does not fit the target edition of the `context`.
  */
  if (context.edition < edition) {
    fail(
      node,
      `${feature} requires ${editionName(
        edition,
      )}, but the target is ${editionName(context.edition)}`,
    )
  }
}

function checkOperator(node, context, versions, type) {
  /*
  Checks the operator of the provided `node` against the `versions` table.
  Unknown operators are rejected.
  */
  const version = versions[node.operator]
  if (version == null) {
    fail(node, `Unknown ${type} operator "${node.operator}"`)
  }
  requireEdition(node, context, version, `Operator "${node.operator}"`)
}

function checkAsyncContext(node, context, feature) {
  /*
  Checks that `await`-related features occur in an async context: an async
  function, or the top level of a module with target ES2022 or later.
  */
  if (context.staticBlockDepth > 0) {
    fail(node, `"${feature}" is not allowed in a class static block`)
  }
  const { functionContext } = context
  if (functionContext == null) {
    if (context.edition < 13 || context.sourceType !== 'module') {
      fail(
        node,
        `"${feature}" requires an async function, or the top level of a module with target ES2022 or later`,
      )
    }
  } else if (functionContext.async !== true) {
    fail(node, `"${feature}" requires an async function`)
  }
}

function checkNode(node, parent, context) {
  /*
  Checks the provided AST `node` against the syntax target profile, based on
  its type, its operator, and the function and class `context` it occurs in.
  */
  const nodeVersion = NODE_VERSIONS[node.type]
  if (nodeVersion == null) {
    fail(node, `Unknown node type "${node.type}"`)
  }
  requireEdition(node, context, nodeVersion, `Node type "${node.type}"`)
  switch (node.type) {
    case 'VariableDeclaration':
      if (node.kind === 'let' || node.kind === 'const') {
        requireEdition(node, context, 6, `"${node.kind}" declaration`)
      } else if (node.kind !== 'var') {
        fail(node, `Unknown variable declaration kind "${node.kind}"`)
      }
      break
    case 'Property':
      if (node.kind !== 'init' && node.kind !== 'get' && node.kind !== 'set') {
        fail(node, `Unknown property kind "${node.kind}"`)
      }
      if (node.computed === true) {
        requireEdition(node, context, 6, 'Computed properties')
      }
      if (node.shorthand === true) {
        requireEdition(node, context, 6, 'Shorthand properties')
      }
      if (node.method === true) {
        requireEdition(node, context, 6, 'Method properties')
      }
      break
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
      if (node.async === true) {
        requireEdition(node, context, 8, 'Async functions')
      }
      if (node.generator === true) {
        requireEdition(node, context, 6, 'Generator functions')
      }
      if (node.async === true && node.generator === true) {
        requireEdition(node, context, 9, 'Async generator functions')
      }
      break
    case 'SpreadElement':
      if (parent != null && parent.type === 'ObjectExpression') {
        requireEdition(node, context, 9, 'Object spread properties')
      }
      break
    case 'RestElement':
      if (parent != null && parent.type === 'ObjectPattern') {
        requireEdition(node, context, 9, 'Object rest properties')
      }
      break
    case 'CatchClause':
      if (node.param == null) {
        requireEdition(node, context, 10, 'Optional catch binding')
      }
      break
    case 'MemberExpression':
    case 'CallExpression':
      if (node.optional === true) {
        requireEdition(node, context, 11, 'Optional chaining')
      }
      if (
        node.type === 'CallExpression' &&
        node.callee != null &&
        node.callee.type === 'Super'
      ) {
        // Super call
        if (
          context.staticBlockDepth > 0 ||
          context.methodFunctionContext == null ||
          context.methodFunctionContext.kind !== 'constructor'
        ) {
          fail(node, '"super(…)" calls require a class constructor')
        }
      }
      break
    case 'ExportAllDeclaration':
      if (node.exported != null) {
        requireEdition(node, context, 11, '"export * as" declarations')
      }
      break
    case 'Literal':
      if (node.bigint != null) {
        requireEdition(node, context, 11, 'BigInt literals')
      } else if (
        typeof node.value === 'number' &&
        typeof node.raw === 'string' &&
        node.raw.indexOf('_') !== -1
      ) {
        requireEdition(node, context, 12, 'Numeric separators')
      }
      break
    case 'UnaryExpression':
      checkOperator(node, context, OPERATOR_VERSIONS.unary, 'unary')
      break
    case 'UpdateExpression':
      checkOperator(node, context, OPERATOR_VERSIONS.update, 'update')
      break
    case 'BinaryExpression':
      checkOperator(node, context, OPERATOR_VERSIONS.binary, 'binary')
      if (node.left != null && node.left.type === 'PrivateIdentifier') {
        requireEdition(node, context, 13, 'Private identifier "in" checks')
      }
      break
    case 'LogicalExpression':
      checkOperator(node, context, OPERATOR_VERSIONS.logical, 'logical')
      break
    case 'AssignmentExpression':
      checkOperator(node, context, OPERATOR_VERSIONS.assignment, 'assignment')
      break
    case 'ForOfStatement':
      if (node.await === true) {
        requireEdition(node, context, 9, 'Asynchronous iteration')
        checkAsyncContext(node, context, 'for await…of')
      }
      break
    case 'AwaitExpression':
      checkAsyncContext(node, context, 'await')
      break
    case 'YieldExpression':
      if (
        context.staticBlockDepth > 0 ||
        context.functionContext == null ||
        context.functionContext.generator !== true
      ) {
        fail(node, '"yield" requires a generator function')
      }
      break
    case 'ReturnStatement':
      if (context.functionContext == null) {
        fail(node, '"return" requires a function')
      }
      break
    case 'Super':
      if (
        context.staticBlockDepth === 0 &&
        (context.methodFunctionContext == null ||
          context.methodFunctionContext.kind === 'function')
      ) {
        fail(node, '"super" requires a method or a class static block')
      }
      break
    case 'MetaProperty': {
      const meta = node.meta != null ? node.meta.name : null
      const property = node.property != null ? node.property.name : null
      if (meta === 'new' && property === 'target') {
        if (
          context.methodFunctionContext == null &&
          context.staticBlockDepth === 0
        ) {
          fail(node, '"new.target" requires a function')
        }
      } else if (meta === 'import' && property === 'meta') {
        requireEdition(node, context, 11, '"import.meta"')
        if (context.sourceType !== 'module') {
          fail(node, '"import.meta" requires a module')
        }
      } else {
        fail(node, `Unknown meta property "${meta}.${property}"`)
      }
      break
    }
    case 'PrivateIdentifier':
      if (context.classDepth === 0) {
        fail(
          node,
          `Private identifier "#${node.name}" requires an enclosing class`,
        )
      }
      break
  }
}

const IGNORED_NODE_KEYS = {
  loc: true,
  range: true,
  start: true,
  end: true,
  raw: true,
  comments: true,
  leadingComments: true,
  trailingComments: true,
}

function validateChildren(node, context) {
  /*
  Validates every child AST node of the provided `node`.
  */
  for (const key in node) {
    if (IGNORED_NODE_KEYS[key] !== true) {
      validateNode(node[key], node, context, null)
    }
  }
}

const METHOD_CONTEXT = {
  async: false,
  generator: false,
  kind: 'method',
}

function validateNode(node, parent, context, kind) {
  /*
  Validates the provided AST `node` and its children against the syntax target
  profile, keeping track of the function and class `context`. The `kind`
  parameter provides the method kind (`'constructor'` or `'method'`) when the
  node is the value of a method or property definition.
  */
  if (node == null) {
    return
  }
  if (Array.isArray(node)) {
    for (let i = 0, { length } = node; i < length; i++) {
      validateNode(node[i], parent, context, null)
    }
    return
  }
  if (typeof node.type !== 'string') {
    // Not an AST node (e.g., location or regex information)
    return
  }
  checkNode(node, parent, context)
  switch (node.type) {
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression': {
      const { functionContext, methodFunctionContext, staticBlockDepth } =
        context
      context.functionContext = {
        async: node.async === true,
        generator: node.generator === true,
        kind: kind != null ? kind : 'function',
      }
      if (node.type !== 'ArrowFunctionExpression') {
        // Arrow functions inherit `this`, `super`, and `new.target` from the
        // enclosing context, other functions do not
        context.methodFunctionContext = context.functionContext
      }
      context.staticBlockDepth = 0
      validateChildren(node, context)
      context.functionContext = functionContext
      context.methodFunctionContext = methodFunctionContext
      context.staticBlockDepth = staticBlockDepth
      return
    }
    case 'StaticBlock': {
      const { functionContext, methodFunctionContext } = context
      context.functionContext = null
      context.methodFunctionContext = null
      context.staticBlockDepth++
      validateChildren(node, context)
      context.functionContext = functionContext
      context.methodFunctionContext = methodFunctionContext
      context.staticBlockDepth--
      return
    }
    case 'ClassDeclaration':
    case 'ClassExpression':
      context.classDepth++
      validateChildren(node, context)
      context.classDepth--
      return
    case 'MethodDefinition':
      validateNode(node.key, node, context, null)
      validateNode(
        node.value,
        node,
        context,
        node.kind === 'constructor' ? 'constructor' : 'method',
      )
      return
    case 'PropertyDefinition': {
      // Class field initializers are evaluated like method calls: they can
      // use `super` and `new.target`, but not `await`, `yield`, or `return`
      const { functionContext, methodFunctionContext } = context
      validateNode(node.key, node, context, null)
      context.functionContext = METHOD_CONTEXT
      context.methodFunctionContext = METHOD_CONTEXT
      validateNode(node.value, node, context, null)
      context.functionContext = functionContext
      context.methodFunctionContext = methodFunctionContext
      return
    }
    case 'Property':
      validateNode(node.key, node, context, null)
      validateNode(
        node.value,
        node,
        context,
        node.method === true || node.kind !== 'init' ? 'method' : null,
      )
      return
    default:
      validateChildren(node, context)
  }
}

function validateSyntax(node, edition, sourceType) {
  /*
  Throws a `SyntaxTargetError` if the provided AST `node` uses syntax that
  does not fit the provided ECMAScript `edition`, or uses known syntax in an
  invalid function or class context.
  */
  validateNode(
    node,
    null,
    {
      edition,
      sourceType,
      functionContext: null,
      methodFunctionContext: null,
      classDepth: 0,
      staticBlockDepth: 0,
    },
    null,
  )
}

function generateWithTarget(node, setup) {
  /*
  Returns a string representing the rendered code of the provided AST `node`,
  checked against the explicit syntax target profile of `setup.target`. Every
  check runs before anything is written to `setup.output`.
  */
  const edition = normalizeTarget(setup.target)
  const sourceType =
    setup.sourceType != null
      ? setup.sourceType
      : node != null && node.type === 'Program' && node.sourceType === 'module'
      ? 'module'
      : 'script'
  // Checks the AST against the syntax target profile
  validateSyntax(node, edition, sourceType)
  // Generates the code into an internal buffer
  const state = new State({ ...setup, output: null })
  state.generator[node.type](node, state)
  const code = state.output
  // Checks the generated code with an independent parser
  const parse = setup.parser != null ? setup.parser : parseWithAcorn
  try {
    parse(code, { ecmaVersion: edition, sourceType })
  } catch (error) {
    throw new SyntaxTargetError(
      `Generated code does not conform to ${editionName(edition)}: ${
        error.message
      }`,
      node,
    )
  }
  // All checks passed: writes the code to the output stream, if any
  if (setup.output != null) {
    setup.output.write(code)
    return setup.output
  }
  return code
}

class State {
  constructor(options) {
    const setup = options == null ? EMPTY_OBJECT : options
    this.output = ''
    // Functional options
    if (setup.output != null) {
      this.output = setup.output
      this.write = this.writeToStream
    } else {
      this.output = ''
    }
    this.generator = setup.generator != null ? setup.generator : GENERATOR
    this.expressionsPrecedence =
      setup.expressionsPrecedence != null
        ? setup.expressionsPrecedence
        : EXPRESSIONS_PRECEDENCE
    // Formating setup
    this.indent = setup.indent != null ? setup.indent : '  '
    this.lineEnd = setup.lineEnd != null ? setup.lineEnd : '\n'
    this.indentLevel =
      setup.startingIndentLevel != null ? setup.startingIndentLevel : 0
    this.writeComments = setup.comments ? setup.comments : false
    // Source map
    if (setup.sourceMap != null) {
      this.write =
        setup.output == null ? this.writeAndMap : this.writeToStreamAndMap
      this.sourceMap = setup.sourceMap
      this.line = 1
      this.column = 0
      this.lineEndSize = this.lineEnd.split('\n').length - 1
      this.mapping = {
        original: null,
        // Uses the entire state to avoid generating ephemeral objects
        generated: this,
        name: undefined,
        source: setup.sourceMap.file || setup.sourceMap._file,
      }
    }
  }

  write(code) {
    this.output += code
  }

  writeToStream(code) {
    this.output.write(code)
  }

  writeAndMap(code, node) {
    this.output += code
    this.map(code, node)
  }

  writeToStreamAndMap(code, node) {
    this.output.write(code)
    this.map(code, node)
  }

  map(code, node) {
    if (node != null) {
      const { type } = node
      if (type[0] === 'L' && type[2] === 'n') {
        // LineComment
        this.column = 0
        this.line++
        return
      }
      if (node.loc != null) {
        const { mapping } = this
        mapping.original = node.loc.start
        mapping.name = node.name
        this.sourceMap.addMapping(mapping)
      }
      if (
        (type[0] === 'T' && type[8] === 'E') ||
        (type[0] === 'L' && type[1] === 'i' && typeof node.value === 'string')
      ) {
        // TemplateElement or Literal string node
        const { length } = code
        let { column, line } = this
        for (let i = 0; i < length; i++) {
          if (code[i] === '\n') {
            column = 0
            line++
          } else {
            column++
          }
        }
        this.column = column
        this.line = line
        return
      }
    }
    const { length } = code
    const { lineEnd } = this
    if (length > 0) {
      if (
        this.lineEndSize > 0 &&
        (lineEnd.length === 1
          ? code[length - 1] === lineEnd
          : code.endsWith(lineEnd))
      ) {
        this.line += this.lineEndSize
        this.column = 0
      } else {
        this.column += length
      }
    }
  }

  toString() {
    return this.output
  }
}

export function generate(node, options) {
  /*
  Returns a string representing the rendered code of the provided AST `node`.
  The `options` are:

  - `indent`: string to use for indentation (defaults to `␣␣`)
  - `lineEnd`: string to use for line endings (defaults to `\n`)
  - `startingIndentLevel`: indent level to start from (defaults to `0`)
  - `comments`: generate comments if `true` (defaults to `false`)
  - `output`: output stream to write the rendered code to (defaults to `null`)
  - `generator`: custom code generator (defaults to `GENERATOR`)
  - `expressionsPrecedence`: custom map of node types and their precedence level (defaults to `EXPRESSIONS_PRECEDENCE`)
  - `target`: ECMAScript syntax target (`'es5'`, `'es2015'`, …, `'es2022'`, or the corresponding edition or year number) that enables the explicit syntax target profile (defaults to `null`, no check)
  - `parser`: parser function used to check the generated code when `target` is set (defaults to Acorn's `parse`)
  - `sourceType`: source type (`'script'` or `'module'`) used when checking the generated code, derived from the AST if omitted (defaults to `null`)
  */
  const setup = options == null ? EMPTY_OBJECT : options
  if (setup.target != null) {
    // Check the AST and the generated code against the syntax target profile
    return generateWithTarget(node, setup)
  }
  const state = new State(options)
  // Travel through the AST node and generate the code
  state.generator[node.type](node, state)
  return state.output
}
