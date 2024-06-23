import { Env } from './worker';
import { createJWTToken } from './auth';

export class SupabaseWrapper{
	constructor(public readonly env: Env, public request: Request){}
	async proxy(url: URL) {
		// Proxy to Supabase
		const headers = new Headers(this.request.headers);
		headers.set('apikey', this.env.SUPABASE_ANON_TOKEN)
		const auth = headers.get('Authorization')
		if(!auth || auth.trim()=== 'Bearer' || auth === 'Bearer 0') headers.set('Authorization', 'Bearer ' + this.env.SUPABASE_ANON_TOKEN)
		const res = await fetch(this.request.url.replace(url.origin, this.env.SUPABASE_URL), {
			body: this.request.body,
			headers,
			method: this.request.method
		});
		return res as any as Response;
	}

	async authHeaders(cType = '', admin = false){
		let token = !admin ? this.request.headers.get('Authorization') || '' : '';
		if(admin){
			const serviceRolePayload = {
				"iss": "cf-worker",
				"role": "service_role",
				"iat": Math.floor(Date.now() / 1000),
				"exp": Math.floor(Date.now() / 1000) + 60 * 60,
			}
			token = 'Bearer ' + await createJWTToken(serviceRolePayload, this.env.SUPABASE_JWT_SECRET);
		}
		if(token.trim() === 'Bearer' || token === 'Bearer 0') token = 'Bearer ' + this.env.SUPABASE_ANON_TOKEN
		const headers: any = {
			'Authorization': token,
			'apikey': this.env.SUPABASE_ANON_TOKEN
		}
		if(cType && cType.length) headers['Content-Type'] = cType;
		return headers;
	}

	async rpcPost(name: string, ops: any, admin = false) {
		const url = this.env.SUPABASE_URL + '/rest/v1/rpc/' + name;
		const res = await fetch(url, {
			method: 'POST',
			headers: await this.authHeaders('application/json', admin),
			body: JSON.stringify(ops)
		});
		return res as any as Response;
	}

	async restGet(query: string){
		const url = this.env.SUPABASE_URL + '/rest/v1/' + query;
		const res = await fetch(url, {
			method: 'GET',
			headers: await this.authHeaders()
		})
		return res as any as Response;
	}

	async getUserAsset(assetPath: string){
		return this.restGet('user_assets?select=*&name=eq.' + assetPath);
	}

	async getProject(project_id: string){
		return this.restGet('projects?select=*&id=eq.' + project_id)
	}

	async getProfile(profile_id: string,){
		return this.restGet('profiles?select=*&id=eq.' + profile_id)
	}

	async updateProject(ops: {
		project_id: string,
		project_name?: string,
		project_description?: string,
		project_slug?: string,
		project_is_private?: boolean,
		project_is_template?: boolean,
		project_tags?: string[],
		project_project_data?: any,
		project_poster_url?: string
	}) {
		return this.rpcPost('update_project', ops);
	}

	async updateProfile(ops: {
		user_full_name?: string,
		user_username?: string,
		user_website?: string,
		user_avatar_url?: string,
		user_bio?: string,
	}) {
		return this.rpcPost('update_profile', ops);
	}

	async updateUserAsset(ops: {
		asset_name: string,
		asset_asset_type?: string,
		asset_asset_data?: any,
		asset_is_private?: boolean,
		asset_is_resource?: boolean,
		asset_poster_url?: string,
	}) {
		return await this.rpcPost('update_user_asset', ops);
	}

	async updateUserAssetUrl(ops: {
		asset_asset_url: string,
		asset_name: string,
		asset_size: number,
	}) {
		return this.rpcPost('update_user_asset_url', ops, true);
	}

	async createUserAsset(ops: {
		asset_asset_type: string,
		asset_asset_url: string,
		asset_name: string,
		asset_size: number,
		asset_project_id?: string,
	}){
		return await this.rpcPost('create_user_asset', {
			'asset_is_private': true,
			'asset_is_resource': false,
			...ops,
			// "asset_poster_url": "value",
			// "asset_asset_data": {},
		});
	}

	async deleteUserAsset(ops: {asset_name: string}) {
		return this.rpcPost('delete_user_asset', ops, true);
	}

}

