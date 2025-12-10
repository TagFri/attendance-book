/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const { setGlobalOptions } = require("firebase-functions");
const { onRequest } = require("firebase-functions/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

// Init Admin SDK (Firestore, Auth osv.)
if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// good default for most apps, but for higher throughput (for example,
// handling a large number of online users or complex, long-running tasks),
// you can increase the number of max instances allocated for your function.
// Visit https://firebase.google.com/docs/functions/manage-functions#set_max_instances
// to learn more about this configuration and other scaling options.
setGlobalOptions({ maxInstances: 10 });

// En enkel test-funksjon (valgfri)
exports.helloWorld = onRequest((request, response) => {
    logger.info("Hello from attendance-app functions!", { structuredData: true });
    response.send("Hello from Firebase Functions!");
});

// 👇 Du kan legge til flere Cloud Functions her senere
// For eksempel HTTPS-funksjoner, Firestore-triggere osv.
// Men vi har BEVISST ikke noen auth.onUpdate-trigger her,
// fordi det ikke støttes og ga deg feil.