// Runs the engine's tests on one target: `node tests/engine/run.ts`, or the
// Lua bundles TypeScriptToLua makes of this file (just test-lua).
import { run } from "./harness.ts";
import "./platform.spec.ts";
import "./paint.spec.ts";
import "./leaf.spec.ts";
import "./flower.spec.ts";
import "./sprig.spec.ts";
import "./plant.spec.ts";

declare const _VERSION: string | undefined;
// In Lua, _VERSION names the interpreter ("Lua 5.3", "Lua 5.1" for LuaJIT).
run(typeof _VERSION === "string" ? _VERSION : "node");
