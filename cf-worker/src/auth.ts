import jwt from '@tsndr/cloudflare-worker-jwt';

/**
 * Verifies JWT token from the request and returns the sub. Throws error if token is invalid.
 * @param request
 * @param secret
 */
export async function handleJwtAuth(request: Request, secret: string){
	if (!request.headers.has("Authorization")) throw "bad request";
	const token = request.headers.get("Authorization")?.replace("Bearer ", "");
	if (!token) throw "bad request";
	// Verifying token
	const isValid = await jwt.verify(token, secret); // also checks for expiry
	if(!isValid) throw 'invalid token'
	const { payload } = jwt.decode(token);
	if(!payload) throw 'invalid token'
	if(payload.aud !== 'authenticated')
		throw 'invalid aud'
	// console.log(payload)
	if(!payload.sub)
		throw 'invalid sub'
	return payload.sub

}
export async function digestMessage(message: string, alg = 'SHA-1') {
	const msgUint8 = new TextEncoder().encode(message);                           // encode as (utf-8) Uint8Array
	const hashBuffer = await crypto.subtle.digest(alg, msgUint8);           // hash the message
	const hashArray = Array.from(new Uint8Array(hashBuffer));                     // convert buffer to byte array
	const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join(''); // convert bytes to hex string
	return hashHex;
}

export function createJWTToken(payload: any, secret: string) {
	return jwt.sign(payload, secret, { algorithm: "HS256" });
}
