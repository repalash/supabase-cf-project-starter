/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
import { digestMessage, handleJwtAuth } from './auth';
import { corsHeaders, handleOptions } from './cors';
import { SupabaseWrapper } from './supabase';
import { UserAssetOps } from './userAssetOps';
import { R2Wrapper } from './r2';
import { ManagedImageOps } from './managedImageOps';
import {handleCreateCheckoutSession, handleStripeWebhook} from "./stripe";

export interface Env {

	SUPABASE_JWT_SECRET: string;
	SUPABASE_URL: string;
	SUPABASE_ANON_TOKEN: string;

	USER_ASSET_BASE_URL_1: string;

	USER_ASSET_MAX_SIZE: string;
	POSTER_ASSET_MAX_SIZE: string;
	USER_ASSETS_BUCKET_1: R2Bucket;

	STRIPE_SECRET_KEY: string
	STRIPE_WEBHOOK_SECRET: string
	STRIPE_DOMAIN_VERIFY: string

	// STRIPE_prod_something: string
	[k: `STRIPE_prod_${string}`]: string

	// Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
	// MY_KV_NAMESPACE: KVNamespace;
	//
	// Example binding to Durable Object. Learn more at https://developers.cloudflare.com/workers/runtime-apis/durable-objects/
	// MY_DURABLE_OBJECT: DurableObjectNamespace;
	//
	// Example binding to R2. Learn more at https://developers.cloudflare.com/workers/runtime-apis/r2/
	// MY_BUCKET: R2Bucket;
	//
	// Example binding to a Service. Learn more at https://developers.cloudflare.com/workers/runtime-apis/service-bindings/
	// MY_SERVICE: Fetcher;
	//
	// Example binding to a Queue. Learn more at https://developers.cloudflare.com/queues/javascript-apis/
	// MY_QUEUE: Queue;
}

export function fixPath(path: string){
	return path.replace(/\/$/, '').replace(/^\//, '').replace(/^\.\./, '')
}
export function getAssetType(url: URL, request: Request){
	return url.searchParams.get('type') || request.headers.get('content-type') || 'application/octet-stream';
}

async function handleRequest_(request: Request, env: Env) {
	const url = new URL(request.url);
	const path = url.pathname;
	const method = request.method;

	const db = new SupabaseWrapper(env, request);

	let response: Response | undefined = undefined;
	if (path.startsWith('/rest/') || path.startsWith('/auth/')) {

		response = await db.proxy(url);

	} else if (path.startsWith('/api/')) {

		const pathE = path.split('/');
		const version = pathE[2];

		if (version === 'v1') {
			const action = pathE[3];
			const uid = await handleJwtAuth(request, env.SUPABASE_JWT_SECRET);

			const r2 = new R2Wrapper(env.USER_ASSETS_BUCKET_1)

			if (action === 'user_asset') {
				const assetPath = fixPath(pathE.slice(4).join('/')).replace(/^\./, '');
				const uaOps = new UserAssetOps(r2, env, request, db, uid, assetPath);

				response =
					method === 'PUT' ? await uaOps.create(url.searchParams.get('type'), url.searchParams.get('project_id')||null) :
					method === 'DELETE' ? await uaOps.delete() :
					method === 'GET' ? await uaOps.get() :
					method === 'POST' ? await uaOps.update() :
					response;

			} else if (action === 'image' || action === 'poster') {
				const assetPath = fixPath(pathE.slice(4).join('/'));
				const imageOps = new ManagedImageOps(r2, env, request, db, assetPath);

				response =
					method === 'PUT' || method === 'POST' ? await imageOps.update(uid) :
					method === 'DELETE' ? await imageOps.delete() :
					method === 'GET' ? await imageOps.get() :
					response;
			}
		}

	} else if (path.startsWith('/payments/')) {

		const pathE = path.split('/');
		const webhook = pathE[2];

		// no auth since stripe will call and signature verification is done inside the handler
		// const uid = await handleJwtAuth(request, env.SUPABASE_JWT_SECRET);

		if (webhook === 'stripe_webhook_nc7dhaug1ff') {
			response = await handleStripeWebhook(request, env);
		}

	} else if (path.startsWith('/billing/')) {

		const pathE = path.split('/');
		const endpoint = pathE[2];

		const uid = await handleJwtAuth(request, env.SUPABASE_JWT_SECRET);

		if (endpoint === 'checkout' && method === 'POST') {
			response = await handleCreateCheckoutSession(request, env, uid);
		}
	}
	return response;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		if (request.method === "OPTIONS") {
			// Handle CORS preflight requests
			return handleOptions(request);
		}

		// Sample URL: http://localhost:8787/rest/v1/table?select=*&limit=1 - proxy to supabase
		// Sample URL: http://localhost:8787/api/v1/user_asset/<asset_path> - to r2 bucket + supabase (PUT, DELETE, GET) - auth required
		// Sample URL: http://localhost:8787/api/v1/(poster|image)/<asset_path> - to r2 bucket + supabase (PUT, DELETE, GET) - auth required
		// Sample URL: http://localhost:8787/api/v1/(poster|image)/.projects/<project_id> - to r2 bucket + supabase (PUT, DELETE, GET) - auth required
		// Sample URL: http://localhost:8787/api/v1/(poster|image)/.profiles/<user_id> - to r2 bucket + supabase (PUT, DELETE, GET) - auth required

		try{

			let response = await handleRequest_(request, env);

			if(!response) return new Response('Bad Request', { status: 400, headers: { 'Content-Type': 'text/plain', ...corsHeaders } });

			response = new Response(response.body, response);

			Object.entries(corsHeaders).forEach(([key, value]) => {
				response?.headers.set(key, value);
			})

			return response;

		}catch(e){
			console.error(e)
			return new Response(JSON.stringify({error: e}), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
		}

	}
}

