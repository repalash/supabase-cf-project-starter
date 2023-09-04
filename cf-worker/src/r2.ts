import { response404 } from './responses';

export class R2Wrapper{
	constructor(public readonly bucket: R2Bucket){ //env.USER_ASSETS_BUCKET_1
	}

	async get(assetKey: string){
		// const range = parseRange(request.headers.get("range"));
		const objectGet = await this.bucket.get(assetKey/*, {range}*/);
		if (!objectGet) {
			return response404()
		}
		const headers = new Headers();
		objectGet.writeHttpMetadata(headers);
		headers.set('etag', objectGet.httpEtag);
		// if (range) {headers.set("content-range", `bytes ${range.offset}-${range.end}/${objectGet.size}`);}
		const status = (objectGet as R2ObjectBody).body ? (/*range ? 206 :*/ 200) : 304;
		const res = new Response((objectGet as R2ObjectBody).body, {
			headers,
			status
		});
		return res;
	}
	async delete(assetKey: string) {
		if(!assetKey || !assetKey.length) return;
		await this.bucket.delete(assetKey);
	}

	async put(assetKey: string, request: Request) {
		const objectPut = await this.bucket.put(assetKey, request.body, {
			httpMetadata: {
				contentType: request.headers.get('content-type') || 'application/octet-stream',
				cacheControl: 'public, max-age=604800, s-maxage=3600, immutable',
			},
			customMetadata: {}
		});
		if (objectPut.size !== parseInt(request.headers.get('content-length') || '0')) {
			throw 'content length mismatch';
		}
	}
}
