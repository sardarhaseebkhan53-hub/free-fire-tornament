// Generate a VAPID keypair for Web Push (dev/ops convenience — PHASE 19).
//
//   npm run push:keys
//
// Prints the two env lines to paste into the deployment. The private key is a signing
// key for push messages only: it can never read or write a wallet, but leaking it lets
// anyone send authenticated notifications to your users, so it belongs in the deploy
// secret store and nowhere else — and never in a git-tracked .env.
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
console.log('VAPID_PUBLIC_KEY=' + keys.publicKey);
console.log('VAPID_PRIVATE_KEY=' + keys.privateKey);
console.log('VAPID_SUBJECT=mailto:admin@your-domain.example');
console.log('\n# public key = what the browser sends to /api/push/subscribe (safe in the client bundle)');
console.log('# private key = server-only, signs each payload');
