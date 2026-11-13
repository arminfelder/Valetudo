const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it, beforeEach, afterEach } = require("node:test");

const WebServerTLSCertificateProvider = require("../../../lib/webserver/WebServerTLSCertificateProvider");

describe("WebServerTLSCertificateProvider", () => {
    let storageDir;

    beforeEach(() => {
        storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "valetudo-tls-test-"));
    });

    afterEach(() => {
        fs.rmSync(storageDir, {recursive: true, force: true});
    });

    it("generates and persists a self-signed certificate", () => {
        const result = WebServerTLSCertificateProvider.GET_CERTIFICATE({
            storageDir: storageDir,
            hostnames: ["valetudo-test.local", "localhost", "192.168.1.10"]
        });

        const x509 = new crypto.X509Certificate(result.cert);

        assert.ok(x509.checkPrivateKey(crypto.createPrivateKey(result.key)));
        assert.ok(x509.subjectAltName.includes("DNS:valetudo-test.local"));
        assert.ok(x509.subjectAltName.includes("DNS:localhost"));
        assert.ok(x509.subjectAltName.includes("IP Address:192.168.1.10"));
        assert.strictEqual(x509.issuer, x509.subject);

        assert.ok(fs.existsSync(path.join(storageDir, "valetudo_https_cert.pem")));
        const keyMode = fs.statSync(path.join(storageDir, "valetudo_https_key.pem")).mode & 0o777;
        assert.strictEqual(keyMode, 0o600);
    });

    it("reuses the stored certificate", () => {
        const options = {storageDir: storageDir, hostnames: ["localhost"]};

        const first = WebServerTLSCertificateProvider.GET_CERTIFICATE(options);
        const second = WebServerTLSCertificateProvider.GET_CERTIFICATE(options);

        assert.strictEqual(
            new crypto.X509Certificate(second.cert).fingerprint256,
            new crypto.X509Certificate(first.cert).fingerprint256
        );
    });

    it("reads custom certificate and key paths", () => {
        const generated = WebServerTLSCertificateProvider.GENERATE_SELF_SIGNED(["custom.example"]);
        const certPath = path.join(storageDir, "custom_cert.pem");
        const keyPath = path.join(storageDir, "custom_key.pem");
        fs.writeFileSync(certPath, generated.cert);
        fs.writeFileSync(keyPath, generated.key);

        const result = WebServerTLSCertificateProvider.GET_CERTIFICATE({
            certPath: certPath,
            keyPath: keyPath,
            storageDir: storageDir,
            hostnames: ["localhost"]
        });

        assert.strictEqual(result.cert, generated.cert);
        assert.strictEqual(result.key, generated.key);
        assert.ok(!fs.existsSync(path.join(storageDir, "valetudo_https_cert.pem")));
    });

    it("throws if a custom path is missing", () => {
        assert.throws(() => {
            WebServerTLSCertificateProvider.GET_CERTIFICATE({
                certPath: path.join(storageDir, "nope.pem"),
                keyPath: path.join(storageDir, "nope_key.pem"),
                storageDir: storageDir,
                hostnames: ["localhost"]
            });
        });
    });

    it("throws if only one custom path is set", () => {
        assert.throws(() => {
            WebServerTLSCertificateProvider.GET_CERTIFICATE({
                certPath: path.join(storageDir, "cert.pem"),
                storageDir: storageDir,
                hostnames: ["localhost"]
            });
        }, /both certPath and keyPath/);
    });
});
