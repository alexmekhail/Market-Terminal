const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadRoute(file, dependencies = {}, globals = {}) {
  const filename = path.resolve(__dirname, '..', file);
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    require: (name) => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name),
    ...globals,
  }, { filename });
  return exports;
}

module.exports = { loadRoute };
