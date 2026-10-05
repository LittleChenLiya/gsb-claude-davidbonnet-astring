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

const EMPTY_OBJECT = {}

/*
DEPRECATED: Alternate export of `GENERATOR`.
*/
export const baseGenerator = GENERATOR

// ============================================================================
// Syntax profile
//
// A syntax profile restricts the generated code to a target ECMAScript edition.
// It checks every AST node, operator and contextual rule (such as where `await`
// and `yield` are allowed) before any code is written. Unknown node types are
// rejected by default. Nothing is transpiled: if the AST uses syntax newer than
// the target, an error is thrown.
// ============================================================================

// Minimum ECMAScript edition (5..16) at which each ESTree node type was introduced.
export const NODE_VERSIONS = {
  // ES5
  Program: 5,
  ExpressionStatement: 5,
  BlockStatement: 5,
  EmptyStatement: 5,
  DebuggerStatement: 5,
  Identifier: 5,
  ThisExpression: 5,
  Literal: 5,
  RegExpLiteral: 5,
  ArrayExpression: 5,
  ObjectExpression: 5,
  Property: 5,
  FunctionDeclaration: 5,
  FunctionExpression: 5,
  VariableDeclaration: 5,
  VariableDeclarator: 5,
  BinaryExpression: 5,
  UnaryExpression: 5,
  UpdateExpression: 5,
  LogicalExpression: 5,
  ConditionalExpression: 5,
  AssignmentExpression: 5,
  SequenceExpression: 5,
  MemberExpression: 5,
  CallExpression: 5,
  NewExpression: 5,
  ReturnStatement: 5,
  ThrowStatement: 5,
  TryStatement: 5,
  SwitchStatement: 5,
  BreakStatement: 5,
  ContinueStatement: 5,
  LabeledStatement: 5,
  IfStatement: 5,
  WhileStatement: 5,
  DoWhileStatement: 5,
  ForStatement: 5,
  ForInStatement: 5,
  WithStatement: 5,
  SwitchCase: 5,
  CatchClause: 5,
  // ES2015
  ArrowFunctionExpression: 6,
  ClassDeclaration: 6,
  ClassExpression: 6,
  ClassBody: 6,
  MethodDefinition: 6,
  TemplateLiteral: 6,
  TemplateElement: 6,
  TaggedTemplateExpression: 6,
  SpreadElement: 6,
  RestElement: 6,
  AssignmentPattern: 6,
  ObjectPattern: 6,
  ArrayPattern: 6,
  ForOfStatement: 6,
  YieldExpression: 6,
  ImportDeclaration: 6,
  ImportSpecifier: 6,
  ImportDefaultSpecifier: 6,
  ImportNamespaceSpecifier: 6,
  ExportNamedDeclaration: 6,
  ExportSpecifier: 6,
  ExportDefaultDeclaration: 6,
  ExportAllDeclaration: 6,
  Super: 6,
  MetaProperty: 6,
  // ES2017
  AwaitExpression: 8,
  // ES2020
  ChainExpression: 11,
  ImportExpression: 11,
  // ES2022
  PropertyDefinition: 13,
  PrivateIdentifier: 13,
  StaticBlock: 13,
  // Stage 3 proposals (ES2025)
  ImportAttribute: 16,
}

// Minimum ECMAScript edition at which each operator was introduced.
export const OPERATOR_VERSIONS = {
  '**': 7,
  '**=': 7,
  '??': 11,
  '&&=': 12,
  '||=': 12,
  '??=': 12,
}

// Minimum ECMAScript edition at which each regular expression flag was introduced.
export const REGEXP_FLAG_VERSIONS = {
  y: 6, // sticky
  u: 6, // unicode
  s: 9, // dotAll
  d: 13, // indices
  v: 15, // unicode sets
}

// Child keys of each node type, used to walk the AST.
const NODE_CHILD_KEYS = {
  Program: ['body'],
  ExpressionStatement: ['expression'],
  BlockStatement: ['body'],
  StaticBlock: ['body'],
  EmptyStatement: [],
  DebuggerStatement: [],
  IfStatement: ['test', 'consequent', 'alternate'],
  LabeledStatement: ['label', 'body'],
  BreakStatement: ['label'],
  ContinueStatement: ['label'],
  WithStatement: ['object', 'body'],
  SwitchStatement: ['discriminant', 'cases'],
  SwitchCase: ['test', 'consequent'],
  ReturnStatement: ['argument'],
  ThrowStatement: ['argument'],
  TryStatement: ['block', 'handler', 'finalizer'],
  CatchClause: ['param', 'body'],
  WhileStatement: ['test', 'body'],
  DoWhileStatement: ['body', 'test'],
  ForStatement: ['init', 'test', 'update', 'body'],
  ForInStatement: ['left', 'right', 'body'],
  ForOfStatement: ['left', 'right', 'body'],
  FunctionDeclaration: ['id', 'params', 'body'],
  FunctionExpression: ['id', 'params', 'body'],
  VariableDeclaration: ['declarations'],
  VariableDeclarator: ['id', 'init'],
  ClassDeclaration: ['id', 'superClass', 'body'],
  ClassExpression: ['id', 'superClass', 'body'],
  ClassBody: ['body'],
  MethodDefinition: ['key', 'value'],
  PropertyDefinition: ['key', 'value'],
  ImportDeclaration: ['specifiers', 'source', 'attributes'],
  ImportSpecifier: ['imported', 'local'],
  ImportDefaultSpecifier: ['local'],
  ImportNamespaceSpecifier: ['local'],
  ImportAttribute: ['key', 'value'],
  ImportExpression: ['source'],
  ExportNamedDeclaration: ['declaration', 'specifiers', 'source', 'attributes'],
  ExportSpecifier: ['local', 'exported'],
  ExportDefaultDeclaration: ['declaration'],
  ExportAllDeclaration: ['exported', 'source', 'attributes'],
  ArrowFunctionExpression: ['params', 'body'],
  ThisExpression: [],
  Super: [],
  RestElement: ['argument'],
  SpreadElement: ['argument'],
  YieldExpression: ['argument'],
  AwaitExpression: ['argument'],
  TemplateLiteral: ['quasis', 'expressions'],
  TemplateElement: [],
  TaggedTemplateExpression: ['tag', 'quasi'],
  ArrayExpression: ['elements'],
  ArrayPattern: ['elements'],
  ObjectExpression: ['properties'],
  ObjectPattern: ['properties'],
  Property: ['key', 'value'],
  SequenceExpression: ['expressions'],
  UnaryExpression: ['argument'],
  UpdateExpression: ['argument'],
  BinaryExpression: ['left', 'right'],
  LogicalExpression: ['left', 'right'],
  ConditionalExpression: ['test', 'consequent', 'alternate'],
  AssignmentExpression: ['left', 'right'],
  AssignmentPattern: ['left', 'right'],
  NewExpression: ['callee', 'arguments'],
  CallExpression: ['callee', 'arguments'],
  ChainExpression: ['expression'],
  MemberExpression: ['object', 'property'],
  MetaProperty: ['meta', 'property'],
  Identifier: [],
  PrivateIdentifier: [],
  Literal: [],
  RegExpLiteral: [],
}

const SCOPE_FUNCTION = 'function'
const SCOPE_CLASS = 'class'
const SCOPE_METHOD = 'method'
const SCOPE_STATIC_BLOCK = 'static-block'

function isNode(value) {
  return value != null && typeof value.type === 'string'
}

function editionLabel(edition) {
  return edition >= 6 ? `ES${2009 + edition}` : 'ES5'
}

function nodeLocation(node) {
  if (node.loc != null && node.loc.start != null) {
    const { line, column } = node.loc.start
    return `line ${line}, column ${column}`
  }
  if (node.start != null) {
    return `offset ${node.start}`
  }
  return 'unknown location'
}

function nearestScope(scope, kinds) {
  const wanted = Array.isArray(kinds) ? kinds : [kinds]
  for (let i = scope.length - 1; i >= 0; i--) {
    if (wanted.indexOf(scope[i].kind) !== -1) {
      return scope[i]
    }
  }
  return null
}

function reject(violations, node, message) {
  violations.push({ node, message: `${message} at ${nodeLocation(node)}` })
}

// Checks node-specific and contextual rules for `node`.
function checkNodeSyntax(node, parent, ctx) {
  const { violations, scope, target, sourceType } = ctx
  switch (node.type) {
    case 'AwaitExpression': {
      const fn = nearestScope(scope, SCOPE_FUNCTION)
      if (fn != null) {
        if (!fn.async) {
          reject(violations, node, '"await" is only allowed in async functions')
        }
      } else if (sourceType !== 'module' || target < 13) {
        reject(
          violations,
          node,
          '"await" at top level requires a module target of at least ES2022',
        )
      }
      break
    }
    case 'YieldExpression': {
      const fn = nearestScope(scope, SCOPE_FUNCTION)
      if (fn == null || !fn.generator) {
        reject(
          violations,
          node,
          '"yield" is only allowed in generator functions',
        )
      }
      break
    }
    case 'ForOfStatement': {
      if (node.await) {
        const fn = nearestScope(scope, SCOPE_FUNCTION)
        if (fn != null) {
          if (!fn.async) {
            reject(
              violations,
              node,
              '"for await" is only allowed in async functions',
            )
          }
        } else if (sourceType !== 'module' || target < 13) {
          reject(
            violations,
            node,
            '"for await" at top level requires a module target of at least ES2022',
          )
        }
      }
      break
    }
    case 'Super': {
      if (nearestScope(scope, [SCOPE_CLASS, SCOPE_METHOD]) == null) {
        reject(
          violations,
          node,
          '"super" is only allowed in classes and object methods',
        )
      }
      break
    }
    case 'PrivateIdentifier': {
      if (nearestScope(scope, SCOPE_CLASS) == null) {
        reject(
          violations,
          node,
          'Private identifiers are only allowed in class bodies',
        )
      }
      break
    }
    case 'MetaProperty': {
      if (node.meta.name === 'import') {
        if (sourceType !== 'module' || target < 11) {
          reject(
            violations,
            node,
            '"import.meta" requires a module target of at least ES2020',
          )
        }
      } else if (node.meta.name === 'new') {
        if (nearestScope(scope, [SCOPE_FUNCTION, SCOPE_STATIC_BLOCK]) == null) {
          reject(
            violations,
            node,
            '"new.target" is only allowed in functions and class static blocks',
          )
        }
      }
      break
    }
    case 'TryStatement': {
      if (node.handler == null && target < 10) {
        reject(violations, node, 'Optional catch binding requires ES2019')
      }
      break
    }
    case 'MemberExpression':
    case 'CallExpression': {
      if (node.optional && target < 11) {
        reject(violations, node, 'Optional chaining requires ES2020')
      }
      break
    }
    case 'ChainExpression': {
      if (target < 11) {
        reject(violations, node, 'Optional chaining requires ES2020')
      }
      break
    }
    case 'ImportExpression': {
      if (target < 11) {
        reject(violations, node, '"import()" requires ES2020')
      }
      break
    }
    case 'Literal': {
      if (node.bigint != null && target < 11) {
        reject(violations, node, 'BigInt literals require ES2020')
      }
      if (node.regex != null) {
        const flags = node.regex.flags || ''
        for (let i = 0; i < flags.length; i++) {
          const flag = flags[i]
          const version = REGEXP_FLAG_VERSIONS[flag]
          if (version != null && version > target) {
            reject(
              violations,
              node,
              `RegExp flag "${flag}" requires ${editionLabel(version)}`,
            )
          }
        }
      }
      break
    }
    case 'TemplateElement': {
      if (node.value != null && node.value.cooked == null && target < 9) {
        reject(
          violations,
          node,
          'Illegal escape in tagged templates requires ES2018',
        )
      }
      break
    }
    case 'SpreadElement':
    case 'RestElement': {
      if (
        parent != null &&
        (parent.type === 'ObjectExpression' || parent.type === 'ObjectPattern')
      ) {
        if (target < 9) {
          reject(
            violations,
            node,
            `Object ${
              node.type === 'SpreadElement' ? 'spread' : 'rest'
            } requires ES2018`,
          )
        }
      }
      break
    }
    case 'Property': {
      if (
        (node.shorthand ||
          node.method ||
          node.computed ||
          (node.kind != null && node.kind !== 'init')) &&
        target < 6
      ) {
        reject(
          violations,
          node,
          `Object property "${node.kind || 'init'}" requires ES2015`,
        )
      }
      break
    }
    case 'MethodDefinition': {
      if (target < 6) {
        reject(violations, node, 'Class methods require ES2015')
      }
      break
    }
    case 'VariableDeclaration': {
      if ((node.kind === 'let' || node.kind === 'const') && target < 6) {
        reject(violations, node, `"${node.kind}" declarations require ES2015`)
      }
      break
    }
    case 'ArrowFunctionExpression': {
      if (node.async && target < 8) {
        reject(violations, node, 'Async functions require ES2017')
      }
      break
    }
    case 'FunctionDeclaration':
    case 'FunctionExpression': {
      if (node.async && target < 8) {
        reject(violations, node, 'Async functions require ES2017')
      }
      if (node.generator && target < 6) {
        reject(violations, node, 'Generators require ES2015')
      }
      break
    }
    case 'ExportAllDeclaration': {
      if (node.exported != null && target < 11) {
        reject(violations, node, '"export * as ns" requires ES2020')
      }
      break
    }
    case 'AssignmentExpression':
    case 'BinaryExpression':
    case 'LogicalExpression': {
      const version = OPERATOR_VERSIONS[node.operator]
      if (version != null && version > target) {
        reject(
          violations,
          node,
          `Operator "${node.operator}" requires ${editionLabel(version)}`,
        )
      }
      break
    }
    default:
      break
  }
}

function pushScope(node, scope) {
  switch (node.type) {
    case 'FunctionDeclaration':
    case 'FunctionExpression':
      scope.push({
        kind: SCOPE_FUNCTION,
        async: !!node.async,
        generator: !!node.generator,
      })
      return true
    case 'ArrowFunctionExpression':
      scope.push({
        kind: SCOPE_FUNCTION,
        async: !!node.async,
        generator: false,
      })
      return true
    case 'ClassDeclaration':
    case 'ClassExpression':
      scope.push({ kind: SCOPE_CLASS })
      return true
    case 'MethodDefinition':
      scope.push({ kind: SCOPE_METHOD })
      return true
    case 'Property':
      if (node.method || (node.kind != null && node.kind !== 'init')) {
        scope.push({ kind: SCOPE_METHOD })
        return true
      }
      return false
    case 'StaticBlock':
      scope.push({ kind: SCOPE_STATIC_BLOCK })
      return true
    default:
      return false
  }
}

const NON_CHILD_KEYS = [
  'type',
  'loc',
  'start',
  'end',
  'range',
  'comments',
  'leadingComments',
  'trailingComments',
]

function walkChild(value, parent, ctx) {
  if (value == null) return
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      walkChild(value[i], parent, ctx)
    }
  } else if (isNode(value)) {
    walk(value, parent, ctx)
  }
}

function walk(node, parent, ctx) {
  if (!isNode(node)) return
  const { violations, scope, target } = ctx
  const pushed = pushScope(node, scope)
  // Node type version check
  const minVersion = NODE_VERSIONS[node.type]
  if (minVersion == null) {
    reject(
      violations,
      node,
      `Unknown node type "${node.type}" is not covered by the syntax profile`,
    )
  } else if (minVersion > target) {
    reject(
      violations,
      node,
      `Node type "${node.type}" requires ${editionLabel(minVersion)}`,
    )
  }
  checkNodeSyntax(node, parent, ctx)
  // Walk children
  const keys = NODE_CHILD_KEYS[node.type]
  if (keys != null) {
    for (let i = 0; i < keys.length; i++) {
      walkChild(node[keys[i]], node, ctx)
    }
  } else {
    // Unknown node: traverse all properties that look like nodes
    for (const key of Object.keys(node)) {
      if (NON_CHILD_KEYS.indexOf(key) !== -1) continue
      walkChild(node[key], node, ctx)
    }
  }
  if (pushed) scope.pop()
}

// Normalizes a `target` option into an ECMAScript edition number (5..16).
function getTargetEdition(options) {
  if (options == null) return null
  let target = options.target != null ? options.target : options.ecmaVersion
  if (target == null) return null
  if (typeof target !== 'number' || !Number.isFinite(target)) {
    throw new Error(`Invalid target: expected a number, got ${typeof target}`)
  }
  if (target >= 2009) {
    target = target - 2009
  }
  if (target < 5 || target > 16) {
    throw new Error(
      `Unsupported target: ${
        options.target != null ? options.target : options.ecmaVersion
      }. Supported editions are 5..16 (ES2009..ES2025).`,
    )
  }
  return target
}

// Returns the list of syntax profile violations for the provided AST node.
export function checkSyntaxProfile(node, options) {
  const target = getTargetEdition(options)
  const ctx = {
    target,
    sourceType:
      options != null && options.sourceType != null
        ? options.sourceType
        : 'script',
    violations: [],
    scope: [],
  }
  walk(node, null, ctx)
  return ctx.violations
}

// Error thrown when the AST does not satisfy the target syntax profile.
export class ProfileError extends Error {
  constructor(violations) {
    super(violations.map((violation) => violation.message).join('\n'))
    this.name = 'ProfileError'
    this.violations = violations
  }
}

// Verifies that the generated output parses with an independent parser at the
// target edition. The parser must expose an acorn-compatible `parse(code, options)`
// method. Does nothing if no parser is provided.
function verifyOutput(output, options) {
  const parser = options.parser
  if (parser == null || typeof parser.parse !== 'function') return
  const target = getTargetEdition(options)
  try {
    parser.parse(output, {
      ecmaVersion: target,
      sourceType: options.sourceType != null ? options.sourceType : 'script',
    })
  } catch (error) {
    throw new Error(
      `Generated output failed to parse as ${editionLabel(target)}: ${
        error.message
      }`,
    )
  }
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
  - `target`: target ECMAScript edition (5..16) or year (2009..2025). When set, the
    AST is checked against the corresponding syntax profile before any code is
    written: newer syntax, illegal contextual syntax (such as `await` outside an
    async function) and unknown node types are rejected (defaults to `null`)
  - `ecmaVersion`: alias for `target`
  - `sourceType`: source type of the target, `"script"` or `"module"` (defaults to `"script"`)
  - `parser`: independent parser used to verify the generated output parses at the
    target edition. Must expose an acorn-compatible `parse(code, options)` method
    (defaults to `null`)
  */
  const state = new State(options)
  const target = getTargetEdition(options)
  if (target != null) {
    // Check the whole AST against the profile before writing anything
    const violations = checkSyntaxProfile(node, options)
    if (violations.length > 0) {
      throw new ProfileError(violations)
    }
  }
  // Travel through the AST node and generate the code
  state.generator[node.type](node, state)
  const output = state.output
  if (target != null && options != null && options.output == null) {
    // Verify the generated output parses at the target edition
    verifyOutput(output, options)
  }
  return output
}
