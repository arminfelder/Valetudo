const assert = require("node:assert");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { before, describe, it } = require("node:test");

/*
    These checks guard the pkg-built robot binary. Node on a dev machine accepts both patterns,
    so the other tests pass while the binary fails at startup.
 */

const BACKEND_ROOT = path.resolve(__dirname, "../..");
// The Valetudo Node build has no Intl support. A regex with \p{...} or \P{...} is a SyntaxError there.
const UNICODE_PROPERTY_ESCAPE = /\\[pP]\{/;
// pkg can load an ES module that has no imports, e.g. jstoxml. It cannot resolve the files that an ES module imports.
const STATIC_IMPORT = /^\s*(?:import\s+["']|import\s[^;]*?\sfrom\s*["']|export\s[^;]*?\sfrom\s*["'])/m;

/**
 * Records all files that load when lib/Valetudo.js loads. Valetudo itself does not start.
 * Modules that load only inside functions are not recorded.
 *
 * @returns {Array<string>}
 */
function collectRuntimeModuleFiles() {
    const files = new Set();
    // @ts-ignore
    const originalResolveFilename = Module._resolveFilename;

    // @ts-ignore
    Module._resolveFilename = function (...args) {
        const resolved = originalResolveFilename.apply(this, args);

        if (path.isAbsolute(resolved)) {
            files.add(resolved);
        }

        return resolved;
    };

    try {
        require(path.join(BACKEND_ROOT, "lib/Valetudo.js"));
    } finally {
        // @ts-ignore
        Module._resolveFilename = originalResolveFilename;
    }

    return [...files];
}

/**
 * @param {string} file
 * @returns {boolean}
 */
function isEsmFile(file) {
    if (file.endsWith(".mjs")) {
        return true;
    }
    if (!file.endsWith(".js")) {
        return false;
    }

    let dir = path.dirname(file);

    while (dir !== path.dirname(dir)) {
        const packageJsonPath = path.join(dir, "package.json");

        if (fs.existsSync(packageJsonPath)) {
            return JSON.parse(fs.readFileSync(packageJsonPath, "utf8")).type === "module";
        }
        dir = path.dirname(dir);
    }

    return false;
}

describe("runtime module graph", () => {
    /** @type {Array<string>} */
    let files;

    before(() => {
        files = collectRuntimeModuleFiles();
    });

    it("loads the dependencies that broke the binary before", () => {
        // Without these modules, the checks below do not cover the known failures.
        for (const dependency of ["aedes", "hyperid", "fast-uri"]) {
            assert.ok(
                files.some(file => {
                    return file.includes(`${path.sep}node_modules${path.sep}${dependency}${path.sep}`);
                }),
                `${dependency} is not in the runtime module graph`
            );
        }
    });

    it("contains no ES modules with static imports", () => {
        const esmFiles = files.filter(file => {
            return isEsmFile(file) && STATIC_IMPORT.test(fs.readFileSync(file, "utf8"));
        }).map(file => {
            return path.relative(BACKEND_ROOT, file);
        });

        assert.deepStrictEqual(esmFiles, []);
    });

    it("contains no regex unicode property escapes", () => {
        const offendingFiles = files.filter(file => {
            return file.endsWith(".js") && UNICODE_PROPERTY_ESCAPE.test(fs.readFileSync(file, "utf8"));
        }).map(file => {
            return path.relative(BACKEND_ROOT, file);
        });

        assert.deepStrictEqual(offendingFiles, []);
    });
});
