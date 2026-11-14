const assert = require("node:assert");
const express = require("express");
const { after, before, beforeEach, describe, it } = require("node:test");

const MultiFloorMapCapabilityRouter = require("../../../../lib/webserver/capabilityRouters/MultiFloorMapCapabilityRouter");
const ValetudoFloorMap = require("../../../../lib/entities/core/ValetudoFloorMap");

describe("MultiFloorMapCapabilityRouter", () => {
    let server;
    let baseUrl;
    let calls;
    let failWith;

    const record = (name) => {
        return async (...args) => {
            if (failWith) {
                throw new Error(failWith);
            }
            calls.push([name, ...args]);
        };
    };

    const capability = {
        isEnabled: async () => {
            return true;
        },
        getMaps: async () => {
            return [new ValetudoFloorMap({id: 120, active: true, segments: [{id: "1", name: "Kitchen"}]})];
        },
        setEnabled: record("setEnabled"),
        selectMap: record("selectMap"),
        renameMap: record("renameMap"),
        deleteMap: record("deleteMap"),
        getProperties: () => {
            return {maxNameLength: 32};
        }
    };

    before(async () => {
        const app = express();
        app.use(express.json());
        app.use("/", new MultiFloorMapCapabilityRouter({
            capability: capability,
            validator: (req, res, next) => {
                return next();
            }
        }).getRouter());

        await new Promise(resolve => {
            server = app.listen(0, "127.0.0.1", resolve);
        });
        baseUrl = `http://127.0.0.1:${server.address().port}`;
    });

    after(async () => {
        await new Promise(resolve => {
            server.close(resolve);
        });
    });

    beforeEach(() => {
        calls = [];
        failWith = undefined;
    });

    /**
     * @param {any} body
     * @returns {Promise<{status: number, body: string}>}
     */
    async function put(body) {
        const res = await fetch(baseUrl + "/", {
            method: "PUT",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(body)
        });

        return {status: res.status, body: await res.text()};
    }

    it("returns the switch state and the maps", async () => {
        const res = await fetch(baseUrl + "/");
        const body = await res.json();

        assert.strictEqual(res.status, 200);
        assert.strictEqual(body.enabled, true);
        assert.strictEqual(body.maps[0].id, 120);
        assert.strictEqual(body.maps[0].active, true);
    });

    for (const [body, expected] of [
        [{action: "set_enabled", enabled: false}, ["setEnabled", false]],
        [{action: "select", id: 121}, ["selectMap", 121]],
        [{action: "rename", id: 121, name: "Attic"}, ["renameMap", 121, "Attic"]],
        [{action: "rename", id: 121, name: ""}, ["renameMap", 121, ""]],
        [{action: "delete", id: 121}, ["deleteMap", 121]]
    ]) {
        it(`maps ${JSON.stringify(body)} to ${expected[0]}`, async () => {
            const res = await put(body);

            assert.strictEqual(res.status, 200);
            assert.deepStrictEqual(calls, [expected]);
        });
    }

    for (const body of [
        {},
        {action: "explode"},
        {action: "set_enabled"},
        {action: "set_enabled", enabled: "yes"},
        {action: "select"},
        {action: "select", id: "121"},
        {action: "select", id: 1.5},
        {action: "rename", id: 121},
        {action: "rename", id: 121, name: 5},
        {action: "delete", id: null}
    ]) {
        it(`rejects ${JSON.stringify(body)} with 400`, async () => {
            const res = await put(body);

            assert.strictEqual(res.status, 400);
            assert.deepStrictEqual(calls, []);
        });
    }

    it("answers 500 with the message of the capability", async () => {
        failWith = "The active map cannot be deleted here. Use the map reset instead.";
        const res = await put({action: "delete", id: 120});

        assert.strictEqual(res.status, 500);
        assert.strictEqual(JSON.parse(res.body), failWith);
    });
});
