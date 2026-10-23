import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);

/** Compile app TypeScript without a test bundler; native imports are explicit fixtures. */
export function loadTypeScript(relativePath, stubs = {}) {
  const filename = new URL(relativePath, import.meta.url);
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename.pathname,
  });
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${outputText}\n})`, { filename: filename.pathname })(
    (name) => Object.hasOwn(stubs, name) ? stubs[name] : require(name), module, module.exports,
  );
  return module.exports;
}
