const crypto = require("crypto");
const forge = require("node-forge");
const fs = require("fs");
const Logger = require("../Logger");
const net = require("net");
const os = require("os");
const path = require("path");

const CERT_FILENAME = "valetudo_https_cert.pem";
const KEY_FILENAME = "valetudo_https_key.pem";
const VALIDITY_DAYS = 825;
const RENEW_BEFORE_MS = 30 * 24 * 60 * 60 * 1000;

class WebServerTLSCertificateProvider {
    /**
     * @param {object} options
     * @param {string} [options.certPath]
     * @param {string} [options.keyPath]
     * @param {string} options.storageDir
     * @param {Array<string>} options.hostnames
     * @returns {{cert: string, key: string}}
     */
    static GET_CERTIFICATE(options) {
        if (options.certPath || options.keyPath) {
            if (!options.certPath || !options.keyPath) {
                throw new Error("webserver.https requires both certPath and keyPath to be set");
            }

            return {
                cert: fs.readFileSync(options.certPath, {encoding: "utf-8"}),
                key: fs.readFileSync(options.keyPath, {encoding: "utf-8"})
            };
        }

        const certPath = path.join(options.storageDir, CERT_FILENAME);
        const keyPath = path.join(options.storageDir, KEY_FILENAME);

        const existing = WebServerTLSCertificateProvider.READ_STORED(certPath, keyPath);
        if (existing) {
            return existing;
        }

        Logger.info("Generating new self-signed certificate for the HTTPS webserver");

        const generated = WebServerTLSCertificateProvider.GENERATE_SELF_SIGNED(options.hostnames);

        fs.writeFileSync(keyPath, generated.key, {mode: 0o600});
        fs.writeFileSync(certPath, generated.cert);

        Logger.info(`Stored self-signed certificate at ${certPath}`);

        return generated;
    }

    /**
     * @private
     * @param {string} certPath
     * @param {string} keyPath
     * @returns {{cert: string, key: string} | null}
     */
    static READ_STORED(certPath, keyPath) {
        if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
            return null;
        }

        try {
            const cert = fs.readFileSync(certPath, {encoding: "utf-8"});
            const key = fs.readFileSync(keyPath, {encoding: "utf-8"});
            const x509 = new crypto.X509Certificate(cert);

            if (!x509.checkPrivateKey(crypto.createPrivateKey(key))) {
                Logger.warn("Stored HTTPS certificate does not match its key. Regenerating.");

                return null;
            }

            if (new Date(x509.validTo).getTime() - Date.now() < RENEW_BEFORE_MS) {
                Logger.info("Stored HTTPS certificate has expired or is about to expire. Regenerating.");

                return null;
            }

            return {cert: cert, key: key};
        } catch (e) {
            Logger.warn("Failed to read stored HTTPS certificate. Regenerating.", e.message);

            return null;
        }
    }

    /**
     * @param {Array<string>} hostnames
     * @returns {{cert: string, key: string}}
     */
    static GENERATE_SELF_SIGNED(hostnames) {
        // Node generates the key natively. The pure-JS forge keygen blocks the event loop for a long time on armv7.
        const {privateKey, publicKey} = crypto.generateKeyPairSync("rsa", {
            modulusLength: 2048,
            publicKeyEncoding: {type: "spki", format: "pem"},
            privateKeyEncoding: {type: "pkcs8", format: "pem"}
        });

        const cert = forge.pki.createCertificate();
        const now = new Date();

        cert.publicKey = forge.pki.publicKeyFromPem(publicKey);
        cert.serialNumber = "01" + crypto.randomBytes(19).toString("hex"); // rfc5280 4.1.2.2
        cert.validity.notBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        cert.validity.notAfter = new Date(now.getTime() + VALIDITY_DAYS * 24 * 60 * 60 * 1000);

        const subject = [
            {name: "commonName", value: hostnames[0] ?? "valetudo"},
            {name: "organizationName", value: "Valetudo"}
        ];
        cert.setSubject(subject);
        cert.setIssuer(subject);

        const altNames = [...new Set(hostnames)].map(name => {
            return net.isIP(name) ? {type: 7, ip: name} : {type: 2, value: name};
        });

        cert.setExtensions([
            {name: "basicConstraints", cA: false},
            {name: "keyUsage", digitalSignature: true, keyEncipherment: true},
            {name: "extKeyUsage", serverAuth: true},
            {name: "subjectAltName", altNames: altNames}
        ]);

        cert.sign(forge.pki.privateKeyFromPem(privateKey), forge.md.sha256.create());

        return {
            cert: forge.pki.certificateToPem(cert),
            key: privateKey
        };
    }

    /**
     * @returns {Array<string>}
     */
    static GET_LOCAL_IP_ADDRESSES() {
        return Object.values(os.networkInterfaces()).flat().filter(iface => {
            return iface && iface.family === "IPv4";
        }).map(iface => {
            return iface.address;
        });
    }
}

module.exports = WebServerTLSCertificateProvider;
