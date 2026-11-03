// Engine code (src/engine, tests/engine) compiles to Lua 5.3 and LuaJIT as
// well as running in JavaScript, so it must avoid what behaves differently
// across the three; src/engine/platform.ts gives portable replacements.
// These tests walk the engine's syntax trees with TypeScript's checker, and
// first prove on tests/fixtures/engine-violations.ts that each rule fires.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const ROOT = join(import.meta.dirname, "..");
const PLATFORM = join(ROOT, "src/engine/platform.ts");
const FIXTURE = join(ROOT, "tests/fixtures/engine-violations.ts");

const files = (dir: string): string[] =>
  readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(ROOT, dir, f));
const ENGINE = [...files("src/engine"), ...files("tests/engine")].filter((f) => f !== PLATFORM);

const config = ts.getParsedCommandLineOfConfigFile(join(ROOT, "tsconfig.json"), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d) => { throw new Error(String(d.messageText)); } });
if (!config) throw new Error("tsconfig.json did not parse");
const program = ts.createProgram([...ENGINE, FIXTURE, PLATFORM, join(ROOT, "lua/platform.d.ts")], config.options);
const checker = program.getTypeChecker();

type Rule = "bitwise" | "mod" | "regex" | "number-to-string" | "order" | "typed-array" | "host" | "hole" | "spread-nil";
interface Violation { rule: Rule; line: number; text: string }

const BITWISE = new Set([
  ts.SyntaxKind.AmpersandToken, ts.SyntaxKind.BarToken, ts.SyntaxKind.CaretToken,
  ts.SyntaxKind.LessThanLessThanToken, ts.SyntaxKind.GreaterThanGreaterThanToken, ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken,
  ts.SyntaxKind.AmpersandEqualsToken, ts.SyntaxKind.BarEqualsToken, ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken, ts.SyntaxKind.GreaterThanGreaterThanEqualsToken, ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
]);
const TYPED = /^(Float32|Float64|Int8|Int16|Int32|Uint8|Uint8Clamped|Uint16|Uint32|BigInt64|BigUint64)Array$/;

const isNumber = (e: ts.Expression) => (checker.getTypeAtLocation(e).flags & ts.TypeFlags.NumberLike) !== 0;
const isNumberArray = (e: ts.Expression) => {
  const t = checker.getTypeAtLocation(e);
  const el = checker.isArrayType(t) ? checker.getTypeArguments(t as ts.TypeReference)[0] : undefined;
  return el !== undefined && (el.flags & ts.TypeFlags.NumberLike) !== 0;
};
// May the expression be undefined (or null)? A Lua table cannot hold nil, so
// such a value would leave a hole in an array.
const mayBeNil = (e: ts.Expression) => {
  const t = checker.getTypeAtLocation(e);
  const parts = t.isUnion() ? t.types : [t];
  return parts.some((p) => (p.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void | ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0);
};
const isString = (e: ts.Expression) => (checker.getTypeAtLocation(e).flags & ts.TypeFlags.StringLike) !== 0;

// Each construct in `file` that breaks a rule.
function violations(file: string): Violation[] {
  const sf = program.getSourceFile(file);
  if (!sf) throw new Error(`${file} is not in the program`);
  const found: Violation[] = [];
  const add = (rule: Rule, node: ts.Node) =>
    found.push({ rule, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text: node.getText(sf) });
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (BITWISE.has(op)) add("bitwise", node);
      if (op === ts.SyntaxKind.PercentToken || op === ts.SyntaxKind.PercentEqualsToken) add("mod", node);
      if (op === ts.SyntaxKind.PlusToken && ((isString(node.left) && isNumber(node.right)) || (isNumber(node.left) && isString(node.right)))) add("number-to-string", node);
    } else if (ts.isArrayLiteralExpression(node)) {
      for (const el of node.elements) if (!ts.isSpreadElement(el) && !ts.isOmittedExpression(el) && mayBeNil(el)) add("hole", el);
    } else if (ts.isObjectLiteralExpression(node)) {
      // After a spread, a field that may be undefined cannot clear the
      // spread's value in Lua: a nil in a table constructor is no entry.
      let spread = false;
      for (const p of node.properties) {
        if (ts.isSpreadAssignment(p)) spread = true;
        else if (spread && ts.isPropertyAssignment(p) && mayBeNil(p.initializer)) add("spread-nil", p);
        else if (spread && ts.isShorthandPropertyAssignment(p) && mayBeNil(p.name)) add("spread-nil", p);
      }
    } else if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.TildeToken) {
      add("bitwise", node);
    } else if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      add("regex", node);
    } else if (ts.isTemplateSpan(node) && isNumber(node.expression)) {
      add("number-to-string", node.expression);
    } else if (ts.isForInStatement(node)) {
      add("order", node.initializer);
    } else if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee)) {
        if (callee.text === "RegExp") add("regex", node);
        if (callee.text === "String" && node.arguments?.some(isNumber)) add("number-to-string", node);
        if (TYPED.test(callee.text)) add("typed-array", node);
      } else if (ts.isPropertyAccessExpression(callee)) {
        const name = callee.name.text, on = callee.expression.getText(sf);
        if (["toString", "toFixed", "toPrecision", "toExponential"].includes(name) && isNumber(callee.expression)) add("number-to-string", node);
        if (on === "Object" && ["keys", "values", "entries"].includes(name)) add("order", node);
        if (name === "sort") add("order", node);
        if ((name === "push" || name === "unshift") && checker.isArrayType(checker.getTypeAtLocation(callee.expression))) {
          for (const a of node.arguments ?? []) if (mayBeNil(a)) add("hole", a);
        }
        if (name === "join" && isNumberArray(callee.expression)) add("number-to-string", node);
        if ((on === "Math" && name === "random") || on === "Date") add("host", node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

test("each rule fires on the fixture's constructs, line by line", () => {
  const sf = program.getSourceFile(FIXTURE)!;
  const want = new Map<number, Rule>();
  sf.text.split("\n").forEach((line, i) => {
    const tag = line.match(/\/\/ (bitwise|mod|regex|number-to-string|order|typed-array|host|hole|spread-nil)$/);
    if (tag) want.set(i + 1, tag[1] as Rule);
  });
  assert.ok(want.size >= 25, `the fixture tags only ${want.size} lines`);
  const got = violations(FIXTURE);
  for (const [line, rule] of want) {
    assert.ok(got.some((v) => v.line === line && v.rule === rule), `line ${line}: no ${rule} violation found`);
  }
  for (const v of got) assert.equal(want.get(v.line), v.rule, `line ${v.line}: unexpected ${v.rule} in ${v.text}`);
});

test("engine code keeps to the rules", () => {
  assert.ok(ENGINE.length >= 4, `only ${ENGINE.length} engine files found`);
  const bad = ENGINE.flatMap((f) => violations(f).map((v) => `${f.slice(ROOT.length + 1)}:${v.line} ${v.rule}: ${v.text}`));
  assert.deepEqual(bad, [], "use src/engine/platform.ts's replacements:\n" + bad.join("\n"));
});

test("the Lua platforms declare and define what the JavaScript one exports", () => {
  const exportsOf = (file: string) => {
    const sym = checker.getSymbolAtLocation(program.getSourceFile(file)!)!;
    return new Map(checker.getExportsOfModule(sym).map((e) => [e.name, checker.typeToString(checker.getTypeOfSymbol(e))]));
  };
  const js = exportsOf(PLATFORM), lua = exportsOf(join(ROOT, "lua/platform.d.ts"));
  assert.deepEqual([...lua].sort(), [...js].sort(), "lua/platform.d.ts and src/engine/platform.ts differ");
  for (const dir of ["53", "jit"]) {
    const src = readFileSync(join(ROOT, "lua", dir, "platform.lua"), "utf8");
    const defined = new Set([...src.matchAll(/^function M\.(\w+)\(/gm)].map((m) => m[1]));
    assert.deepEqual([...defined].sort(), [...js.keys()].sort(), `lua/${dir}/platform.lua defines a different set`);
  }
});
