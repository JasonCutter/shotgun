/**
 * TS-6 C2-R15 ??INDEPENDENT production reachability resolver.
 *
 * PURPOSE
 *   Replace `callersFor()`, which matches a production caller by METHOD NAME
 *   ONLY. That match is the authority for `productionReachability.status`
 *   (`PROVEN` vs `TEST_ONLY_OR_DEAD`) and therefore for the TX_BOUNDARY /
 *   TEST_ONLY_OR_DEAD classification, so a method-name collision silently
 *   promotes an unreachable boundary to PROVEN.
 *
 * CONTRACT (deliberately independent of the validator's own index)
 *   A production call site `R.m(...)` reaches boundary method `m` of class `C`
 *   only when the receiver `R`'s statically declared type is `C` or a Port type
 *   that `C` implements. Method-name equality alone never qualifies.
 *
 * What it must see, and what the three discarded approximations could not:
 *   - file/symbol-qualified calls             (receiver type is the class)
 *   - Port-typed receivers                    (class implements the Port)
 *   - `this.x.m()` inside the class           (field/parameter declaration type)
 *   - lexical, arrow and nested callbacks     (calls belong to the enclosing body)
 *   - timer callbacks `setInterval(() => ...)`
 *   - object-property methods                 (`{ async m() {} }`)
 *   - aliases                                 (`const a = b`)
 *   - constructor injection                   (`constructor(private readonly p: Pool)`)
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export type ReachClass = {
  readonly name: string;
  readonly file: string;
  readonly implementsTypes: readonly string[];
  readonly extendsType: string | null;
};

export type ReachMethod = {
  readonly file: string;
  readonly className: string;
  /** Enclosing named method/function, or `<module>` for top-level declarations. */
  readonly owner: string;
  readonly name: string;
  readonly kind: 'class-method' | 'object-property' | 'function' | 'arrow-variable';
  readonly position: number;
  /**
   * Number of enclosing function-like scopes, outermost body = 0.
   *
   * A call nested inside another function is attributed to the enclosing body as
   * well as to the nested one, so a single call site can be seen from several
   * lexical contexts. Only the innermost of those carries the complete
   * declaration set, so the id is what decides which context OWNS the call when
   * the same site is reported more than once.
   */
  readonly depth: number;
  /** Receiver texts resolved in this body, and what they resolve to. */
  readonly calledReceivers: readonly {
    readonly receiver: string;
    readonly method: string;
    readonly line: number;
    readonly viaCallback: boolean;
  }[];
  /** Bare identifier calls in this body (test-local helper style). */
  readonly bareCalls: readonly string[];
  /** Local declarations in the whole body, including nested callbacks. */
  readonly declarations: readonly {
    readonly name: string;
    readonly typeText: string;
    readonly initText: string;
    readonly position: number;
  }[];
};

export type ReachIndex = {
  readonly classes: ReadonlyMap<string, ReachClass>;
  readonly methods: readonly ReachMethod[];
  /** owner name -> method */
  readonly byOwner: ReadonlyMap<string, readonly ReachMethod[]>;
  /** class name -> its field/parameter declarations (constructor injection included) */
  readonly classFields: ReadonlyMap<
    string,
    readonly { readonly name: string; readonly typeText: string }[]
  >;
  /** type alias -> names it composes (intersection aliases) */
  readonly typeAliasParts: ReadonlyMap<string, readonly string[]>;
  /**
   * type alias -> types it is a structural VIEW of.
   *
   * `Pick<X, 'a'>`, `Omit<X, 'a'>`, `X & {...}` and `X | Y` all denote a subset or
   * a superset of an existing type's members, so implementing `X` satisfies the
   * view as well. This is narrower than `typeAliasParts` on purpose: a name that
   * merely APPEARS inside an alias is not a view of that alias.
   */
  readonly typeViewParts: ReadonlyMap<string, readonly string[]>;
  /** file -> every variable/parameter declaration in it, with position */
  readonly moduleDeclarations: ReadonlyMap<
    string,
    readonly {
      readonly name: string;
      readonly typeText: string;
      readonly initText: string;
      readonly position: number;
    }[]
  >;
  readonly files: readonly string[];
};

export type ReachVerdict = {
  readonly boundaryId: string;
  readonly symbol: string;
  readonly method: string;
  readonly reachable: boolean;
  /** Qualified call sites that reach it. */
  readonly callers: readonly {
    readonly file: string;
    readonly line: number;
    readonly owner: string;
    readonly receiver: string;
    readonly receiverType: string;
    readonly via: string;
  }[]; /** Call sites sharing the method name but on an unrelated receiver type. */
  readonly nameOnlyCollisions: readonly {
    readonly file: string;
    readonly line: number;
    readonly receiver: string;
    readonly receiverType: string;
  }[];
};

const SCOPES = ['adapters', 'modules', 'packages', 'assemblies', 'apps'];
const SKIP = new Set(['node_modules', 'dist', 'coverage', '.git']);

/** Type-utility names: applied to a type argument, never a type themselves. */
const UTILITY_TYPES = new Set([
  'Pick',
  'Omit',
  'Readonly',
  'Partial',
  'Required',
  'Record',
  'Awaited',
  'ReturnType',
  'Parameters',
  'NonNullable',
  'Exclude',
  'Extract',
  'ReadonlyArray',
  'Array',
  'Promise',
  'Map',
  'Set',
]);

const posix = (v: string): string => v.split(path.sep).join('/');

const productionFiles = (root: string): string[] => {
  const out: string[] = [];
  const walk = (rel: string): void => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name)) walk(path.join(rel, entry.name));
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        out.push(posix(path.join(rel, entry.name)));
      }
    }
  };
  for (const scope of SCOPES) walk(scope);
  return out;
};

const heritageNames = (node: ts.ClassDeclaration | ts.ClassExpression): string[] => {
  const out: string[] = [];
  for (const clause of node.heritageClauses ?? []) {
    for (const type of clause.types) {
      const text = type.expression.getText();
      const tail = text.split('.').pop();
      if (tail) out.push(tail);
    }
  }
  return out;
};

/** Bare class name of a written type annotation, e.g. `readonly p: Pool` -> `Pool`. */
const bareTypeName = (typeText: string | undefined): string | null => {
  if (!typeText) return null;
  const cleaned = typeText.replace(/[!?]+$/g, ' ').trim();
  // A single generic reference names the type it is a view of:
  //   `Pick<SemanticCorpusSourceSnapshotReaderPort, 'readSnapshot'>`
  // is a view of `SemanticCorpusSourceSnapshotReaderPort`, which is the Port the
  // boundary implements. Treating the whole text as opaque is what made a
  // narrowed dependency look like a method-name collision.
  const generic = /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*<([\s\S]*)>\s*$/.exec(cleaned);
  if (generic?.[1] && generic[2]) {
    const name = bareTypeName(generic[2].split(',')[0]);
    if (name) return name;
    return generic[1];
  }
  // Strip non-null/optional assertions and a trailing initialiser before matching.
  const stripped = cleaned
    .replace(/[!?]+$/g, ' ')
    .replace(/\[\]$/, '')
    .trim();
  const m =
    /(?:^|[.\s|&])([A-Z][\w$]*)\s*$/.exec(stripped) ?? /^([A-Za-z_$][\w$]*)$/.exec(stripped);
  return m && m[1] !== undefined ? m[1] : null;
};

/**
 * Type names an annotation may denote, in preference order.
 *
 * A written type is not always one name. `SourcesWriteRuntime | undefined` is
 * the declared return type of the process-global accessor that hands the
 * Sources write runtime to every route, and an accessor's callee is exactly the
 * shape `bareTypeName` cannot reduce: its last alternative is `undefined`.
 * Taking the union apart keeps the real name. Intersections are split for the
 * same reason. Generic arguments are dropped — `Pick<A, 'b'>` contributes `A`,
 * and the alias's own name is contributed too so a boundary that implements it
 * is still matched through the alias/Port equivalence rule.
 */
const bareNames = (typeText: string | undefined): string[] => {
  const single = bareTypeName(typeText);
  if (!typeText) return [];
  // Only annotations that actually compose types need splitting; a plain
  // `Pool` must keep resolving through the original single-name rule.
  if (!/[|&]/.test(typeText)) return single ? [single] : [];
  const out: string[] = [];
  const PRIMITIVES = new Set([
    'undefined',
    'null',
    'void',
    'never',
    'any',
    'unknown',
    'object',
    'this',
    'true',
    'false',
  ]);
  for (const raw of typeText.split(/[|&]/)) {
    // `Pick<A, 'b'>` / `Omit<A, 'b'>` is a VIEW of `A`: the alias name is kept
    // for alias equivalence, and `A` is contributed because a class implementing
    // the view implements `A` — this is what makes a narrowed Port resolve.
    const aliased = /^\s*([A-Za-z_$][\w$]*)\s*<([^<>]*)>/.exec(raw);
    if (aliased) {
      const arg = bareTypeName(aliased[2]);
      if (arg && !PRIMITIVES.has(arg)) out.push(arg);
      if (aliased[1]) out.push(aliased[1]);
      continue;
    }
    const name = /([A-Za-z_$][\w$]*)\s*$/.exec(raw.replace(/[()[\]{}]/g, ' ').trim());
    if (name?.[1] && !PRIMITIVES.has(name[1])) out.push(name[1]);
  }
  return [...new Set(out)];
};

/**
 * The declared type names of the value an expression evaluates to.
 *
 * Production wiring reaches a concrete instance through a helper far more often
 * than through a constructor written at the call site:
 *   const runtime = getSourcesWriteRuntime();
 *   await runtime.productService.submit(...)
 * `getSourcesWriteRuntime` is declared `(): SourcesWriteRuntime | undefined`, so
 * the receiver chain is resolvable only if the ACCESSOR's declared return type is
 * followed. Without this the whole composition root looks like it uses
 * method-name collisions, because the receivers of `submit`, `resolveDuplicate`
 * and `retry` stay unresolved.
 *
 * The return type of such a helper is written on the ARROW SIGNATURE, which the
 * declaration index carries in `initText` (`(): SourcesWriteRuntime | undefined
 * => activeRuntime`), not in `typeText`. Reading only `typeText` finds nothing.
 */
const returnTypeNamesOfDeclaration = (d: {
  readonly typeText: string;
  readonly initText: string;
}): readonly string[] => {
  const direct = bareNames(d.typeText);
  if (direct.length > 0) return direct;
  const text = d.initText;
  const arrow = /^\s*(?:async\s+)?\([^()]*\)\s*:\s*([^=]+?)\s*=>/s.exec(text);
  const fn = /^\s*(?:async\s+)?function\b[^(]*\([^()]*\)\s*:\s*([^{]+?)\s*\{/s.exec(text);
  return bareNames(arrow?.[1] ?? fn?.[1]);
};

const accessorReturnNames = (
  index: ReachIndex,
  file: string,
  expression: string,
): readonly string[] => {
  const expr = expression.replace(/[!?]+/g, '').trim();
  const named: string[] = [];
  const constructed = /new\s+([A-Za-z_$][\w$]*)/.exec(expr);
  if (constructed?.[1]) named.push(constructed[1]);
  const call = /^(?:this\.)?([A-Za-z_$][\w$]*)\s*\(/.exec(expr);
  if (call?.[1]) {
    const heads = [call[1], expr.replace(/\(.*$/s, '').split('.').pop() ?? ''];
    for (const name of heads) {
      if (!name) continue;
      // Same file first (a module-private accessor is the common shape), then any
      // file, so an imported runtime getter still resolves.
      const batches: readonly (readonly {
        readonly name: string;
        readonly typeText: string;
        readonly initText: string;
      }[])[] = [
        index.moduleDeclarations.get(file) ?? [],
        ...[...index.moduleDeclarations.values()],
      ];
      for (const declarations of batches) {
        for (const d of declarations) {
          if (d.name !== name) continue;
          for (const t of returnTypeNamesOfDeclaration(d)) named.push(t);
        }
      }
      if (named.length > 0) break;
    }
  }
  return [...new Set(named)];
};

/**
 * Every identifier bound by a binding name, including object/array destructuring.
 * Production code overwhelmingly types its dependencies this way:
 *   async (input: { repository: AIProviderCallRepositoryPort, ... }) => ...
 *   const { repository } = input;
 * Missing these is what made earlier attempts report false negatives.
 */
const boundNames = (name: ts.BindingName): string[] => {
  if (ts.isIdentifier(name)) return [name.text];
  const out: string[] = [];
  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) continue;
    out.push(...boundNames(element.name));
  }
  return out;
};

export const buildReachIndex = (root: string): ReachIndex => {
  const classes = new Map<string, ReachClass>();
  const methods: ReachMethod[] = [];
  const classFields = new Map<string, { name: string; typeText: string }[]>();
  const typeAliasParts = new Map<string, string[]>();
  const typeViewParts = new Map<string, string[]>();
  const moduleDeclarations = new Map<
    string,
    { name: string; typeText: string; initText: string; position: number }[]
  >();
  const files = productionFiles(root);

  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    const enclosingClassName = (node: ts.Node): string => {
      let cur: ts.Node | undefined = node.parent;
      while (cur) {
        if (ts.isClassDeclaration(cur) || ts.isClassExpression(cur))
          return cur.name?.text ?? '<anonymous-class>';
        cur = cur.parent;
      }
      return '<module>';
    };
    const enclosingFunctionName = (node: ts.Node): string => {
      let cur: ts.Node | undefined = node.parent;
      while (cur) {
        if (ts.isMethodDeclaration(cur) && cur.name && ts.isIdentifier(cur.name))
          return cur.name.text;
        if (ts.isFunctionDeclaration(cur) && cur.name) return cur.name.text;
        if (
          (ts.isArrowFunction(cur) || ts.isFunctionExpression(cur)) &&
          cur.parent &&
          ts.isVariableDeclaration(cur.parent) &&
          ts.isIdentifier(cur.parent.name)
        )
          return cur.parent.name.text;
        cur = cur.parent;
      }
      return '<module>';
    };

    /**
     * How many function-like scopes enclose `node`.
     *
     * Used to pick the INNERMOST context for a call site that the walk reports
     * from several enclosing bodies: only the innermost context holds the full
     * declaration set, and an outer context that cannot see a local correctly
     * reports "unresolved" rather than a type.
     */
    const functionDepth = (node: ts.Node): number => {
      let depth = 0;
      let cur: ts.Node | undefined = node.parent;
      while (cur) {
        if (
          ts.isArrowFunction(cur) ||
          ts.isFunctionExpression(cur) ||
          ts.isFunctionDeclaration(cur) ||
          ts.isMethodDeclaration(cur) ||
          ts.isConstructorDeclaration(cur) ||
          ts.isGetAccessorDeclaration(cur) ||
          ts.isSetAccessorDeclaration(cur)
        )
          depth += 1;
        cur = cur.parent;
      }
      return depth;
    };

    const visit = (node: ts.Node): void => {
      // classes and their implemented types
      if ((ts.isClassDeclaration(node) || ts.isClassExpression(node)) && node.name) {
        const heritage = heritageNames(node);
        const extendsType = node.heritageClauses?.find(
          (c) => c.token === ts.SyntaxKind.ExtendsKeyword,
        )
          ? (heritage[0] ?? null)
          : null;
        classes.set(node.name.text, {
          name: node.name.text,
          file,
          implementsTypes: heritage.filter((h) => h !== extendsType),
          extendsType,
        });
        // Fields AND constructor parameter properties: `constructor(private
        // readonly p: Pool)` is how most production receivers are injected.
        // Scan ALL members for a name, not just the first match: a class can
        // declare the same name as both a constructor parameter (typed as a Port)
        // and a field (assigned the concrete class).
        const fields = classFields.get(node.name.text) ?? [];
        for (const member of node.members) {
          if (ts.isPropertyDeclaration(member) && ts.isIdentifier(member.name)) {
            fields.push({
              name: member.name.text,
              typeText:
                `${member.type ? member.type.getText(sf) : ''} ${member.initializer ? member.initializer.getText(sf) : ''}`.trim(),
            });
          }
          if (ts.isConstructorDeclaration(member)) {
            for (const p of member.parameters) {
              if (!ts.isIdentifier(p.name)) continue;
              // A parameter property is typed as the Port; `this.x = <expr>` in
              // the body (scanned below) carries the concrete class.
              fields.push({ name: p.name.text, typeText: p.type ? p.type.getText(sf) : '' });
              if (p.initializer)
                fields.push({ name: p.name.text, typeText: p.initializer.getText(sf) });
            }
          }
          if (ts.isPropertyAssignment(member) && ts.isIdentifier(member.name)) {
            fields.push({ name: member.name.text, typeText: member.initializer.getText(sf) });
          }
        }
        // `this.x = <expr>` inside the constructor names the concrete class
        for (const member of node.members) {
          if (!ts.isConstructorDeclaration(member) || !member.body) continue;
          const scan = (n: ts.Node): void => {
            if (
              ts.isBinaryExpression(n) &&
              n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
              ts.isPropertyAccessExpression(n.left) &&
              n.left.expression.kind === ts.SyntaxKind.ThisKeyword &&
              ts.isIdentifier(n.left.name)
            ) {
              fields.push({ name: n.left.name.text, typeText: n.right.getText(sf) });
            }
            ts.forEachChild(n, scan);
          };
          scan(member.body);
        }
        classFields.set(node.name.text, fields);
      }

      // Module-scope and function-scope declarations, regardless of nesting:
      // composition sites declare the concrete class at module scope.
      if (ts.isVariableDeclaration(node)) {
        const typeText = node.type ? node.type.getText(sf) : '';
        const initText = node.initializer ? node.initializer.getText(sf) : '';
        const list = moduleDeclarations.get(file) ?? [];
        for (const bound of boundNames(node.name))
          list.push({ name: bound, typeText, initText, position: node.getStart(sf) });
        moduleDeclarations.set(file, list);
      }
      if (ts.isParameter(node)) {
        const typeText = node.type ? node.type.getText(sf) : '';
        const list = moduleDeclarations.get(file) ?? [];
        for (const bound of boundNames(node.name))
          list.push({ name: bound, typeText, initText: '', position: node.getStart(sf) });
        moduleDeclarations.set(file, list);
      }

      // Interface and type-literal shapes are how dependencies are declared:
      //   type ConnectorRuntimeStatePort = { readonly ordering: OrderingStorePort }
      //   constructor(private readonly deps: SharedSourcesStage3PipelineDependencies)
      // Without these, `this.deps.transformationRepository` and `state.ordering`
      // are unresolvable and their boundaries look dead when they are not.
      const recordShape = (name: string, members: readonly ts.TypeElement[]): void => {
        const shape = classFields.get(name) ?? [];
        for (const member of members) {
          if (
            (ts.isPropertySignature(member) || ts.isMethodSignature(member)) &&
            member.name &&
            ts.isIdentifier(member.name) &&
            member.type
          ) {
            shape.push({ name: member.name.text, typeText: member.type.getText(sf) });
          }
        }
        classFields.set(name, shape);
      };
      if (ts.isInterfaceDeclaration(node)) recordShape(node.name.text, node.members);
      if (ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type))
        recordShape(node.name.text, node.type.members);
      // A type alias that composes named types is not an opaque type: production
      // dependencies are routinely declared as
      //   type SemanticGenerationRepository =
      //     SemanticIndexRepositoryPort & SemanticGenerationLifecycleRepositoryPort
      //   type DiscoveryFeedbackWriteRepositoryPort =
      //     Pick<DiscoveryFeedbackRepositoryPort, 'appendFeedback' | 'appendSuppression'>
      // A receiver of that alias IS a boundary implementing those constituents, so
      // the alias must be traversable exactly like a direct heritage clause. A
      // type-literal alias is not opaque either: its ObjectType members are the
      // names it references.
      if (
        ts.isTypeAliasDeclaration(node) &&
        (ts.isIntersectionTypeNode(node.type) ||
          ts.isTypeLiteralNode(node.type) ||
          ts.isUnionTypeNode(node.type))
      ) {
        const list = typeAliasParts.get(node.name.text) ?? [];
        /**
         * Types this alias is a structural VIEW of.
         *
         * A view exists when a named type is combined with a narrowing type
         * literal, or a utility is applied to it:
         *   `RepositoryPort = ReaderPort & {...}`   -> a view of ReaderPort
         *   `WritePort = Pick<RepositoryPort, 'a'>` -> a view of RepositoryPort
         * The relation is used only in the reverse direction, to let a class that
         * implements a broad Port also satisfy the narrower aliases derived from
         * it — it is NOT closed transitively, because two sibling views of one
         * Port (`RepositoryPort` and `WriterPort`, both `ReaderPort & {...}`) are
         * unrelated to each other.
         */
        const views = new Set<string>();
        const noteView = (t: ts.TypeNode): void => {
          if (ts.isUnionTypeNode(t) || ts.isIntersectionTypeNode(t)) {
            for (const part of t.types) noteView(part);
            return;
          }
          const argumentsOf = ts.isTypeReferenceNode(t) ? (t.typeArguments ?? []) : [];
          const isUtility = ts.isTypeReferenceNode(t) && UTILITY_TYPES.has(t.typeName.getText(sf));
          const narrowsByLiteral = argumentsOf.some((a) => ts.isTypeLiteralNode(a));
          if (!isUtility && !narrowsByLiteral) return;
          const add = (inner: ts.TypeNode | undefined): void => {
            if (!inner || !ts.isTypeReferenceNode(inner)) return;
            const head = inner.typeName.getText(sf).split('.').pop();
            if (head && !UTILITY_TYPES.has(head)) views.add(head);
          };
          add(ts.isTypeReferenceNode(t) ? t : undefined);
          for (const a of argumentsOf) add(a);
        };
        noteView(node.type);
        noteView(node.type);
        typeViewParts.set(node.name.text, [...views]);

        // Every type reference inside the alias is a constituent, at any depth,
        // EXCEPT references inside a nested type literal's property types —
        // `ReturnType<Port['saveRevision']>` mentions `Port` but a member-level
        // mention is not a composition.
        const walk = (n: ts.Node, memberLevel: boolean): void => {
          if (ts.isTypeReferenceNode(n)) {
            const argumentsOf = n.typeArguments ?? [];
            const isUtility = UTILITY_TYPES.has(n.typeName.getText(sf));
            // `Pick<Port, 'a' | 'b'>` names `Port`, whose members the view is made
            // of. Only the FIRST argument: the second is a key union, not a type.
            const targets = isUtility ? argumentsOf.slice(0, 1) : argumentsOf;
            if (!isUtility) {
              const head = n.typeName.getText(sf).split('.').pop();
              if (head && !memberLevel) list.push(head);
            }
            for (const a of targets) {
              if (ts.isTypeReferenceNode(a)) {
                const head = a.typeName.getText(sf).split('.').pop();
                if (head && !UTILITY_TYPES.has(head)) list.push(head);
              }
              for (const name of bareNames(a.getText(sf)))
                if (/^[A-Z]/.test(name) && !UTILITY_TYPES.has(name) && !memberLevel)
                  list.push(name);
            }
            for (const a of targets) walk(a, memberLevel);
            return;
          }
          ts.forEachChild(n, (child) => walk(child, memberLevel || ts.isTypeLiteralNode(child)));
        };
        walk(node.type, ts.isTypeLiteralNode(node.type));
        typeAliasParts.set(node.name.text, [...new Set(list)]);
      }

      const isClassMethod =
        ts.isMethodDeclaration(node) && node.name !== undefined && ts.isIdentifier(node.name);
      const isObjectPropertyMethod =
        ts.isPropertyAssignment(node) &&
        ts.isIdentifier(node.name) &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer));
      const isFunctionDecl = ts.isFunctionDeclaration(node) && node.name !== undefined;
      const isFunctionVariable =
        (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
        node.parent !== undefined &&
        ts.isVariableDeclaration(node.parent) &&
        ts.isIdentifier(node.parent.name);

      // Constructor bodies are indexed as `__constructor` so that invocations
      // registered there — `setInterval(() => { void this.recoverExpiredLeases() })`
      // — are visible. Without this a boundary launched from its own constructor
      // looks like it has no caller at all.
      const isConstructor = ts.isConstructorDeclaration(node);

      if (
        isClassMethod ||
        isObjectPropertyMethod ||
        isFunctionDecl ||
        isFunctionVariable ||
        isConstructor
      ) {
        const name = isConstructor
          ? '__constructor'
          : isClassMethod
            ? (node.name as ts.Identifier).text
            : isObjectPropertyMethod
              ? (node.name as ts.Identifier).text
              : isFunctionDecl
                ? (node.name as ts.Identifier).text
                : ((node.parent as ts.VariableDeclaration).name as ts.Identifier).text;
        const kind: ReachMethod['kind'] = isClassMethod
          ? 'class-method'
          : isObjectPropertyMethod
            ? 'object-property'
            : isFunctionDecl
              ? 'function'
              : isConstructor
                ? 'class-method'
                : 'arrow-variable';
        // The body is on the node for a method/function, but for an object-literal
        // method (`{ async start() { ... } }`) it lives on the INITIALIZER. Missing
        // this indexed every object-property body as empty, which hid
        // `PostgresConnectorRuntimeState.lifecycle.start` and any timer, queue or
        // event-handler registration declared that way.
        const bodyNode = isObjectPropertyMethod
          ? (node.initializer as unknown as { body?: ts.Node }).body
          : (node as unknown as { body?: ts.Node }).body;
        const className =
          isClassMethod || isObjectPropertyMethod || isConstructor
            ? enclosingClassName(node)
            : '<module>';
        const owner = isClassMethod || isConstructor ? name : enclosingFunctionName(node);
        const calledReceivers: {
          receiver: string;
          method: string;
          line: number;
          viaCallback: boolean;
        }[] = [];
        const bareCalls: string[] = [];
        const declarations: {
          name: string;
          typeText: string;
          initText: string;
          position: number;
        }[] = [];

        /**
         * The syntactic node that holds this owner's PARAMETER LIST.
         *
         * A function's parameters are children of the function node, not of its
         * body Block: a walk started at the body never visits them. Production
         * dependencies arrive as parameters far more often than as locals —
         * `registerAISettingsRoutes(server, ..., semanticCorpusSourceSnapshotReader?:
         * Pick<SemanticCorpusSourceSnapshotReaderPort, ...>)` — so a body-only
         * walk leaves every injected dependency unresolvable.
         */
        const parameterOwner = (): ts.Node => (isObjectPropertyMethod ? node.initializer : node);

        const addDeclaration = (n: ts.Node): void => {
          if (ts.isParameter(n) && ts.isObjectBindingPattern(n.name)) {
            const typeNode = n.type;
            const memberType = (bound: string): string => {
              if (!typeNode || !ts.isTypeLiteralNode(typeNode)) return '';
              for (const member of typeNode.members) {
                if (
                  ts.isPropertySignature(member) &&
                  member.name &&
                  ts.isIdentifier(member.name) &&
                  member.name.text === bound &&
                  member.type
                )
                  return member.type.getText(sf);
              }
              return '';
            };
            for (const element of n.name.elements) {
              if (ts.isOmittedExpression(element)) continue;
              for (const bound of boundNames(element.name)) {
                const fromProperty = memberType(bound);
                declarations.push({
                  name: bound,
                  typeText: fromProperty || (n.type ? n.type.getText(sf) : ''),
                  initText: '',
                  position: n.getStart(sf),
                });
              }
            }
          } else if (ts.isParameter(n)) {
            const typeText = n.type ? n.type.getText(sf) : '';
            for (const bound of boundNames(n.name))
              declarations.push({ name: bound, typeText, initText: '', position: n.getStart(sf) });
          } else if (ts.isVariableDeclaration(n)) {
            const typeText = n.type ? n.type.getText(sf) : '';
            const initText = n.initializer ? n.initializer.getText(sf) : '';
            for (const bound of boundNames(n.name))
              declarations.push({ name: bound, typeText, initText, position: n.getStart(sf) });
          }
        };

        /**
         * Is the code at `from` reachable only through a NON-production gate?
         *
         * The doctrine asks whether a SUPPORTED PRODUCTION execution path exists.
         * A call written under `if (testDevelopmentAuth)` answers no, however the
         * receiver type happens to resolve: the guard is not an obstacle to
         * analysis, it is the analysis. Both forms are recognised —
         *   `process.env.VITEST === 'true' && !production` written inline, and
         *   `const testDevelopmentAuth = process.env.VITEST === 'true' && ...`
         *   used as the condition — because production code styles the flag either
         *   way, and a test-runner / non-production gate excludes production
         *   execution in both.
         */
        const isTestGuarded = (from: ts.Node, scopeNode: ts.Node): boolean => {
          const testCondition = /\bVITEST\b|NODE_ENV\s*[!=]==?\s*['"]test['"]/;
          // Flag names assigned a test-only expression inside this scope, e.g.
          // `const testDevelopmentAuth = process.env.VITEST === 'true' && !production`.
          // Nested function-likes are skipped: their locals are not this scope's.
          const testOnlyVariables = new Set<string>();
          const collectFlags = (node: ts.Node): void => {
            if (
              (ts.isArrowFunction(node) ||
                ts.isFunctionExpression(node) ||
                ts.isFunctionDeclaration(node) ||
                ts.isMethodDeclaration(node) ||
                ts.isConstructorDeclaration(node)) &&
              node !== scopeNode
            )
              return;
            if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
              if (testCondition.test(node.initializer.getText(sf)))
                testOnlyVariables.add(node.name.text);
            }
            ts.forEachChild(node, collectFlags);
          };
          collectFlags(scopeNode);

          const conditionIsTestOnly = (condition: ts.Expression): boolean => {
            const text = condition.getText(sf);
            if (testCondition.test(text)) return true;
            for (const name of testOnlyVariables)
              if (new RegExp(`\\b${name}\\b`).test(text)) return true;
            return false;
          };

          // A call is test-only when it sits in the THEN branch of such an `if`.
          let node: ts.Node | undefined = from.parent;
          while (node && node !== scopeNode) {
            if (ts.isIfStatement(node) && conditionIsTestOnly(node.expression)) {
              let probe: ts.Node | undefined = from;
              while (probe && probe !== node) {
                if (probe === node.thenStatement) return true;
                probe = probe.parent;
              }
            }
            node = node.parent;
          }
          return false;
        };

        /**
         * Collect calls and declarations under `n`.
         *
         * `scopeNode` is the function-like node that ENCLOSES the code being
         * walked: `viaCallback` means "this call is not written directly in the
         * owner's own statement list", which is how a registered callback is told
         * apart from a bare self-call. Nested function-likes are walked as their
         * own scope so a nested callback's parameters are visible to the calls it
         * contains, instead of being attributed to the outer owner.
         */
        const walkBody = (n: ts.Node, scopeNode: ts.Node): void => {
          if (ts.isCallExpression(n)) {
            const e = n.expression;
            if (ts.isPropertyAccessExpression(e)) {
              let cursor: ts.Node | undefined = n.parent;
              let wrapped = false;
              while (cursor && cursor !== scopeNode) {
                if (ts.isArrowFunction(cursor) || ts.isFunctionExpression(cursor)) {
                  wrapped = true;
                  break;
                }
                cursor = cursor.parent;
              }
              // A call behind a non-production gate is TEST evidence, not a
              // production execution path.
              if (!isTestGuarded(n, scopeNode))
                calledReceivers.push({
                  receiver: e.expression.getText(sf),
                  method: e.name.text,
                  line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
                  viaCallback: wrapped,
                });
            } else if (ts.isIdentifier(e)) {
              bareCalls.push(e.text);
            }
          }
          addDeclaration(n);
          ts.forEachChild(n, (child) => {
            if (
              (ts.isArrowFunction(child) ||
                ts.isFunctionExpression(child) ||
                ts.isFunctionDeclaration(child) ||
                ts.isMethodDeclaration(child) ||
                ts.isConstructorDeclaration(child)) &&
              (child as unknown as { body?: ts.Node }).body
            ) {
              walkScope(child);
              return;
            }
            walkBody(child, scopeNode);
          });
        };

        const walkScope = (fn: ts.Node): void => {
          for (const p of (fn as unknown as { parameters?: readonly ts.Node[] }).parameters ?? [])
            addDeclaration(p);
          const body = (fn as unknown as { body?: ts.Node }).body;
          if (body) walkBody(body, fn);
        };
        if (bodyNode) walkScope(parameterOwner());

        methods.push({
          file,
          className,
          owner,
          name,
          kind,
          position: node.getStart(sf),
          depth: functionDepth(node),
          calledReceivers,
          bareCalls,
          declarations,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  const byOwner = new Map<string, ReachMethod[]>();
  for (const m of methods) {
    const list = byOwner.get(m.owner) ?? [];
    list.push(m);
    byOwner.set(m.owner, list);
  }
  return {
    classes,
    methods,
    byOwner,
    classFields,
    typeAliasParts,
    typeViewParts,
    moduleDeclarations,
    files,
  };
};

/**
 * Production classes that implement each Port type, keyed by Port name.
 *
 * TRANSITIVE on purpose: `type ActionExecutionRepositoryPort =
 * ActionFeedbackOutboxRepositoryPort & {...}` means a class implementing the
 * composite implements every constituent Port too, and `LazyCacheRepositoryPort =
 * Pick<Base, 'get' | 'set'>` means the same for a Pick. Registering only the
 * literal heritage names would miss both, and a constituent Port would then look
 * like it has no production implementation at all.
 *
 * Test doubles are excluded: a `*-in-memory` adapter is only wired in tests, so
 * counting it would turn a single-implementation Port into an ambiguous one.
 */
export const buildImplementationIndex = (
  index: ReachIndex,
): ReadonlyMap<string, ReadonlySet<string>> => {
  const cached = implementationIndexCache.get(index);
  if (cached) return cached;
  const impls = computeImplementationIndex(index);
  implementationIndexCache.set(index, impls);
  return impls;
};

/**
 * The implementation index is derived from the whole index but read per boundary,
 * so it is computed at most once per index.
 */
const implementationIndexCache = new WeakMap<
  ReachIndex,
  ReadonlyMap<string, ReadonlySet<string>>
>();

const computeImplementationIndex = (
  index: ReachIndex,
): ReadonlyMap<string, ReadonlySet<string>> => {
  const isTestDouble = (cls: ReachClass): boolean =>
    /-in-memory\//.test(cls.file) || /InMemory/.test(cls.name);

  const impls = new Map<string, Set<string>>();
  for (const cls of index.classes.values()) {
    if (isTestDouble(cls)) continue;
    for (const t of [cls.extendsType, ...cls.implementsTypes]) {
      if (!t) continue;
      for (const port of typeConstituents(index, t)) {
        const set = impls.get(port) ?? new Set<string>();
        set.add(cls.name);
        impls.set(port, set);
      }
    }
  }
  return impls;
};

/**
 * Port names a `Pick<Port, ...>` / `Omit<Port, ...>` view is derived from.
 *
 * Precomputed on the index as `typeViewParts[alias] = [...ports the alias views]`,
 * with {@link reverseViewParts} holding the reverse edges.
 *
 * `DiscoveryFeedbackWriteRepositoryPort = Pick<DiscoveryFeedbackRepositoryPort,
 * 'appendFeedback' | 'appendSuppression'> & Pick<..., 'appendEpistemicReentryTrigger'>`
 * NARROWS the repository Port: every member of the view is a member of the
 * repository. A class implementing the repository therefore implements the view —
 * it already has all of its members — and a receiver typed as the view is a
 * receiver of that class.
 *
 * This relation is NOT transitive in general (`X = Reader & {...}` and
 * `Y = Reader & {...}` are both narrower than `Reader` but unrelated to each
 * other), so it is applied for exactly one hop and never closed.
 */
const reverseViewParts = (index: ReachIndex): ReadonlyMap<string, readonly string[]> => {
  const cached = reverseViewCache.get(index);
  if (cached) return cached;
  const reverse = new Map<string, string[]>();
  for (const [alias, parts] of index.typeViewParts)
    for (const part of parts) {
      if (part === alias) continue;
      const list = reverse.get(part) ?? [];
      list.push(alias);
      reverse.set(part, list);
    }
  reverseViewCache.set(index, reverse);
  return reverse;
};

const reverseViewCache = new WeakMap<ReachIndex, ReadonlyMap<string, readonly string[]>>();

/**
 * Every Port name a type name denotes, transitively: its class heritage, its
 * alias constituents, and the narrowing views derived from it.
 *
 * Both directions are needed. Expanding DOWN a composition reaches the Ports a
 * composite is built from; expanding UP a view reaches the narrower aliases that
 * a broad Port satisfies. Neither direction alone classifies the real call sites
 * in this codebase.
 */
const typeConstituents = (index: ReachIndex, start: string): ReadonlySet<string> => {
  const reverse = reverseViewParts(index);
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const cls = index.classes.get(cur);
    for (const next of [
      ...(cls?.extendsType ? [cls.extendsType] : []),
      ...(cls?.implementsTypes ?? []),
      ...(index.typeAliasParts.get(cur) ?? []),
      ...(reverse.get(cur) ?? []),
    ])
      queue.push(next);
  }
  return seen;
};

/**
 * Is `typeName` the boundary class, or a Port (transitively) that it implements?
 *
 * Both directions are needed. The receiver type may be an ALIAS for a
 * composition of ports (`type SemanticGenerationRepository = A & B`), in which
 * case the alias expands toward the ports; and the boundary may implement an
 * alias, in which case it expands toward the alias. Treating an alias as opaque
 * is what made legitimate dependency types look like method-name collisions.
 */
const typeNameIsBoundary = (
  index: ReachIndex,
  typeName: string,
  boundaryClass: string,
): boolean => {
  if (!typeName || typeName === 'unknown') return false;
  if (typeName === boundaryClass) return true;

  const receiverConstituents = typeConstituents(index, typeName);
  if (receiverConstituents.has(boundaryClass)) return true;
  for (const cur of typeConstituents(index, boundaryClass))
    if (receiverConstituents.has(cur)) return true;
  return false;
};

/**
 * Resolve a receiver expression to a type name using the declarations visible in
 * the owning body, preferring the nearest declaration at or above the call.
 */
export const resolveReceiverType = (
  index: ReachIndex,
  method: ReachMethod,
  receiver: string,
  _line: number,
): { typeName: string; via: string } => {
  const trimmed = receiver.replace(/[!?]+/g, '');
  const direct = /new\s+([A-Za-z_$][\w$]*)/.exec(trimmed);
  if (direct && direct[1]) return { typeName: direct[1], via: 'constructed in the call' };

  const segments = trimmed
    .split('.')
    .map((s) => s.replace(/[^\w$]/g, ''))
    .filter(Boolean);
  const root = segments[0];
  if (!root) return { typeName: '', via: 'empty receiver' };

  const propertyTypeFromLiteral = (typeText: string, propertyName: string): string | null => {
    const sf = ts.createSourceFile(
      'receiver-type.ts',
      `type __Receiver = ${typeText};`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const declaration = sf.statements[0];
    if (!declaration || !ts.isTypeAliasDeclaration(declaration)) return null;
    const visitType = (node: ts.TypeNode): string | null => {
      if (ts.isTypeLiteralNode(node)) {
        const member = node.members.find(
          (item): item is ts.PropertySignature =>
            ts.isPropertySignature(item) &&
            !!item.name &&
            (ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)) &&
            item.name.text === propertyName,
        );
        return member?.type ? bareTypeName(member.type.getText(sf)) : null;
      }
      if (ts.isIntersectionTypeNode(node) || ts.isUnionTypeNode(node)) {
        for (const part of node.types) {
          const found = visitType(part);
          if (found) return found;
        }
      }
      return null;
    };
    return visitType(declaration.type);
  };

  /** Resolve a member name inside `withinClass`, or in this body when null. */
  const typeOfName = (
    name: string,
    withinClass: string | null,
  ): { typeName: string; via: string } | null => {
    if (withinClass) {
      for (const f of index.classFields.get(withinClass) ?? []) {
        if (f.name !== name) continue;
        const t = bareTypeName(f.typeText);
        if (t) return { typeName: t, via: `field ${name} of ${withinClass} declared as ${t}` };
      }
      return null;
    }
    const inBody = method.declarations
      .filter((d) => d.name === name)
      .sort((a, b) => b.position - a.position);
    // Prefer a written type annotation; fall back to the initialiser, which names
    // the concrete class at composition sites.
    for (const decl of inBody) {
      const t = bareTypeName(decl.typeText);
      if (t) return { typeName: t, via: `declaration of ${name} annotated ${t}` };
    }
    // `const runtime = getSourcesWriteRuntime()` carries no annotation: the type
    // is the accessor's declared return type. Without this the receiver of every
    // route call in a composition-root module is unresolvable.
    for (const decl of inBody) {
      const named = accessorReturnNames(index, method.file, decl.initText);
      if (named.length > 0)
        return {
          typeName: named[0]!,
          via: `value of ${name} is the declared return type of a helper`,
        };
    }
    for (const decl of inBody) {
      const t = bareTypeName(decl.initText);
      if (t) return { typeName: t, via: `initialiser of ${name} is ${t}` };
    }
    // `const state = this.durableState!` — follow the field instead of the
    // assertion expression, which carries no class name.
    for (const decl of inBody) {
      const fromField = /^this\.([A-Za-z_$][\w$]*)/.exec(decl.initText.replace(/[!?]+/g, ''));
      if (!fromField) continue;
      for (const f of index.classFields.get(method.className) ?? []) {
        if (f.name !== fromField[1]) continue;
        const t = bareTypeName(f.typeText);
        if (t)
          return { typeName: t, via: `${name} aliases class field ${fromField[1]} typed ${t}` };
      }
    }
    const scoped = (index.moduleDeclarations.get(method.file) ?? [])
      .filter((d) => d.name === name)
      .sort((a, b) => b.position - a.position);
    for (const decl of scoped) {
      const t = bareTypeName(decl.typeText);
      if (t) return { typeName: t, via: `file-scope declaration of ${name} annotated ${t}` };
    }
    for (const decl of scoped) {
      const t = bareTypeName(decl.initText);
      if (t) return { typeName: t, via: `file-scope initialiser of ${name} is ${t}` };
    }
    return null;
  };

  // Walk the receiver chain: `state.ordering.commit` needs `state`'s type before
  // `ordering`'s. A single-hop lookup cannot see this shape at all.
  let current =
    root === 'this'
      ? ({ typeName: method.className, via: `this in ${method.className}` } as {
          typeName: string;
          via: string;
        })
      : typeOfName(root, null);
  let nextSegment = 1;
  if (!current && segments.length > 1) {
    const rootDeclarations = method.declarations
      .filter((declaration) => declaration.name === root)
      .sort((a, b) => b.position - a.position);
    for (const declaration of rootDeclarations) {
      const memberType = propertyTypeFromLiteral(declaration.typeText, segments[1]!);
      if (!memberType) continue;
      current = {
        typeName: memberType,
        via: `property ${segments[1]} of ${root} is declared as ${memberType}`,
      };
      nextSegment = 2;
      break;
    }
  }
  // `await getSourcesWriteRuntime().productService.submit(...)` — the root itself
  // is the accessor call, not a declared name. Resolve it as the accessor's
  // declared return type before declaring the receiver unresolvable.
  if (!current && /\w\s*\(/.test(trimmed)) {
    for (const t of accessorReturnNames(
      index,
      method.file,
      segments.slice(0, 1).join('.') || trimmed,
    )) {
      if (index.classFields.has(t) || typeOfName(t, null) || t === method.className) {
        current = { typeName: t, via: `return type of the helper invoked as the receiver` };
        break;
      }
    }
  }
  if (!current) return { typeName: '', via: `cannot resolve ${root}` };
  for (let i = nextSegment; i < segments.length; i++) {
    if (!index.classFields.has(current.typeName))
      return {
        typeName: '',
        via: `${current.via}, but ${current.typeName} has no indexed members`,
      };
    const next = typeOfName(segments[i]!, current.typeName);
    if (!next) return { typeName: '', via: `cannot resolve ${segments[i]} in ${current.typeName}` };
    current = next;
  }
  return current;
};

/**
 * Doctrine (owner-confirmed): PROVEN production reachability includes execution
 * through production-wired lexical callbacks, timers, event handlers and
 * internally registered callbacks — an external caller is NOT required —
 * provided the callback-registering owner is itself part of a production class.
 *
 * The two forms are distinguishable from a bare self-call:
 *   `this.m()`                    inside the class             -> NOT reachability
 *   `setInterval(() => this.m())` registered by the class       -> reachability
 *
 * Only the callback-registered form qualifies, and only when the owner is the
 * constructor (runs on instantiation) or a member that itself has a caller.
 */
const selfCallbackOwners = (
  index: ReachIndex,
  boundary: { readonly file: string; readonly symbol: string; readonly method: string },
): ReadonlySet<string> => {
  const owners = new Set<string>();
  const hasCaller = (member: string): boolean => {
    for (const m of index.methods) {
      if (m.file === boundary.file && m.className === boundary.symbol && m.name === member)
        continue;
      for (const call of m.calledReceivers) if (call.method === member) return true;
    }
    return false;
  };
  for (const m of index.methods) {
    if (m.file !== boundary.file || m.className !== boundary.symbol) continue;
    if (m.kind !== 'class-method') continue;
    if (m.name === '__constructor') owners.add(m.name);
    else if (m.name !== boundary.method && hasCaller(m.name)) owners.add(m.name);
  }
  return owners;
};

/**
 * Concrete classes that may legitimately receive a call aimed at this boundary.
 *
 * For a class boundary it is the class itself. For a MODULE-LEVEL boundary — a
 * closure returned by a factory, whose recorded symbol is `<module>` — the
 * receiver is typed as the Port the closure satisfies, so the class that
 * implements that Port in the boundary's own file stands in for it. Without
 * this, `this.store.commitProjectProjection` on a Port could never resolve even
 * though the closure and the implementing class live in the same module.
 */
const equivalentBoundaryClasses = (
  index: ReachIndex,
  boundary: { readonly file: string; readonly symbol: string },
): readonly string[] => {
  if (boundary.symbol !== '<module>' && boundary.symbol !== '<anonymous-class>')
    return [boundary.symbol];
  return [...index.classes.values()].filter((c) => c.file === boundary.file).map((c) => c.name);
};

/**
 * How a receiver type qualifies for a boundary, or `null` when it does not.
 *
 * This is the ONE place the qualification doctrine is expressed, so the
 * reachability verdict and the caller classification can never disagree:
 *
 *   DIRECT — the receiver type names the boundary class itself (or, for a
 *            module-level boundary, a class in the boundary's own file);
 *   SOLE   — the receiver type resolves to a Port with exactly ONE production
 *            implementation, and that implementation is the boundary;
 *   PORT   — the receiver type resolves to a Port (possibly through a type alias
 *            or a composite of Ports) that the boundary implements. The receiver
 *            is the Port; only the wiring decides which implementation serves it.
 */
export const boundaryMatchKind = (
  index: ReachIndex,
  boundary: { readonly file: string; readonly symbol: string; readonly method: string },
  typeName: string,
): 'DIRECT' | 'SOLE' | 'PORT' | null => {
  if (!typeName || typeName === 'unknown') return null;
  const equivalents = equivalentBoundaryClasses(index, boundary);
  if (equivalents.includes(typeName)) return 'DIRECT';
  const implementations = buildImplementationIndex(index).get(typeName);
  if (implementations && equivalents.some((cls) => implementations.has(cls)))
    return implementations.size === 1 ? 'SOLE' : 'PORT';
  // A module that satisfies the Port with a factory-produced object literal has
  // no implementing class, but the literal is the production implementation:
  //   export const createPostgresActivityReadModelStore =
  //     (pool: Pool): ActivityReadModelStorePort => ({ ..., async commitProjectProjection(...) {...} });
  // Without this the builder holding the Port is called a name collision.
  const literal = literalPortBindings(index).get(typeName);
  if (literal?.has(boundary.method)) return implementations ? 'PORT' : 'SOLE';
  // A composite alias such as `ProductFindingRepository = A & B` is not a Port
  // with implementations of its own, but a boundary implementing A and B is still
  // the class the receiver is wired to.
  if (equivalents.some((cls) => typeNameIsBoundary(index, typeName, cls))) return 'PORT';
  return null;
};

/**
 * Which callers of a boundary are QUALIFIED, and by which construct.
 *
 * The authority needs to distinguish a receiver that names the boundary class
 * itself (`DIRECT`) from one that names a PORT — or a composition of ports — the
 * boundary implements (`PORT`). Both are qualified reachability; a call site whose
 * receiver names an unrelated type is a method-name collision and never qualifies.
 *
 * A single-implementation Port (`SOLE`) is reported as such because it is the
 * weaker claim: the receiver dispatches to the boundary only while no second
 * production implementation exists.
 */
export const classifyCallers = (
  index: ReachIndex,
  boundary: { readonly file: string; readonly symbol: string; readonly method: string },
  verdict: ReachVerdict,
): readonly {
  readonly caller: ReachVerdict['callers'][number];
  readonly kind: 'DIRECT' | 'SOLE' | 'PORT';
  readonly port: string | null;
}[] => {
  const out: {
    caller: ReachVerdict['callers'][number];
    kind: 'DIRECT' | 'SOLE' | 'PORT';
    port: string | null;
  }[] = [];
  for (const caller of verdict.callers) {
    const kind = boundaryMatchKind(index, boundary, caller.receiverType);
    if (!kind) continue;
    out.push({ caller, kind, port: kind === 'DIRECT' ? null : caller.receiverType });
  }
  return out;
};

/**
 * Members provided by object-literal FACTORIES, keyed by the Port each is bound to.
 *
 * A module often satisfies a Port with a closure instead of a class:
 *   export const createPostgresActivityReadModelStore =
 *     (pool: Pool): ActivityReadModelStorePort => ({ ..., async commitProjectProjection(input) {...} });
 *
 * No class implements `ActivityReadModelStorePort` there, so the Port looks like
 * it has no production implementation and the builder that calls
 * `this.store.commitProjectProjection` is written off as a method-name collision.
 * A factory whose declared return type is a Port, and whose returned object
 * literal provides that Port's members, IS a production implementation of it.
 */
export const literalPortBindings = (
  index: ReachIndex,
): ReadonlyMap<string, ReadonlySet<string>> => {
  const cached = literalBindingCache.get(index);
  if (cached) return cached;
  const bindings = computeLiteralPortBindings(index);
  literalBindingCache.set(index, bindings);
  return bindings;
};

/**
 * The bindings are derived from the whole index and are read once per call site
 * per boundary, so they must be computed at most once per index.
 */
const literalBindingCache = new WeakMap<ReachIndex, ReadonlyMap<string, ReadonlySet<string>>>();

const computeLiteralPortBindings = (
  index: ReachIndex,
): ReadonlyMap<string, ReadonlySet<string>> => {
  const out = new Map<string, Set<string>>();

  const unwrap = (node: ts.Expression): ts.Expression => {
    let current = node;
    while (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isAwaitExpression(current)
    )
      current = current.expression;
    return current;
  };

  /** Only properties on an object that the typed factory actually returns count. */
  const returnedObjects = (body: ts.ConciseBody): ts.ObjectLiteralExpression[] => {
    const expressions: ts.Expression[] = [];
    if (!ts.isBlock(body)) expressions.push(body);
    else {
      const visit = (node: ts.Node): void => {
        if (ts.isReturnStatement(node) && node.expression) expressions.push(node.expression);
        if (node !== body && (ts.isFunctionLike(node) || ts.isClassLike(node))) return;
        ts.forEachChild(node, visit);
      };
      visit(body);
    }

    const objects: ts.ObjectLiteralExpression[] = [];
    const collect = (expression: ts.Expression): void => {
      const value = unwrap(expression);
      if (ts.isObjectLiteralExpression(value)) {
        objects.push(value);
        return;
      }
      if (ts.isConditionalExpression(value)) {
        collect(value.whenTrue);
        collect(value.whenFalse);
      }
    };
    for (const expression of expressions) collect(expression);
    return objects;
  };

  const providedNames = (declaration: { readonly initText: string }): ReadonlySet<string> => {
    const names = new Set<string>();
    const sf = ts.createSourceFile(
      'literal-binding.ts',
      `const __binding = ${declaration.initText};`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const initializer = (sf.statements[0] as ts.VariableStatement | undefined)?.declarationList
      .declarations[0]?.initializer;
    if (!initializer) return names;
    const factory = unwrap(initializer);
    if (!ts.isArrowFunction(factory) && !ts.isFunctionExpression(factory)) return names;
    for (const object of returnedObjects(factory.body))
      for (const property of object.properties)
        if (
          (ts.isPropertyAssignment(property) ||
            ts.isMethodDeclaration(property) ||
            ts.isShorthandPropertyAssignment(property)) &&
          property.name &&
          (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
        )
          names.add(property.name.text);
    return names;
  };

  for (const declarations of index.moduleDeclarations.values())
    for (const d of declarations) {
      // Only a function that ANNOTATES a Port return type binds a literal to it.
      if (!d.initText.includes('=>')) continue;
      const returned = returnTypeNamesOfDeclaration(d);
      if (returned.length === 0) continue;
      const names = providedNames(d);
      if (names.size === 0) continue;
      for (const port of returned) {
        const set = out.get(port) ?? new Set<string>();
        for (const name of names) set.add(name);
        out.set(port, set);
      }
    }
  return out;
};

export const resolveReachability = (
  root: string,
  boundary: {
    readonly boundaryId: string;
    readonly file: string;
    readonly symbol: string;
    readonly method: string;
  },
  index: ReachIndex,
): ReachVerdict => {
  const boundaryClass = boundary.symbol;
  // One doctrine, one place: a call qualifies exactly when `boundaryMatchKind`
  // recognises the receiver, so the verdict and the caller classification can
  // never disagree.
  const matchesBoundary = (typeName: string): boolean =>
    boundaryMatchKind(index, boundary, typeName) !== null;
  const callers: {
    file: string;
    line: number;
    owner: string;
    receiver: string;
    receiverType: string;
    via: string;
  }[] = [];
  const collisions: { file: string; line: number; receiver: string; receiverType: string }[] = [];
  const callbackOwners = selfCallbackOwners(index, boundary);

  /**
   * The single lexical context that OWNS each call site of this method name.
   *
   * The walk reports a nested call from every enclosing body it is reached
   * through, and an outer body cannot see a nested function's locals, so the same
   * site arrives once resolvable and once "unresolved". Leaving that to context
   * ORDER made reachability depend on index traversal. A site is owned by:
   *   1. a context whose receiver resolves — the declaration is visible there, so
   *      that context is looking at the call through the right scope;
   *   2. otherwise the DEEPEST context, whose declaration set is the largest.
   */
  const siteOwner = new Map<
    string,
    {
      readonly method: ReachMethod;
      readonly call: (typeof index.methods)[number]['calledReceivers'][number];
      readonly typeName: string;
      readonly via: string;
    }
  >();
  for (const m of index.methods) {
    for (const call of m.calledReceivers) {
      if (call.method !== boundary.method) continue;
      if (m.file === boundary.file && m.name === boundary.method) continue;
      const resolved = resolveReceiverType(index, m, call.receiver, call.line);
      const key = `${m.file}:${call.line}`;
      const cur = siteOwner.get(key);
      const score = (resolved.typeName ? 1 : 0) * 1000 + m.depth;
      const curScore = cur ? (cur.typeName ? 1 : 0) * 1000 + cur.method.depth : -1;
      if (!cur || score > curScore)
        siteOwner.set(key, { method: m, call, typeName: resolved.typeName, via: resolved.via });
    }
  }

  for (const { method: m, call, typeName, via } of siteOwner.values()) {
    // A call in the boundary's own body is not reachability; a call that the
    // boundary's own reachable owner registered as a callback is.
    const isSelfRegisteredCallback =
      m.file === boundary.file &&
      m.className === boundaryClass &&
      m.kind === 'class-method' &&
      call.viaCallback === true &&
      callbackOwners.has(m.name);
    if (isSelfRegisteredCallback || matchesBoundary(typeName)) {
      callers.push({
        file: m.file,
        line: call.line,
        owner: `${m.className}.${m.name}`,
        receiver: call.receiver,
        receiverType: typeName || boundaryClass,
        via: isSelfRegisteredCallback ? `self-registered callback in ${m.name}` : via,
      });
    } else {
      collisions.push({
        file: m.file,
        line: call.line,
        receiver: call.receiver,
        receiverType: typeName || '(unresolved)',
      });
    }
  }

  return {
    boundaryId: boundary.boundaryId,
    symbol: boundaryClass,
    method: boundary.method,
    reachable: callers.length > 0,
    callers,
    nameOnlyCollisions: collisions,
  };
};
