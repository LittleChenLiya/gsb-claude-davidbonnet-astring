// Astring is a tiny and fast JavaScript code generator from an ESTree-compliant AST.
//
// Astring was written by David Bonnet and released under an MIT license.
//
// The Git repository for Astring is available at:
// https://github.com/davidbonnet/astring.git
//
// Please use the GitHub bug tracker to report issues:
// https://github.com/davidbonnet/astring/issues

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

/*
Strict raw literal strategy.
A `Literal` node carrying the non-standard `raw` property is only rendered
verbatim if that `raw` parses back into exactly one literal whose value is
equivalent to the node's declared `value` (string, number, BigInt or RegExp).
No `eval` is ever used: the parsing function is injected explicitly through
the `literalParser` option and must implement:

  parseLiteral(raw: string, node: object): ESTree.ExpressionNode

A bare function with the same signature is also accepted. The whole AST is
verified before anything is written to the output, so a single invalid node
prevents any output at all.
*/

export class LiteralVerificationError extends Error {
  constructor(message, node) {
    super(message)
    this.name = 'LiteralVerificationError'
    this.node = node
  }
}

const LITERAL_NODE_TYPES = ['Literal', 'RegExpLiteral', 'BigIntLiteral']

const WHITESPACE_ONLY = /^\s*$/

// Canonical rendering of a verified literal that has no `raw` property.
function strictRawLiteral(node, state) {
  if (typeof node.raw === 'string') {
    // The raw has been verified against the declared value beforehand
    state.write(node.raw, node)
  } else if (node.regex != null) {
    state.write(`/${node.regex.pattern}/${node.regex.flags}`, node)
  } else if (node.bigint != null) {
    state.write(node.bigint + 'n', node)
  } else if (typeof node.value === 'bigint') {
    state.write(String(node.value) + 'n', node)
  } else if (node.value instanceof RegExp) {
    state.write(`/${node.value.source}/${node.value.flags}`, node)
  } else if (typeof node.value === 'number' && Object.is(node.value, -0)) {
    // `JSON.stringify(-0)` is `"0"`: preserve the negative-zero identity
    state.write('-0', node)
  } else {
    state.write(stringify(node.value), node)
  }
}

// Builds the identity descriptor of a declared literal node, or `null` if the
// declared value cannot be represented by a strict literal (e.g. `NaN`).
function literalIdentity(node) {
  if (node.regex != null && typeof node.regex.pattern === 'string') {
    return {
      kind: 'RegExp',
      pattern: node.regex.pattern,
      flags: node.regex.flags == null ? '' : String(node.regex.flags),
    }
  }
  if (node.bigint != null) {
    return { kind: 'BigInt', digits: String(node.bigint) }
  }
  const { value } = node
  if (typeof value === 'bigint') {
    return { kind: 'BigInt', digits: String(value) }
  }
  switch (typeof value) {
    case 'string':
      return { kind: 'string', value }
    case 'number':
      // Non-finite numbers (`NaN`, `Infinity`) are not literals and would be
      // turned into `null` by `JSON.stringify`
      return Number.isFinite(value) ? { kind: 'number', value } : null
    case 'boolean':
      return { kind: 'boolean', value }
    case 'object':
      return value === null ? { kind: 'null' } : null
    default:
      return null
  }
}

// Resolves the identity of the single expression parsed from a `raw` string.
// Only plain literals are recognized, plus the negative-zero convention
// (unary minus applied to the numeric literal `0`).
function expressionLiteralIdentity(expression) {
  if (expression == null) {
    return null
  }
  if (LITERAL_NODE_TYPES.indexOf(expression.type) !== -1) {
    return literalIdentity(expression)
  }
  if (
    expression.type === 'UnaryExpression' &&
    expression.prefix &&
    expression.operator === '-' &&
    expression.argument != null &&
    expression.argument.type === 'Literal' &&
    typeof expression.argument.value === 'number' &&
    Object.is(expression.argument.value, 0)
  ) {
    // The negative-zero identity convention: `-0`, `-0.0`, ...
    return { kind: 'number', value: -0 }
  }
  return null
}

function normalizeRegExpFlags(flags) {
  return String(flags).split('').sort().join('')
}

// Compares the true identity of two literals. Strings, numbers, BigInts and
// RegExps are each compared with their type-specific identity.
function literalIdentitiesMatch(left, right) {
  if (left == null || right == null || left.kind !== right.kind) {
    return false
  }
  switch (left.kind) {
    case 'string':
      return left.value === right.value
    case 'number':
      // `Object.is` distinguishes negative zero from positive zero
      return Object.is(left.value, right.value)
    case 'boolean':
      return left.value === right.value
    case 'null':
      return true
    case 'BigInt':
      return left.digits === right.digits
    case 'RegExp':
      // The pattern and the flags are both verified (flag order is irrelevant)
      return (
        left.pattern === right.pattern &&
        normalizeRegExpFlags(left.flags) === normalizeRegExpFlags(right.flags)
      )
    default:
      return false
  }
}

function resolveLiteralParser(parser) {
  if (typeof parser === 'function') {
    return parser
  }
  if (parser != null && typeof parser.parseLiteral === 'function') {
    return (raw, node) => parser.parseLiteral(raw, node)
  }
  throw new LiteralVerificationError(
    'A `literalParser` function or an object with a `parseLiteral(raw, node)` method is required for strict raw literal verification',
  )
}

function verifyLiteralNode(node, parseLiteral) {
  const { raw } = node
  if (raw != null && typeof raw !== 'string') {
    throw new LiteralVerificationError(
      `Invalid literal raw ${stringify(raw)}: expected a string`,
      node,
    )
  }
  const declaredIdentity = literalIdentity(node)
  if (typeof raw !== 'string') {
    if (declaredIdentity == null) {
      throw new LiteralVerificationError(
        'Literal declares a value that cannot be rendered as a strict literal',
        node,
      )
    }
    return
  }
  let expression
  try {
    expression = parseLiteral(raw, node)
  } catch (error) {
    throw new LiteralVerificationError(
      `Literal raw ${stringify(raw)} could not be parsed: ${error.message}`,
      node,
    )
  }
  if (
    expression == null ||
    typeof expression !== 'object' ||
    typeof expression.type !== 'string'
  ) {
    throw new LiteralVerificationError(
      `Literal raw ${stringify(raw)} did not parse into an AST node`,
      node,
    )
  }
  if (
    typeof expression.start === 'number' &&
    typeof expression.end === 'number'
  ) {
    // The raw must contain the literal and nothing else: any trailing code,
    // semicolon or comment is rejected
    if (
      !WHITESPACE_ONLY.test(raw.slice(0, expression.start)) ||
      !WHITESPACE_ONLY.test(raw.slice(expression.end))
    ) {
      throw new LiteralVerificationError(
        `Literal raw ${stringify(
          raw,
        )} must contain a single literal with no additional code`,
        node,
      )
    }
  }
  const parsedIdentity = expressionLiteralIdentity(expression)
  if (!literalIdentitiesMatch(parsedIdentity, declaredIdentity)) {
    throw new LiteralVerificationError(
      `Literal raw ${stringify(
        raw,
      )} must denote a single literal equivalent to its declared value`,
      node,
    )
  }
}

function isTraversableValue(value) {
  return (
    value != null &&
    typeof value === 'object' &&
    (Array.isArray(value) || typeof value.type !== 'undefined')
  )
}

// Walks every AST node reachable from `node` (arrays of children included).
// Non-node objects (e.g. locations, `regex` descriptors) are not descended
// into, and cycles are ignored.
function visitAstNodes(node, visit) {
  const seen = new Set()
  const walk = (currentNode) => {
    if (!isTraversableValue(currentNode) || seen.has(currentNode)) {
      return
    }
    seen.add(currentNode)
    if (Array.isArray(currentNode)) {
      for (const item of currentNode) {
        walk(item)
      }
      return
    }
    if (typeof currentNode.type === 'string') {
      visit(currentNode)
    }
    for (const key in currentNode) {
      if (key === 'parent' || key === 'loc' || key === 'range') {
        continue
      }
      walk(currentNode[key])
    }
  }
  walk(node)
}

export function verifyLiterals(node, parser) {
  /*
  Verifies every literal node reachable from the provided AST `node` using the
  explicitly injected `parser` (a function or an object exposing
  `parseLiteral(raw, node)`). Throws a `LiteralVerificationError` at the first
  node whose `raw` does not parse into a single literal equivalent to its
  declared value. Returns the `node` unchanged when the whole tree is valid.
  */
  const parseLiteral = resolveLiteralParser(parser)
  visitAstNodes(node, (child) => {
    if (LITERAL_NODE_TYPES.indexOf(child.type) !== -1) {
      verifyLiteralNode(child, parseLiteral)
    }
  })
  return node
}

const EMPTY_OBJECT = {}

/*
DEPRECATED: Alternate export of `GENERATOR`.
*/
export const baseGenerator = GENERATOR

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
    let { generator } = setup
    if (setup.strictRaw) {
      // Render `Literal` nodes only from values already verified by the
      // preflight; custom generators are preserved through prototyping
      if (generator == null) {
        generator = GENERATOR
      }
      generator = Object.create(generator)
      generator.Literal = strictRawLiteral
    } else if (generator == null) {
      generator = GENERATOR
    }
    this.generator = generator
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
  - `strictRaw`: when `true`, the whole AST is verified before anything is written: every `Literal` `raw` must parse into a single literal equivalent to its declared `value` (defaults to `false`, which leaves generation unchanged)
  - `literalParser`: parser injected explicitly for strict raw verification, as a function `(raw, node) => expressionNode` or an object exposing `parseLiteral(raw, node)`; required when `strictRaw` is enabled
  */
  if (options != null && options.strictRaw) {
    // The whole tree must pass preflight before a single write happens
    verifyLiterals(node, options.literalParser)
  }
  const state = new State(options)
  // Travel through the AST node and generate the code
  state.generator[node.type](node, state)
  return state.output
}
