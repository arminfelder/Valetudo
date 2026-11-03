const Logger = require("../Logger");

/*
 * Wire format of the local link between the dreame firmware (AvaNodeIot in ava) and the dmiot daemon.
 *
 * Robot to daemon: 0xC0, uint16 LE payload length, JSON payload, one 0x00 byte.
 * Daemon to robot: plain JSON. The robot splits concatenated messages at "}{".
 */
class DmiotCodec {
    constructor() {
        this.buffer = Buffer.alloc(0);
    }

    /**
     * @param {Buffer} chunk
     * @returns {Array<object>} all messages that are complete
     */
    decode(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);

        const messages = [];

        while (this.buffer.length > 0) {
            // 0xC0 is not valid in UTF-8. Thus, it cannot occur inside a JSON payload.
            const start = this.buffer.indexOf(DmiotCodec.FRAME_MARKER);

            if (start === -1) {
                Logger.warn("Dropping data without dmiot frame marker", this.buffer.toString());
                this.buffer = Buffer.alloc(0);
                break;
            } else if (start > 0) {
                Logger.warn("Dropping data before dmiot frame marker", this.buffer.subarray(0, start).toString());
                this.buffer = this.buffer.subarray(start);
            }

            if (this.buffer.length < DmiotCodec.HEADER_LENGTH) {
                break;
            }

            const payloadLength = this.buffer.readUInt16LE(1);
            const frameLength = DmiotCodec.HEADER_LENGTH + payloadLength + 1;

            if (this.buffer.length < frameLength) {
                break;
            }

            const payload = this.buffer.subarray(DmiotCodec.HEADER_LENGTH, DmiotCodec.HEADER_LENGTH + payloadLength);
            this.buffer = this.buffer.subarray(frameLength);

            try {
                messages.push(JSON.parse(payload.toString()));
            } catch (e) {
                Logger.warn("Received invalid JSON from dmiot client", payload.toString());
            }
        }

        return messages;
    }

    /**
     * @param {object} msg
     * @returns {Buffer}
     */
    static encode(msg) {
        const payload = Buffer.from(JSON.stringify(msg));

        if (payload.length > DmiotCodec.MAX_OUTGOING_LENGTH) {
            throw new Error(`dmiot message with ${payload.length} bytes exceeds the limit of ${DmiotCodec.MAX_OUTGOING_LENGTH} bytes`);
        }

        return payload;
    }

    /**
     * Only used to build robot-side frames for tests and development tooling
     *
     * @param {object} msg
     * @returns {Buffer}
     */
    static encodeFrame(msg) {
        const payload = Buffer.from(JSON.stringify(msg));
        const frame = Buffer.alloc(DmiotCodec.HEADER_LENGTH + payload.length + 1);

        frame[0] = DmiotCodec.FRAME_MARKER;
        frame.writeUInt16LE(payload.length, 1);
        payload.copy(frame, DmiotCodec.HEADER_LENGTH);

        return frame;
    }
}

DmiotCodec.FRAME_MARKER = 0xC0;
DmiotCodec.HEADER_LENGTH = 3;
// The robot reads with a 4096-byte receive buffer
DmiotCodec.MAX_OUTGOING_LENGTH = 4096;

module.exports = DmiotCodec;
