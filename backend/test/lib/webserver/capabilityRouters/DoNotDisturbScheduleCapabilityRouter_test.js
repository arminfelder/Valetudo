const assert = require("node:assert");
const express = require("express");
const { after, before, beforeEach, describe, it } = require("node:test");

const DoNotDisturbScheduleCapabilityRouter = require("../../../../lib/webserver/capabilityRouters/DoNotDisturbScheduleCapabilityRouter");
const ValetudoDNDWindow = require("../../../../lib/entities/core/ValetudoDNDWindow");

describe("DoNotDisturbScheduleCapabilityRouter", () => {
    let server;
    let baseUrl;
    let setCalls;
    let failSet;

    const capability = {
        getWindows: async () => {
            return [new ValetudoDNDWindow({id: 1, enabled: true, start: {hour: 21, minute: 0}, end: {hour: 7, minute: 0}, dow: [1]})];
        },
        setWindows: async (windows) => {
            if (failSet) {
                throw new Error("robot said no");
            }
            setCalls.push(windows);
        },
        getProperties: () => {
            return {maxWindows: 10};
        }
    };

    before(async () => {
        const app = express();
        app.use(express.json());
        app.use("/", new DoNotDisturbScheduleCapabilityRouter({
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
        setCalls = [];
        failSet = false;
    });

    /**
     * @param {any} body
     * @returns {Promise<Response>}
     */
    async function put(body) {
        const res = await fetch(baseUrl + "/", {
            method: "PUT",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(body)
        });
        await res.text();

        return res;
    }

    const valid = {enabled: true, start: {hour: 22, minute: 30}, end: {hour: 6, minute: 0}, dow: [0, 6]};

    it("returns the windows wrapped in an object", async () => {
        const res = await fetch(baseUrl + "/");
        const body = await res.json();

        assert.strictEqual(res.status, 200);
        assert.strictEqual(body.windows.length, 1);
        assert.strictEqual(body.windows[0].id, 1);
        assert.deepStrictEqual(body.windows[0].dow, [1]);
    });

    it("passes valid windows as ValetudoDNDWindow and drops unknown keys", async () => {
        const res = await put({windows: [Object.assign({id: 3, extra: "x"}, valid), valid]});

        assert.strictEqual(res.status, 200);
        assert.strictEqual(setCalls.length, 1);
        assert.ok(setCalls[0][0] instanceof ValetudoDNDWindow);
        assert.strictEqual(setCalls[0][0].id, 3);
        assert.strictEqual(setCalls[0][0].extra, undefined);
        assert.strictEqual(setCalls[0][1].id, undefined);
    });

    it("accepts an empty list to remove all windows", async () => {
        const res = await put({windows: []});

        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(setCalls, [[]]);
    });

    for (const [name, body] of [
        ["no windows key", {}],
        ["windows not an array", {windows: {}}],
        ["id 0", {windows: [Object.assign({}, valid, {id: 0})]}],
        ["non-integer id", {windows: [Object.assign({}, valid, {id: "1"})]}],
        ["enabled not a boolean", {windows: [Object.assign({}, valid, {enabled: 1})]}],
        ["hour 24", {windows: [Object.assign({}, valid, {start: {hour: 24, minute: 0}})]}],
        ["minute 60", {windows: [Object.assign({}, valid, {end: {hour: 1, minute: 60}})]}],
        ["missing end", {windows: [Object.assign({}, valid, {end: undefined})]}],
        ["day 7", {windows: [Object.assign({}, valid, {dow: [7]})]}],
        ["dow not an array", {windows: [Object.assign({}, valid, {dow: 1})]}],
        ["null window", {windows: [null]}]
    ]) {
        it(`rejects ${name} with 400`, async () => {
            const res = await put(body);

            assert.strictEqual(res.status, 400);
            assert.strictEqual(setCalls.length, 0);
        });
    }

    it("answers 500 with the message when the capability fails", async () => {
        failSet = true;
        const res = await fetch(baseUrl + "/", {
            method: "PUT",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({windows: [valid]})
        });

        assert.strictEqual(res.status, 500);
        assert.strictEqual(await res.json(), "robot said no");
    });
});
