const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { after, before, beforeEach, describe, it } = require("node:test");

process.env.VALETUDO_CONFIG_PATH = path.join(os.tmpdir(), `valetudo_x50_multi_floor_test_${process.pid}.json`);

const Configuration = require("../../../../lib/Configuration");
const DreameMultiFloorMapCapability = require("../../../../lib/robots/dreame/capabilities/DreameMultiFloorMapCapability");
const DreameX50UltraValetudoRobot = require("../../../../lib/robots/dreame/DreameX50UltraValetudoRobot");
const ValetudoEventStore = require("../../../../lib/ValetudoEventStore");

/**
 * Builds a stored map like the ones in /data/log/map_info.bin of the X50:
 * an I-frame with rism pixels (bit 7 wall, bit 6 carpet, bits 0-5 segment id) and a JSON tail.
 *
 * @param {number} mapId
 * @param {Object<string, string>} segmentNames segment id -> name ("" for no name)
 * @returns {string} base64url of the zlib data
 */
function buildStoredMap(mapId, segmentNames) {
    const width = 4;
    const height = 3;
    const header = Buffer.alloc(27);

    header.writeInt16LE(mapId, 0);
    header.writeInt16LE(0, 2);
    header.writeInt8(73, 4); // I-frame
    header.writeInt16LE(100, 5);
    header.writeInt16LE(100, 7);
    header.writeInt16LE(0, 9);
    header.writeInt16LE(200, 11);
    header.writeInt16LE(200, 13);
    header.writeInt16LE(90, 15);
    header.writeInt16LE(50, 17); // 5 cm
    header.writeInt16LE(width, 19);
    header.writeInt16LE(height, 21);
    header.writeInt16LE(-100, 23);
    header.writeInt16LE(-100, 25);

    const ids = Object.keys(segmentNames).map(Number);
    const pixels = Buffer.alloc(width * height);
    for (let i = 0; i < pixels.length; i++) {
        pixels[i] = i < width ? 0x80 : ids[i % ids.length]; // first row is wall
    }

    const segInf = {};
    for (const [id, name] of Object.entries(segmentNames)) {
        segInf[id] = name ? {name: Buffer.from(name).toString("base64")} : {};
    }

    const raw = Buffer.concat([header, pixels, Buffer.from(JSON.stringify({seg_inf: segInf}))]);

    return zlib.deflateSync(raw).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
}

describe("DreameMultiFloorMapCapability", () => {
    describe("PARSE_MAP_LIST_ENTRY", () => {
        it("takes the map id from the map header, not the list id, and decodes rism segments", async () => {
            const map = await DreameMultiFloorMapCapability.PARSE_MAP_LIST_ENTRY(
                {id: 0, name: "", angle: "0", map: buildStoredMap(120, {1: "Kitchen", 2: ""})},
                120
            );

            assert.strictEqual(map.id, 120);
            assert.strictEqual(map.active, true);
            assert.strictEqual(map.name, undefined);
            assert.deepStrictEqual(map.segments, [{id: "1", name: "Kitchen"}, {id: "2", name: undefined}]);
        });

        it("marks a map that is not curr_id as inactive and keeps its name", async () => {
            const map = await DreameMultiFloorMapCapability.PARSE_MAP_LIST_ENTRY(
                {id: 1, name: "Attic", map: buildStoredMap(121, {3: ""})},
                120
            );

            assert.strictEqual(map.active, false);
            assert.strictEqual(map.name, "Attic");
        });

        it("rejects an entry without map data", async () => {
            await assert.rejects(DreameMultiFloorMapCapability.PARSE_MAP_LIST_ENTRY({id: 0}, 1), /no map data/);
        });
    });

    describe("IS_MAP_LIST", () => {
        it("accepts the format of map_info.bin only", () => {
            assert.strictEqual(DreameMultiFloorMapCapability.IS_MAP_LIST({mapstr: [], curr_id: 1}), true);
            assert.strictEqual(DreameMultiFloorMapCapability.IS_MAP_LIST({mapstr: []}), false);
            assert.strictEqual(DreameMultiFloorMapCapability.IS_MAP_LIST([{id: 120, info: []}]), false);
            assert.strictEqual(DreameMultiFloorMapCapability.IS_MAP_LIST(null), false);
        });
    });

    describe("on the X50", () => {
        /** @type {DreameX50UltraValetudoRobot} */
        let robot;
        /** @type {DreameMultiFloorMapCapability} */
        let capability;
        /** @type {Array<{method: string, args: any}>} */
        let sentCommands;
        let multiFloorEnabled;
        let actionResult;
        let pollCount;
        let tmpDir;
        let registeredMapListPath;

        const twoMaps = () => {
            return {
                mapstr: [
                    {id: 0, name: "", angle: "0", map: buildStoredMap(120, {1: "Kitchen"})},
                    {id: 1, name: "Attic", angle: "0", map: buildStoredMap(121, {1: ""})}
                ],
                curr_id: 120
            };
        };

        before(() => {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "valetudo_multi_floor_"));

            robot = new DreameX50UltraValetudoRobot({
                config: new Configuration(),
                valetudoEventStore: new ValetudoEventStore()
            });

            // The getter reads the device.conf of the robot, which does not exist here
            Object.defineProperty(robot, "deviceId", {value: 123456789});

            robot.sendCommand = async (method, args) => {
                sentCommands.push({method: method, args: args});

                switch (method) {
                    case "get_properties":
                        return args.map(p => {
                            return Object.assign({}, p, {code: 0, value: multiFloorEnabled});
                        });
                    case "set_properties":
                        return args.map(p => {
                            return Object.assign({}, p, {code: 0});
                        });
                    default:
                        return {code: 0, siid: 6, aiid: 2, out: [{piid: 6, value: actionResult}]};
                }
            };
            robot.pollMap = () => {
                pollCount++;
            };

            capability = robot.capabilities.MultiFloorMapCapability;
            registeredMapListPath = capability.mapListPath;
        });

        after(async () => {
            await robot.shutdown();
            await new Promise(resolve => {
                robot.fdsMockServer.close(resolve);
            });
            fs.rmSync(tmpDir, {recursive: true, force: true});
        });

        beforeEach(() => {
            sentCommands = [];
            multiFloorEnabled = 1;
            actionResult = 0;
            pollCount = 0;
            capability.mapListPath = path.join(tmpDir, "map_info.bin");
            fs.writeFileSync(capability.mapListPath, JSON.stringify(twoMaps()));
            robot.lastUploadedMultiFloorMapList = undefined;
        });

        /**
         * @returns {Array<any>}
         */
        function sentMapEdits() {
            return sentCommands.filter(c => {
                return c.method === "action";
            }).map(c => {
                assert.strictEqual(c.args.siid, 6);
                assert.strictEqual(c.args.aiid, 2);
                assert.strictEqual(c.args.in[0].piid, 4);

                return JSON.parse(c.args.in[0].value);
            });
        }

        it("reads the map list of the robot from /data/log/map_info.bin", () => {
            assert.ok(capability instanceof DreameMultiFloorMapCapability);
            assert.strictEqual(registeredMapListPath, "/data/log/map_info.bin");
        });

        it("lists the stored maps from the local file", async () => {
            const maps = await capability.getMaps();

            assert.deepStrictEqual(maps.map(m => {
                return [m.id, m.name, m.active];
            }), [[120, undefined, true], [121, "Attic", false]]);
        });

        it("falls back to the last uploaded map list", async () => {
            capability.mapListPath = path.join(tmpDir, "does_not_exist");

            await assert.rejects(capability.getMaps(), /not reported its stored maps yet/);

            await robot.handleUploadedFDSData(Buffer.from(JSON.stringify(twoMaps())), {}, {});
            assert.strictEqual((await capability.getMaps()).length, 2);
        });

        it("ignores an uploaded backup list, which is JSON too", async () => {
            capability.mapListPath = path.join(tmpDir, "does_not_exist");

            await robot.handleUploadedFDSData(Buffer.from(JSON.stringify([{id: 120, info: []}])), {}, {});
            assert.strictEqual(robot.lastUploadedMultiFloorMapList, undefined);
        });

        it("reads and writes siid 6 piid 7 for the multi-floor switch", async () => {
            assert.strictEqual(await capability.isEnabled(), true);
            multiFloorEnabled = 0;
            assert.strictEqual(await capability.isEnabled(), false);

            await capability.setEnabled(true);
            const write = sentCommands.find(c => {
                return c.method === "set_properties";
            });
            assert.deepStrictEqual([write.args[0].siid, write.args[0].piid, write.args[0].value], [6, 7, 1]);
        });

        it("selects a map with sm and the map id, then polls the map", async () => {
            await capability.selectMap(121);

            assert.deepStrictEqual(sentMapEdits(), [{sm: {}, mapid: 121}]);
            assert.strictEqual(pollCount, 1);
        });

        it("sends nothing to select the active map", async () => {
            await capability.selectMap(120);

            assert.deepStrictEqual(sentMapEdits(), []);
        });

        it("renames with nrism in plain text and removes the name with null", async () => {
            await capability.renameMap(121, "Ground floor");
            await capability.renameMap(121, "");

            assert.deepStrictEqual(sentMapEdits(), [
                {nrism: {121: {name: "Ground floor"}}},
                {nrism: {121: {name: null}}}
            ]);
        });

        it("refuses a name that is too long", async () => {
            await assert.rejects(capability.renameMap(121, "x".repeat(33)), /not be longer than 32/);
            assert.deepStrictEqual(sentMapEdits(), []);
        });

        it("deletes an inactive map with cm and the map id", async () => {
            await capability.deleteMap(121);

            assert.deepStrictEqual(sentMapEdits(), [{cm: {}, mapid: 121}]);
        });

        it("never deletes the active map", async () => {
            await assert.rejects(capability.deleteMap(120), /active map cannot be deleted/);
            assert.deepStrictEqual(sentMapEdits(), []);
        });

        it("never deletes while multi-floor maps are disabled, because the firmware would delete all maps", async () => {
            multiFloorEnabled = 0;

            await assert.rejects(capability.deleteMap(121), /only be deleted while multi-floor maps are enabled/);
            assert.deepStrictEqual(sentMapEdits(), []);
        });

        it("refuses unknown map ids", async () => {
            await assert.rejects(capability.selectMap(999), /No stored map with id 999/);
            await assert.rejects(capability.renameMap(999, "x"), /No stored map with id 999/);
            await assert.rejects(capability.deleteMap(999), /No stored map with id 999/);
            assert.deepStrictEqual(sentMapEdits(), []);
        });

        it("reports an error result of the firmware", async () => {
            actionResult = 3;

            await assert.rejects(capability.selectMap(121), /Got error 3/);
            assert.strictEqual(pollCount, 0);
        });

        it("parses the stored maps only again when the map list changes", async () => {
            const first = await capability.getMaps();
            assert.strictEqual(await capability.getMaps(), first, "same list: cached result");

            const changed = twoMaps();
            changed.mapstr[1].name = "Basement";
            fs.writeFileSync(capability.mapListPath, JSON.stringify(changed));

            const second = await capability.getMaps();
            assert.notStrictEqual(second, first);
            assert.strictEqual(second[1].name, "Basement");
        });

        it("reports a broken map list", async () => {
            fs.writeFileSync(capability.mapListPath, JSON.stringify({foo: 1}));

            await assert.rejects(capability.getMaps(), /invalid list of stored maps/);
        });
    });
});
