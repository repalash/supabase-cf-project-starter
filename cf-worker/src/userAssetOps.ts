import {digestMessage} from './auth';
import {Env} from './worker';
import {SupabaseWrapper,} from './supabase';
import {R2Wrapper} from './r2';

export async function createAssetKey(uid: string, assetPath: string) {
	const createTime = Math.floor(Date.now() / 1000).toString(16);
	const randomKey = createTime + '-' + (Math.floor(Math.random() * Math.pow(2, 16))).toString(16);
	const uid_hash = await digestMessage(uid);
	 // randomKey so that we can make it immutable
	return uid_hash + '/' + randomKey + '/' + assetPath;
}

export function userAssetUrlToKey(assetUrl: string, env: Env){
	return assetUrl.replace(env.USER_ASSET_BASE_URL_1 + '/', '')
}

export function userAssetKeyToUrl(assetKey: string, env: Env){
	return env.USER_ASSET_BASE_URL_1 + '/' + assetKey;
}

export class UserAssetOps{

	constructor(
		public r2: R2Wrapper,
		public env: Env,
		public request: Request,
		public db: SupabaseWrapper,
		public uid: string,
		public assetPath: string,
	) {
	}

	private get assetSize() {
		const assetSize = parseInt(this.request.headers.get('content-length') || '0');
		if (!assetSize || assetSize <= 0) throw 'invalid asset size';
		if (assetSize > parseInt(this.env.USER_ASSET_MAX_SIZE)) throw 'asset size too large';
		return assetSize;
	}

	async create(assetType?: string|null) {
		assetType = assetType || this.request.headers.get('content-type') || 'application/octet-stream'

		const assetSize = this.assetSize;
		const assetKey = await createAssetKey(this.uid, this.assetPath);
		const assetUrl = userAssetKeyToUrl(assetKey, this.env);
		const createAssetResponse = await this.db.createUserAsset({
			asset_asset_type: assetType,
			asset_asset_url: assetUrl,
			asset_name: this.assetPath,
			asset_size: assetSize,
		});
		if (!createAssetResponse.ok) return createAssetResponse;

		// upload file to r2 bucket
		try {
			await this.r2.put(assetKey, this.request);
		} catch (e) {
			// delete asset from supabase
			const deleteAssetResponse = await this.db.deleteUserAsset({ asset_name: this.assetPath });
			if (!deleteAssetResponse.ok) {
				console.error('delete asset failed when uploading asset to r2 bucket failed', await deleteAssetResponse.text());
				throw e;
			}
			throw e
		}

		return createAssetResponse;
	}

	test = {
		create: {

		}
	}

	async update(){
		// delete from r2 and create again. update link in supabase

		const assetSize = this.assetSize;

		const asset = await this.db.getUserAsset(this.assetPath)
		if (!asset.ok) return asset;
		const oldAssetJson: any = (await asset.json() as any)[0];
		const oldAssetUrl = oldAssetJson.asset_url;
		const oldAssetKey = userAssetUrlToKey(oldAssetUrl, this.env);

		const assetKey = await createAssetKey(this.uid, this.assetPath);
		const assetUrl = userAssetKeyToUrl(assetKey, this.env);
		const updateAssetResponse = await this.db.updateUserAssetUrl({
			asset_asset_url: assetUrl,
			asset_name: this.assetPath,
			asset_size: assetSize,
		});
		if (!updateAssetResponse.ok) return updateAssetResponse;

		try{
			await this.r2.put(assetKey, this.request);
		}catch(e){
			// revert supabase
			const updateAssetResponse2 = await this.db.updateUserAssetUrl({
				asset_asset_url: oldAssetJson.asset_url,
				asset_name: oldAssetJson.name,
				asset_size: oldAssetJson.size,
			});
			if (!updateAssetResponse2.ok) {
				console.error('update asset failed when uploading asset to r2 bucket failed', await updateAssetResponse2.text());
			}
			throw e;
		}

		await this.r2.delete(oldAssetKey).catch(e=>console.error(e));

		return updateAssetResponse;
	}

	async delete() {
		const deleteAssetResponse = await this.db.deleteUserAsset({ asset_name: this.assetPath });
		if (!deleteAssetResponse.ok) return deleteAssetResponse;

		const deleteAssetJson: any = await deleteAssetResponse.json();
		const assetUrl = deleteAssetJson.asset_url;
		if(!assetUrl || !deleteAssetJson.id) return new Response('{}', { status: 200 });

		const assetKey = userAssetUrlToKey(assetUrl, this.env);
		// delete file from r2 bucket
		try {
			await this.r2.delete(assetKey);
		} catch (e) {
			console.error(e);
			// create asset again
			const createAssetResponse = await this.db.createUserAsset({
				asset_asset_type: deleteAssetJson.asset_type,
				asset_asset_url: deleteAssetJson.asset_url,
				asset_name: deleteAssetJson.name,
				asset_size: deleteAssetJson.size,
			});
			if (!createAssetResponse.ok) {
				console.error('create asset failed when deleting asset from r2 bucket failed', await createAssetResponse.text());
			}
			throw e;
		}
		return new Response('{}', { status: 200 })
	}

	async get() {
		// only for testing
		const getAssetResponse = await this.db.getUserAsset(this.assetPath);
		if (!getAssetResponse.ok) return getAssetResponse;
		const getAssetJson: any = (await getAssetResponse.json() as any)[0];
		const assetUrl = getAssetJson.asset_url;
		const assetKey = userAssetUrlToKey(assetUrl, this.env);
		// get file from r2 bucket
		try {
			return await this.r2.get(assetKey);
		} catch (e) {
			console.error(e);
			throw e;
		}
	}

}

