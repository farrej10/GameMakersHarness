import * as ts from 'typescript/unstable/ast';
import { createVirtualFileSystem } from 'typescript/unstable/fs';
import { API } from 'typescript/unstable/sync';
import type { ErrorObject, ValidateFunction } from 'ajv';
import type { ArtOutput, GameSpec, LevelOutput } from '../contracts/index';
import {
  validateArtOutput,
  validateLevelOutput,
  validateLogicOutput,
} from '../contracts/index';

export type ValidationIssue = {
  code: string;
  instancePath: string;
  message: string;
  expected: string;
  actual: string;
};

type PositionedPoint = {
  label: string;
  instancePath: string;
  x: number;
  y: number;
};

const REQUIRED_ASSET_IDS = [
  'player',
  'collectible',
  'enemy',
  'exit',
] as const;
const ENUM_STRINGS = new Set([
  'chase',
  'horizontal-patrol',
  'collect-all',
  'collect-then-exit',
]);
const ALLOWED_MATH_CALLS = new Set([
  'Math.sqrt',
  'Math.hypot',
  'Math.abs',
  'Math.sign',
]);
const ALLOWED_BINARY_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
]);
const ALLOWED_PREFIX_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.ExclamationToken,
]);

const ENEMY_CONTEXT_PATHS = new Set([
  'context.behavior',
  'context.enemy',
  'context.enemy.x',
  'context.enemy.y',
  'context.enemy.vx',
  'context.enemy.vy',
  'context.player',
  'context.player.x',
  'context.player.y',
  'context.speed',
  'context.bounds',
  'context.bounds.minX',
  'context.bounds.maxX',
  'context.bounds.minY',
  'context.bounds.maxY',
]);
const VICTORY_CONTEXT_PATHS = new Set([
  'context.mode',
  'context.score',
  'context.target',
  'context.atExit',
]);

function stringifyActual(value: unknown): string {
  if (value === undefined) return 'undefined';
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json.slice(0, 500);
  } catch {
    return String(value).slice(0, 500);
  }
}

function issue(
  code: string,
  instancePath: string,
  message: string,
  expected: string,
  actual: unknown,
): ValidationIssue {
  return {
    code,
    instancePath,
    message,
    expected,
    actual: stringifyActual(actual),
  };
}

function valueAtJsonPointer(value: unknown, pointer: string): unknown {
  if (pointer === '') return value;
  let current = value;
  for (const encodedPart of pointer.slice(1).split('/')) {
    if (typeof current !== 'object' || current === null) return undefined;
    const part = encodedPart.replaceAll('~1', '/').replaceAll('~0', '~');
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function schemaIssues(
  validator: ValidateFunction,
  value: unknown,
): ValidationIssue[] {
  return (validator.errors ?? []).map((error: ErrorObject) =>
    issue(
      `SCHEMA_${error.keyword.toUpperCase()}`,
      error.instancePath,
      error.message ?? 'Schema validation failed.',
      `${error.keyword} at ${error.schemaPath}`,
      valueAtJsonPointer(value, error.instancePath),
    ),
  );
}

function distance(first: PositionedPoint, second: PositionedPoint): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

export function validateLevelArtifact(
  spec: GameSpec,
  value: unknown,
): ValidationIssue[] {
  if (!validateLevelOutput(value)) {
    return schemaIssues(validateLevelOutput, value);
  }

  const level: LevelOutput = value;
  const issues: ValidationIssue[] = [];

  if (level.seed !== spec.seed) {
    issues.push(
      issue(
        'LEVEL_SEED',
        '/seed',
        'Level seed must echo the approved specification seed.',
        String(spec.seed),
        level.seed,
      ),
    );
  }
  if (level.collectibles.length !== spec.collectibles.count) {
    issues.push(
      issue(
        'LEVEL_COLLECTIBLE_COUNT',
        '/collectibles',
        'Collectible count must match the approved specification.',
        String(spec.collectibles.count),
        level.collectibles.length,
      ),
    );
  }
  if (level.enemies.length !== spec.enemies.count) {
    issues.push(
      issue(
        'LEVEL_ENEMY_COUNT',
        '/enemies',
        'Enemy count must match the approved specification.',
        String(spec.enemies.count),
        level.enemies.length,
      ),
    );
  }

  level.collectibles.forEach((collectible, index) => {
    const expectedId = `c${index + 1}`;
    if (collectible.id !== expectedId) {
      issues.push(
        issue(
          'LEVEL_COLLECTIBLE_ID',
          `/collectibles/${index}/id`,
          'Collectible IDs must be consecutive and ordered.',
          expectedId,
          collectible.id,
        ),
      );
    }
  });
  level.enemies.forEach((enemy, index) => {
    const expectedId = `e${index + 1}`;
    if (enemy.id !== expectedId) {
      issues.push(
        issue(
          'LEVEL_ENEMY_ID',
          `/enemies/${index}/id`,
          'Enemy IDs must be consecutive and ordered.',
          expectedId,
          enemy.id,
        ),
      );
    }
  });

  const player: PositionedPoint = {
    label: 'playerSpawn',
    instancePath: '/playerSpawn',
    ...level.playerSpawn,
  };
  const exit: PositionedPoint = {
    label: 'exit',
    instancePath: '/exit',
    ...level.exit,
  };
  const collectibles: PositionedPoint[] = level.collectibles.map(
    (collectible, index) => ({
      label: collectible.id,
      instancePath: `/collectibles/${index}`,
      x: collectible.x,
      y: collectible.y,
    }),
  );
  const enemies: PositionedPoint[] = level.enemies.map((enemy, index) => ({
    label: enemy.id,
    instancePath: `/enemies/${index}`,
    x: enemy.x,
    y: enemy.y,
  }));
  const allPoints = [player, exit, ...collectibles, ...enemies];

  for (let firstIndex = 0; firstIndex < allPoints.length; firstIndex += 1) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < allPoints.length;
      secondIndex += 1
    ) {
      const first = allPoints[firstIndex]!;
      const second = allPoints[secondIndex]!;
      const actualDistance = distance(first, second);
      if (actualDistance < 48) {
        issues.push(
          issue(
            'LEVEL_PAIR_DISTANCE',
            second.instancePath,
            `${first.label} and ${second.label} are too close.`,
            'distance >= 48',
            actualDistance.toFixed(3),
          ),
        );
      }
    }
  }

  for (const enemy of enemies) {
    const actualDistance = distance(player, enemy);
    if (actualDistance < 180) {
      issues.push(
        issue(
          'LEVEL_ENEMY_SPAWN_DISTANCE',
          enemy.instancePath,
          `${enemy.label} is too close to the player spawn.`,
          'distance >= 180',
          actualDistance.toFixed(3),
        ),
      );
    }
  }

  const exitDistance = distance(player, exit);
  if (exitDistance < 160) {
    issues.push(
      issue(
        'LEVEL_EXIT_DISTANCE',
        '/exit',
        'Exit is too close to the player spawn.',
        'distance >= 160',
        exitDistance.toFixed(3),
      ),
    );
  }

  const occupiedQuadrants = new Set(
    level.collectibles.map(
      ({ x, y }) =>
        `${x < spec.arena.width / 2 ? 'left' : 'right'}-${
          y < spec.arena.height / 2 ? 'top' : 'bottom'
        }`,
    ),
  );
  if (occupiedQuadrants.size < 3) {
    issues.push(
      issue(
        'LEVEL_QUADRANTS',
        '/collectibles',
        'Collectibles must occupy at least three arena quadrants.',
        'at least 3 quadrants',
        occupiedQuadrants.size,
      ),
    );
  }

  return issues;
}

export function validateArtArtifact(value: unknown): ValidationIssue[] {
  if (!validateArtOutput(value)) {
    return schemaIssues(validateArtOutput, value);
  }

  const art: ArtOutput = value;
  const issues: ValidationIssue[] = [];
  for (const requiredId of REQUIRED_ASSET_IDS) {
    const count = art.sprites.filter(({ id }) => id === requiredId).length;
    if (count !== 1) {
      issues.push(
        issue(
          'ART_ASSET_IDS',
          '/sprites',
          `Art output must contain exactly one ${requiredId} sprite.`,
          '1',
          count,
        ),
      );
    }
  }

  art.sprites.forEach((sprite, index) => {
    const opaquePixels = sprite.rows.reduce(
      (count, row) => count + [...row].filter((pixel) => pixel !== '.').length,
      0,
    );
    if (opaquePixels < 16) {
      issues.push(
        issue(
          'ART_OPAQUE_PIXELS',
          `/sprites/${index}/rows`,
          `${sprite.id} sprite has too few visible pixels.`,
          'at least 16 opaque pixels',
          opaquePixels,
        ),
      );
    }
  });

  return issues;
}

function nodeText(node: ts.Node, sourceFile: ts.SourceFile): string {
  return node.getText(sourceFile).replaceAll(/\s+/gu, ' ').slice(0, 160);
}

function propertyPath(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (!ts.isPropertyAccessExpression(expression)) return null;
  const left = propertyPath(expression.expression);
  return left === null ? null : `${left}.${expression.name.text}`;
}

function validateImport(
  declaration: ts.ImportDeclaration,
  sourceFile: ts.SourceFile,
  issues: ValidationIssue[],
): void {
  const clause = declaration.importClause;
  const bindings = clause?.namedBindings;
  const names =
    bindings && ts.isNamedImports(bindings)
      ? bindings.elements.map((element) => ({
          imported: element.propertyName?.text ?? element.name.text,
          local: element.name.text,
        }))
      : [];
  const exactNames = ['EnemyContext', 'VictoryContext', 'Vec2'];
  const valid =
    ts.isStringLiteral(declaration.moduleSpecifier) &&
    declaration.moduleSpecifier.text === './rule-types' &&
    clause?.phaseModifier === ts.SyntaxKind.TypeKeyword &&
    clause.name === undefined &&
    declaration.attributes === undefined &&
    names.length === exactNames.length &&
    names.every(
      (name, index) =>
        name.imported === exactNames[index] && name.local === exactNames[index],
    );

  if (!valid) {
    issues.push(
      issue(
        'LOGIC_IMPORT',
        '/source',
        'Generated rules must use the exact type-only rule-types import.',
        "import type { EnemyContext, VictoryContext, Vec2 } from './rule-types';",
        nodeText(declaration, sourceFile),
      ),
    );
  }
}

function validateExpression(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  contextPaths: ReadonlySet<string>,
  locals: ReadonlySet<string>,
  issues: ValidationIssue[],
): void {
  if (
    ts.isNumericLiteral(expression) ||
    expression.kind === ts.SyntaxKind.TrueKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword
  ) {
    return;
  }

  if (ts.isStringLiteral(expression)) {
    if (!ENUM_STRINGS.has(expression.text)) {
      issues.push(
        issue(
          'LOGIC_STRING',
          '/source',
          'Only contract enum strings are allowed in generated logic.',
          [...ENUM_STRINGS].join(', '),
          expression.text,
        ),
      );
    }
    return;
  }

  if (ts.isIdentifier(expression)) {
    if (expression.text !== 'context' && !locals.has(expression.text)) {
      issues.push(
        issue(
          'LOGIC_GLOBAL',
          '/source',
          'Generated logic may reference only context and local constants.',
          'context or a declared const',
          expression.text,
        ),
      );
    }
    return;
  }

  if (ts.isPropertyAccessExpression(expression)) {
    const path = propertyPath(expression);
    if (
      expression.questionDotToken !== undefined ||
      path === null ||
      !contextPaths.has(path)
    ) {
      issues.push(
        issue(
          'LOGIC_PROPERTY',
          '/source',
          'Property access is limited to the declared context fields.',
          'an allowed context property',
          path ?? nodeText(expression, sourceFile),
        ),
      );
    }
    return;
  }

  if (ts.isCallExpression(expression)) {
    if (expression.expression.kind === ts.SyntaxKind.ImportKeyword) {
      issues.push(
        issue(
          'LOGIC_DYNAMIC_IMPORT',
          '/source',
          'Dynamic imports are not allowed in generated logic.',
          'no dynamic imports',
          nodeText(expression, sourceFile),
        ),
      );
    }
    const callee = propertyPath(expression.expression);
    if (
      expression.questionDotToken !== undefined ||
      callee === null ||
      !ALLOWED_MATH_CALLS.has(callee)
    ) {
      issues.push(
        issue(
          'LOGIC_CALL',
          '/source',
          'Only the approved Math functions may be called.',
          [...ALLOWED_MATH_CALLS].join(', '),
          callee ?? nodeText(expression.expression, sourceFile),
        ),
      );
    }
    if (expression.typeArguments?.length) {
      issues.push(
        issue(
          'LOGIC_TYPE_ARGUMENTS',
          '/source',
          'Function call type arguments are not allowed.',
          'no type arguments',
          nodeText(expression, sourceFile),
        ),
      );
    }
    for (const argument of expression.arguments) {
      if (ts.isSpreadElement(argument)) {
        issues.push(
          issue(
            'LOGIC_SPREAD',
            '/source',
            'Spread arguments are not allowed.',
            'ordinary argument',
            nodeText(argument, sourceFile),
          ),
        );
      } else {
        validateExpression(argument, sourceFile, contextPaths, locals, issues);
      }
    }
    return;
  }

  if (ts.isBinaryExpression(expression)) {
    if (!ALLOWED_BINARY_OPERATORS.has(expression.operatorToken.kind)) {
      issues.push(
        issue(
          'LOGIC_OPERATOR',
          '/source',
          'This binary operator is not allowed.',
          'arithmetic, strict comparison, or boolean operator',
          expression.operatorToken.getText(sourceFile),
        ),
      );
    }
    validateExpression(expression.left, sourceFile, contextPaths, locals, issues);
    validateExpression(expression.right, sourceFile, contextPaths, locals, issues);
    return;
  }

  if (ts.isPrefixUnaryExpression(expression)) {
    if (!ALLOWED_PREFIX_OPERATORS.has(expression.operator)) {
      issues.push(
        issue(
          'LOGIC_PREFIX_OPERATOR',
          '/source',
          'This prefix operator is not allowed.',
          '+, -, or !',
          ts.tokenToString(expression.operator) ?? expression.operator,
        ),
      );
    }
    validateExpression(expression.operand, sourceFile, contextPaths, locals, issues);
    return;
  }

  if (ts.isParenthesizedExpression(expression)) {
    validateExpression(expression.expression, sourceFile, contextPaths, locals, issues);
    return;
  }

  if (ts.isConditionalExpression(expression)) {
    validateExpression(expression.condition, sourceFile, contextPaths, locals, issues);
    validateExpression(expression.whenTrue, sourceFile, contextPaths, locals, issues);
    validateExpression(expression.whenFalse, sourceFile, contextPaths, locals, issues);
    return;
  }

  if (ts.isObjectLiteralExpression(expression)) {
    const seen = new Set<string>();
    for (const property of expression.properties) {
      if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) {
        issues.push(
          issue(
            'LOGIC_OBJECT_PROPERTY',
            '/source',
            'Returned objects may contain only explicit x and y properties.',
            'x: expression or y: expression',
            nodeText(property, sourceFile),
          ),
        );
        continue;
      }
      const name = property.name.text;
      if ((name !== 'x' && name !== 'y') || seen.has(name)) {
        issues.push(
          issue(
            'LOGIC_OBJECT_KEY',
            '/source',
            'Returned vector objects require unique x and y keys only.',
            'x and y',
            name,
          ),
        );
      }
      seen.add(name);
      validateExpression(
        property.initializer,
        sourceFile,
        contextPaths,
        locals,
        issues,
      );
    }
    if (!seen.has('x') || !seen.has('y')) {
      issues.push(
        issue(
          'LOGIC_VECTOR_SHAPE',
          '/source',
          'Returned vector objects require x and y.',
          'both x and y properties',
          [...seen],
        ),
      );
    }
    return;
  }

  issues.push(
    issue(
      'LOGIC_EXPRESSION_KIND',
      '/source',
      'This expression kind is not in the generated-logic allowlist.',
      'numeric/boolean expression, allowed property, Math call, conditional, or vector',
      ts.SyntaxKind[expression.kind],
    ),
  );
}

function validateStatement(
  statement: ts.Statement,
  sourceFile: ts.SourceFile,
  contextPaths: ReadonlySet<string>,
  locals: Set<string>,
  issues: ValidationIssue[],
): void {
  if (ts.isBlock(statement)) {
    for (const child of statement.statements) {
      validateStatement(child, sourceFile, contextPaths, locals, issues);
    }
    return;
  }

  if (ts.isReturnStatement(statement)) {
    if (!statement.expression) {
      issues.push(
        issue(
          'LOGIC_RETURN',
          '/source',
          'Every return requires a value.',
          'return expression',
          'return;',
        ),
      );
    } else {
      validateExpression(
        statement.expression,
        sourceFile,
        contextPaths,
        locals,
        issues,
      );
    }
    return;
  }

  if (ts.isIfStatement(statement)) {
    validateExpression(statement.expression, sourceFile, contextPaths, locals, issues);
    validateStatement(statement.thenStatement, sourceFile, contextPaths, new Set(locals), issues);
    if (statement.elseStatement) {
      validateStatement(statement.elseStatement, sourceFile, contextPaths, new Set(locals), issues);
    }
    return;
  }

  if (ts.isVariableStatement(statement)) {
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) {
      issues.push(
        issue(
          'LOGIC_VARIABLE_KIND',
          '/source',
          'Generated logic may declare immutable local constants only.',
          'const',
          nodeText(statement, sourceFile),
        ),
      );
    }
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
        issues.push(
          issue(
            'LOGIC_VARIABLE',
            '/source',
            'Local constants need a simple name and initializer.',
            'const name = expression',
            nodeText(declaration, sourceFile),
          ),
        );
        continue;
      }
      if (declaration.type || declaration.exclamationToken) {
        issues.push(
          issue(
            'LOGIC_LOCAL_TYPE',
            '/source',
            'Local constants must use inferred types.',
            'no local type assertion',
            nodeText(declaration, sourceFile),
          ),
        );
      }
      validateExpression(
        declaration.initializer,
        sourceFile,
        contextPaths,
        locals,
        issues,
      );
      if (declaration.name.text === 'context' || declaration.name.text === 'Math') {
        issues.push(
          issue(
            'LOGIC_LOCAL_NAME',
            '/source',
            'Local constants cannot shadow trusted names.',
            'a non-reserved identifier',
            declaration.name.text,
          ),
        );
      } else {
        locals.add(declaration.name.text);
      }
    }
    return;
  }

  issues.push(
    issue(
      'LOGIC_STATEMENT_KIND',
      '/source',
      'This statement kind is not in the generated-logic allowlist.',
      'const declaration, if statement, block, or return',
      ts.SyntaxKind[statement.kind],
    ),
  );
}

function isExactTypeReference(type: ts.TypeNode | undefined, name: string): boolean {
  return (
    type !== undefined &&
    ts.isTypeReferenceNode(type) &&
    ts.isIdentifier(type.typeName) &&
    type.typeName.text === name &&
    type.typeArguments === undefined
  );
}

function validateFunction(
  declaration: ts.FunctionDeclaration,
  sourceFile: ts.SourceFile,
  expectedName: 'getEnemyVelocity' | 'isVictory',
  issues: ValidationIssue[],
): void {
  const expectedParameterType =
    expectedName === 'getEnemyVelocity' ? 'EnemyContext' : 'VictoryContext';
  const modifiers = declaration.modifiers ?? [];
  const exactExport =
    modifiers.length === 1 && modifiers[0]?.kind === ts.SyntaxKind.ExportKeyword;
  const parameter = declaration.parameters[0];
  const exactParameter =
    declaration.parameters.length === 1 &&
    parameter !== undefined &&
    ts.isIdentifier(parameter.name) &&
    parameter.name.text === 'context' &&
    parameter.dotDotDotToken === undefined &&
    parameter.questionToken === undefined &&
    parameter.initializer === undefined &&
    isExactTypeReference(parameter.type, expectedParameterType);
  const exactReturn =
    expectedName === 'getEnemyVelocity'
      ? isExactTypeReference(declaration.type, 'Vec2')
      : declaration.type?.kind === ts.SyntaxKind.BooleanKeyword;
  const exactDeclaration =
    declaration.name?.text === expectedName &&
    exactExport &&
    exactParameter &&
    exactReturn &&
    declaration.asteriskToken === undefined &&
    declaration.typeParameters === undefined &&
    declaration.body !== undefined;

  if (!exactDeclaration) {
    issues.push(
      issue(
        'LOGIC_SIGNATURE',
        '/source',
        `${expectedName} must use the exact trusted signature.`,
        expectedName === 'getEnemyVelocity'
          ? 'export function getEnemyVelocity(context: EnemyContext): Vec2'
          : 'export function isVictory(context: VictoryContext): boolean',
        nodeText(declaration, sourceFile),
      ),
    );
  }

  if (declaration.body) {
    validateStatement(
      declaration.body,
      sourceFile,
      expectedName === 'getEnemyVelocity'
        ? ENEMY_CONTEXT_PATHS
        : VICTORY_CONTEXT_PATHS,
      new Set(),
      issues,
    );
  }
}

function validateParsedLogicSource(
  sourceFile: ts.SourceFile,
  syntaxDiagnostics: readonly { text: string; pos: number }[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const diagnostic of syntaxDiagnostics) {
    issues.push(
      issue(
        'LOGIC_SYNTAX',
        '/source',
        diagnostic.text,
        'valid TypeScript',
        diagnostic.pos,
      ),
    );
  }

  const imports = sourceFile.statements.filter(ts.isImportDeclaration);
  if (imports.length !== 1) {
    issues.push(
      issue(
        'LOGIC_IMPORT_COUNT',
        '/source',
        'Generated rules require exactly one type-only import.',
        '1',
        imports.length,
      ),
    );
  }
  for (const declaration of imports) {
    validateImport(declaration, sourceFile, issues);
  }

  const functions = sourceFile.statements.filter(ts.isFunctionDeclaration);
  const allowedTopLevel = new Set<ts.Statement>([...imports, ...functions]);
  for (const statement of sourceFile.statements) {
    if (!allowedTopLevel.has(statement)) {
      issues.push(
        issue(
          'LOGIC_TOP_LEVEL',
          '/source',
          'Only the exact type import and two function declarations are allowed at top level.',
          'type import or approved function',
          nodeText(statement, sourceFile),
        ),
      );
    }
  }

  for (const expectedName of ['getEnemyVelocity', 'isVictory'] as const) {
    const matching = functions.filter(
      (declaration) => declaration.name?.text === expectedName,
    );
    if (matching.length !== 1) {
      issues.push(
        issue(
          'LOGIC_EXPORT_COUNT',
          '/source',
          `Generated rules require exactly one ${expectedName} declaration.`,
          '1',
          matching.length,
        ),
      );
    }
    for (const declaration of matching) {
      validateFunction(declaration, sourceFile, expectedName, issues);
    }
  }

  for (const declaration of functions) {
    const name = declaration.name?.text;
    if (name !== 'getEnemyVelocity' && name !== 'isVictory') {
      issues.push(
        issue(
          'LOGIC_EXTRA_FUNCTION',
          '/source',
          'Additional functions are not allowed.',
          'getEnemyVelocity or isVictory',
          name ?? '<anonymous>',
        ),
      );
    }
  }

  return issues;
}

export function validateLogicSource(source: string): ValidationIssue[] {
  const root = 'C:/agentic-game-maker-validation';
  const configFile = `${root}/tsconfig.json`;
  const rulesFile = `${root}/rules.ts`;
  const fileSystem = createVirtualFileSystem({
    [configFile]: JSON.stringify({
      compilerOptions: {
        module: 'ESNext',
        target: 'ES2024',
      },
      files: ['rules.ts'],
    }),
    [rulesFile]: source,
  });
  const api = new API({ cwd: root, fs: fileSystem });
  let snapshot: ReturnType<API['updateSnapshot']> | undefined;

  try {
    snapshot = api.updateSnapshot({ openProjects: [configFile] });
    const project = snapshot.getProjects()[0];
    const sourceFile = project?.program.getSourceFile(rulesFile);
    if (!project || !sourceFile) {
      return [
        issue(
          'LOGIC_PARSE',
          '/source',
          'TypeScript could not create an AST for the generated rules.',
          'parseable TypeScript source',
          'no source file returned',
        ),
      ];
    }
    return validateParsedLogicSource(
      sourceFile,
      project.program.getSyntacticDiagnostics(rulesFile),
    );
  } catch (error) {
    return [
      issue(
        'LOGIC_PARSE',
        '/source',
        'TypeScript could not parse the generated rules.',
        'parseable TypeScript source',
        error instanceof Error ? error.message : error,
      ),
    ];
  } finally {
    snapshot?.dispose();
    api.close();
  }
}

export function validateLogicArtifact(value: unknown): ValidationIssue[] {
  if (!validateLogicOutput(value)) {
    return schemaIssues(validateLogicOutput, value);
  }
  return validateLogicSource(value.source);
}
