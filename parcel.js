/* eslint import/no-extraneous-dependencies: ["error", {"devDependencies": true}] */
const chalk = require('chalk');
const Bundler = require('parcel-bundler');
const fs = require('fs');
const { spawn } = require("child_process");

if (fs.existsSync("./dist")) {
  for (const file of fs.readdirSync("./dist")) {
    fs.unlinkSync(`./dist/${file}`);
  }
}

const entryFiles = [
  './templates/homepage.html',
  './templates/preferences.html',
  './templates/talmud_page.html',
];

const isProd = (() => {
  switch (process.argv[2]) {
    case "prod":
      return true;
    case "dev":
      return false;
    case undefined:
    default:
      throw new Error(`No configuration specified. Usage: \`node ${process.argv[1]} <prod|dev>\``);
  }
})();

const bundler = new Bundler(entryFiles, {
  watch: !isProd,
  minify: isProd,
  hmr: false,
  autoInstall: false,
});

let flaskSubprocess = undefined;
let flaskDied = false;
const startFlask = () => {
  flaskDied = false;
  if (flaskSubprocess) {
    flaskSubprocess.kill();
  }
  flaskSubprocess = spawn("./venv/bin/python3", [
    "-u", // Force unbuffered outputs for stdout and stderr so that outputs are visible immediately
    "server.py",
  ], {
    env: {
      FLASK_ENV: "development",
    },
  });
  flaskSubprocess.stdout.pipe(process.stdout);
  flaskSubprocess.stderr.pipe(process.stderr);
  flaskSubprocess.on("exit", () => {
    flaskDied = true;
  });
};
const killFlask = () => {
  if (flaskSubprocess) {
    flaskSubprocess.kill();
  }
};

if (!isProd) {
  let distFiles = new Set();
  const compilerSubprocesses = [];
  let lastSubprocessOutputs = [];
  bundler.on('bundled', () => {
    const newDistFiles = fs.readdirSync("./dist");
    if (distFiles.size !== newDistFiles.length || !newDistFiles.every(x => distFiles.has(x))) {
      distFiles = new Set(newDistFiles);
      startFlask();
    } else if (flaskDied) {
      startFlask();
    }

    const capturedLastSubprocessOutputs = lastSubprocessOutputs;
    lastSubprocessOutputs = [];
    while (compilerSubprocesses.length > 0) {
      compilerSubprocesses.pop().kill();
    }
    const subprocessOutputs = [];
    const processOutput = (process, transformLine) => {
      const index = compilerSubprocesses.length;
      compilerSubprocesses[index] = process;
      const lines = [];
      process.stdout.on("data", data => {
        String(data).split("\n").forEach(line => {
          line = transformLine(line);
          if (line || line === "") {
            lines.push(line);
          }
        });
      });
      process.stderr.on("data", data => {
        lines.push(chalk.bgRed(data));
      });
      process.on("close", () => {
        if (lines.length > 0) {
          console.log(lines.join("\n"));
          subprocessOutputs.push(true);
          lastSubprocessOutputs.push(true);
        } else {
          subprocessOutputs.push(false);
          lastSubprocessOutputs.push(false);
        }

        if (subprocessOutputs.length === compilerSubprocesses.length
            && subprocessOutputs.every(x => !x)
            && capturedLastSubprocessOutputs.some(x => x)) {
          console.log(chalk.green.bold("    js/ts is green again!"));
        }
      });
    };

    const allJsFiles = (
      fs.readdirSync("js").filter(x => !x.endsWith(".test.ts") && !x.endsWith(".test.js")));
    const needToSave = allJsFiles.filter(x => x.startsWith(".#")).map(x => `js/${x}`);
    if (needToSave.length > 0) {
      console.log(chalk.bgMagenta.bold(`Unsaved: ${needToSave}`));
    }
    const filesToLint = allJsFiles.filter(x => !x.startsWith(".#")).map(x => `js/${x}`);
    const tsFiles = filesToLint.filter(x => x.endsWith(".ts") || x.endsWith(".tsx"));

    if (tsFiles.length > 0) {
      processOutput(
        spawn("npx", ["tsc", "--noEmit", "--strict"].concat(tsFiles)),
        line => {
          if (line.indexOf(": error TS")) {
            return chalk.red(line);
          }
          return line;
        });
    }

    processOutput(
      spawn("pre-commit/check_eslint.sh", filesToLint),
      line => {
        if (/ +[0-9]+:[0-9]+ +warning/.test(line)) {
          return chalk.yellow(line);
        } else if (/ +[0-9]+:[0-9]+ +error/.test(line)) {
          return chalk.red(line);
        }
        return line;
      });
  });

  bundler.on("buildError", () => killFlask());
  process.on("exit", () => killFlask());

  fs.watch(".", {recursive: true}, (eventType, fileName) => {
    if (flaskDied
        && fileName.endsWith(".py")
        && !fileName.startsWith(".#")
        && !fileName.startsWith("#")) {
      startFlask();
    }
  });
}

bundler.bundle();
