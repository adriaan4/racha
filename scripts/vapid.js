// Genera claves VAPID (opcional). Si no las pones en el entorno, el servidor
// crea unas automáticamente y las guarda en la base de datos.
const crypto = require('crypto');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pub = publicKey.export({ format: 'jwk' });
const priv = privateKey.export({ format: 'jwk' });

const b64 = (s) => s; // las JWK ya vienen en base64url
const publicRaw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]);

console.log('VAPID_PUBLIC_KEY=' + publicRaw.toString('base64url'));
console.log('VAPID_PRIVATE_KEY=' + b64(priv.d));
