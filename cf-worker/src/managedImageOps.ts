import { Env } from './worker';
import { SupabaseWrapper } from './supabase';
import {createAssetKey, userAssetKeyToUrl, userAssetUrlToKey} from './userAssetOps';
import { R2Wrapper } from './r2';

const allowedImageTypes = [['image/jpeg', 'jpeg'], ['image/png', 'png'], ['image/jpg', 'jpeg'], ['image/webp', 'webp'], ];

interface TAsset {isProject: boolean, assetId: string, assetUrl: string, isProfile: boolean}

export class ManagedImageOps{
	constructor(
		public r2: R2Wrapper,
		public env: Env,
		public request: Request,
		public db: SupabaseWrapper,
		public assetPath: string,
	){}


	private async updateProject({isProject, isProfile, assetId, assetUrl}:TAsset) {
		let updateAssetResponse =
			isProject ? await this.db.updateProject({project_id: assetId, project_poster_url: assetUrl}) :
				isProfile ? await this.db.updateProfile({profile_id: assetId, user_avatar_url: assetUrl}) :
					await this.db.updateUserAsset({asset_name: assetId, asset_poster_url: assetUrl});
		return updateAssetResponse;
	}
	private async getAssetJSON(): Promise<TAsset> {
		const isProject = this.assetPath.startsWith('.projects/');
		const isProfile = this.assetPath.startsWith('.profiles/');

		const assetId = (isProject || isProfile) ? this.assetPath.split('/')[1] : this.assetPath;

		const asset =
			isProject ? await this.db.getProject(assetId) :
				isProfile ? await this.db.getProfile(assetId) :
					await this.db.getUserAsset(assetId);

		if (!asset.ok) throw 'asset/project/profile not found';
		const js = await asset.json() as any;
		if (!js.length) throw 'asset/project/profile not found';
		const assetJson: any = (js)[0];
		if (!assetJson.id) throw 'asset/project/profile id not found';
		if(assetJson.id !== assetId) throw 'asset/project/profile id mismatch';

		const assetUrl = (isProfile ? assetJson.avatar_url : assetJson.poster_url) || '';

		return { isProject, isProfile, assetId, assetUrl };
	}

	async update(uid: string){
		const asset = await this.getAssetJSON();

		const posterSize = parseInt(this.request.headers.get('content-length') || '0');
		const posterType = this.request.headers.get('content-type')?.toLowerCase().trim() || 'application/octet-stream';
		if (!posterSize || posterSize <= 0) throw 'invalid poster size';
		const extension = allowedImageTypes.find(p=>p[0]===posterType)?.[1]
		if(!extension) throw 'invalid poster type';
		if(posterSize > parseInt(this.env.POSTER_ASSET_MAX_SIZE)) throw 'poster size too large';

		const assetKey = await createAssetKey(uid, this.assetPath)+'.poster.'+extension;
		const assetUrl = userAssetKeyToUrl(assetKey, this.env);
		let updateAssetResponse = await this.updateProject({...asset, assetUrl});
		if (!updateAssetResponse.ok) {
			// todo - handle error, set headers etc
			return updateAssetResponse;
		}

		try{
			await this.r2.put(assetKey, this.request);
		}catch(e){
			// revert supabase
			let updateAssetResponse2 = await this.updateProject(asset);
			if (!updateAssetResponse2.ok) {
				// todo - handle error, set headers etc
				console.error('update asset poster url failed when uploading asset to r2 bucket failed', await updateAssetResponse2.text());
			}
			throw e;
		}

		if(!!asset.assetUrl) await this.r2.delete(asset.assetUrl).catch(e=>console.error(e));

		return updateAssetResponse;
	}

	async delete(){
		const asset = await this.getAssetJSON();
		let updateAssetResponse = await this.updateProject({...asset, assetUrl: ''});
		if (!updateAssetResponse.ok) {
			// todo - handle error, set headers etc
			return updateAssetResponse;
		}

		try{
			await this.r2.delete(asset.assetUrl);
		}catch(e){
			// revert supabase
			const updateAssetResponse2 = await this.updateProject(asset);
			if (!updateAssetResponse2.ok) {
				// todo - handle error, set headers etc
				console.error('update asset poster url failed when deleting asset from r2 bucket failed', await updateAssetResponse2.text());
			}
			throw e;
		}

		return updateAssetResponse;
	}

	async get(){
		const { assetUrl } = await this.getAssetJSON();
		if(!assetUrl) throw 'asset poster url not found';

		const assetKey = userAssetUrlToKey(assetUrl, this.env);

		// get file from r2 bucket
		return await this.r2.get(assetKey);

	}


}
