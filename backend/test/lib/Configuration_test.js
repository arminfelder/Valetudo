const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, describe, it, mock } = require("node:test");

const Configuration = require("../../lib/Configuration");
const env = require("../../lib/res/env");

describe("Configuration", () => {
    let dir;
    let location;
    let previousConfigPath;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "valetudo_config_test_"));
        location = path.join(dir, "valetudo_config.json");

        previousConfigPath = process.env[env.ConfigPath];
        process.env[env.ConfigPath] = location;
    });

    afterEach(() => {
        mock.restoreAll();

        if (previousConfigPath === undefined) {
            delete process.env[env.ConfigPath];
        } else {
            process.env[env.ConfigPath] = previousConfigPath;
        }

        fs.rmSync(dir, {recursive: true, force: true});
    });

    it("creates the configuration file and persists changes", () => {
        const config = new Configuration();

        config.set("logLevel", "debug");

        assert.strictEqual(JSON.parse(fs.readFileSync(location, "utf-8")).logLevel, "debug");
        assert.strictEqual(new Configuration().get("logLevel"), "debug");
        assert.deepStrictEqual(fs.readdirSync(dir), ["valetudo_config.json"]);
    });

    it("replaces the configuration file only after the new content is complete", () => {
        const config = new Configuration();
        const contentBefore = fs.readFileSync(location, "utf-8");
        const renameSync = fs.renameSync;
        let observed;

        mock.method(fs, "renameSync", (from, to) => {
            observed = {
                to: to,
                target: fs.readFileSync(location, "utf-8"),
                source: fs.readFileSync(from, "utf-8")
            };

            return renameSync(from, to);
        });

        config.set("logLevel", "debug");

        assert.ok(observed, "The configuration file was written in place");
        assert.strictEqual(observed.to, location);
        assert.strictEqual(observed.target, contentBefore);
        assert.strictEqual(JSON.parse(observed.source).logLevel, "debug");
        assert.strictEqual(JSON.parse(fs.readFileSync(location, "utf-8")).logLevel, "debug");
        assert.deepStrictEqual(fs.readdirSync(dir), ["valetudo_config.json"]);
    });

    it("keeps the permissions of the configuration file", {skip: process.platform === "win32"}, () => {
        const config = new Configuration();

        fs.chmodSync(location, 0o600);
        config.set("logLevel", "debug");

        assert.strictEqual(fs.statSync(location).mode & 0o777, 0o600);
    });

    it("writes the configuration file in place when it cannot be replaced", () => {
        const config = new Configuration();

        mock.method(fs, "renameSync", () => {
            throw Object.assign(new Error("EBUSY: resource busy or locked"), {code: "EBUSY"});
        });

        config.set("logLevel", "debug");

        assert.strictEqual(JSON.parse(fs.readFileSync(location, "utf-8")).logLevel, "debug");
        assert.deepStrictEqual(fs.readdirSync(dir), ["valetudo_config.json"]);
    });
});
