import ts from "typescript";

function fail(message: string): never {
  throw new Error(`exec helper rejected: ${message}`);
}

export function assertExecHelperSourceIsSafe(source: string): void {
  const file = ts.createSourceFile(
    "exec-helper.mjs",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) {
      fail("import declarations are not allowed");
    }
    if (ts.isExportAssignment(node) || ts.isExportDeclaration(node)) {
      fail("export declarations are not allowed");
    }
    if (ts.isMetaProperty(node)) {
      if (node.keywordToken === ts.SyntaxKind.ImportKeyword) {
        fail("import.meta is not allowed");
      }
    }
    if (ts.isNewExpression(node)) {
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === "Function"
      ) {
        fail("new Function() is not allowed");
      }
    }
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression)) {
        const name = node.expression.text;
        if (name === "eval") {
          fail("eval() is not allowed");
        }
        if (name === "Function") {
          fail("Function() is not allowed");
        }
        if (name === "require") {
          fail("require() is not allowed");
        }
      }
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        fail("dynamic import() is not allowed");
      }
    }
    if (ts.isIdentifier(node)) {
      switch (node.text) {
        case "process":
        case "globalThis":
        case "global":
        case "eval":
        case "Function":
        case "Reflect":
        case "Proxy":
        case "require":
          fail(`${node.text} is not allowed`);
      }
    }
    if (ts.isPropertyAccessExpression(node)) {
      const name = node.name.text;
      if (name === "constructor" || name === "__proto__") {
        fail(`.${name} access is not allowed`);
      }
    }
    if (ts.isElementAccessExpression(node)) {
      const expr = node.argumentExpression;
      if (ts.isStringLiteralLike(expr)) {
        const name = expr.text;
        if (name === "constructor" || name === "__proto__") {
          fail(`['${name}'] access is not allowed`);
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(file);
}
