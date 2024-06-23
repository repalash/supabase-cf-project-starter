import {Env} from "./worker";
import Stripe from "stripe";
import {SupabaseWrapper} from "./supabase";
import {corsHeaders} from "./cors";

async function updateSubscription(subscription: Stripe.Subscription, c: Context) {
	// using product id directly
	// const product = subscription.items.data[0].plan.product
	// if (typeof product !== 'string') {
	// 	// throw new HTTPException(400, {message: 'Expected product id, got object'})
	// 	return Response.json({message: 'Expected product id, got object'}, {status: 400})
	// }
	// if (!product.startsWith('prod_')) {
	// 	// throw new HTTPException(400, {message: 'Invalid product id'})
	// 	return Response.json({message: 'Invalid product id'}, {status: 400})
	// }

	// using lookup key
	const lookupKey = subscription.items.data[0].price.lookup_key || ''

	// @ts-ignore
	const product_plan = c.env['STRIPE_'+lookupKey] // STRIPE_lookup_key = 'plan_name'
	if (!product_plan?.length) {
		// throw new HTTPException(400, {message: 'Invalid product id, unable to find product'})
		console.warn('Invalid product id, unable to find product by lookup key', lookupKey)
		return Response.json({received: true, message: "Ignored Product"}, {status: 200}) // returning 200 as we don't want to retry webhook
	}
	const subId = subscription.id
	const expire = subscription.current_period_end
	const customer1 = subscription.customer
	const customerId = typeof customer1 === 'string' ? customer1 : customer1.id
	if (!customerId) return Response.json({message: 'Expected string customer id, got object/null'}, {status: 400})
	const customer = await c.stripe.customers.retrieve(customerId)
	if (!customer.id) return Response.json({message: 'Unable to find customer with ID'}, {status: 400})
	if(customer.deleted) return Response.json({message: 'Customer has been deleted'}, {status: 400})
	if(!customer.email) return Response.json({message: 'Customer email not found'}, {status: 400})
	const email = customer.email
	const supabase = new SupabaseWrapper(c.env, c.req)
	const status = subscription.status
	const isActive = status === 'active'
	const isExpiredOrEnded = !isActive && status !== 'trialing' && status !== 'incomplete'
	let result = ''
	if(isActive) {
		const res = await supabase.rpcPost('update_profile_plan', {
			user_email: email,
			user_plan: product_plan,
			user_plan_expiry: expire,
		}, true)
		const resp = await res.json() as any
		// console.log('response from update_plan', JSON.stringify(resp)) // todo check for fail and return with error
		if (!res.ok || !resp?.id) {
			// throw new HTTPException(500, {message: 'Failed to update profile'})
			console.error('Failed to set plan for profile', await res.text())
			return Response.json({message: 'Failed to set plan for profile'}, {status: 500})
		}
		result = `Updated profile (${resp.id}:${email}) to ${product_plan} till ${new Date(expire * 1000).toISOString()}`
	}else if(isExpiredOrEnded){
		// todo check any other active subscriptions in stripe, is if_current_plan enough?
		const res = await supabase.rpcPost('expire_profile_plan', {
			user_email: email,
			if_current_plan: product_plan,
		}, true)
		const resp = await res.json() as any
		// console.log('response from expire_profile_plan', JSON.stringify(resp)) // todo check for fail and return with error
		if (!res.ok || !resp?.id) {
			// throw new HTTPException(500, {message: 'Failed to update profile'})
			console.error('Failed to update profile to free plan', await res.text())
			return Response.json({message: 'Failed to update profile to free plan'}, {status: 500})
		}
		const result = `Expired profile (${resp.id}:${email}) from ${product_plan}`
	}
	return Response.json({received: true, message: result}, {status: 200})
}

async function handleWebhookEvent(c: Context) {
	let subscription: Stripe.Subscription;
	let status: Stripe.Subscription.Status;
	let result = Response.json({received: true}, {status: 200})
	// Handle the event
	switch (c.event.type) {
		case 'customer.subscription.trial_will_end':
			subscription = c.event.data.object;
			status = subscription.status;
			console.log(`[Unhandled]: trial_will_end Subscription ${subscription.id} status is ${status}`);
			// Then define and call a method to handle the subscription trial ending.
			// handleSubscriptionTrialEnding(subscription);
			break;
		case 'customer.subscription.deleted':
			subscription = c.event.data.object;
			status = subscription.status;
			console.log(`deleted Subscription ${subscription.id} status is ${status}.`);
			// deactivate the license key for subscription (inactive)
			result = await updateSubscription(subscription, c)
			break;
		case 'customer.subscription.created':
			subscription = c.event.data.object;
			status = subscription.status;
			console.log(`[Unhandled]: created Subscription ${subscription.id} status is ${status}.`);
			// do nothing
			// await updateSubscription(subscription, c.env, status, event) // todo: should we?
			break;
		case 'customer.subscription.updated':
			subscription = c.event.data.object;
			status = subscription.status;
			console.log(`updated Subscription ${subscription.id} status is ${status}.`);
			result = await updateSubscription(subscription, c)
			break;
		case 'entitlements.active_entitlement_summary.updated':
			const summary = c.event.data.object;
			console.log(`[Unhandled]: Active entitlement summary updated for ${JSON.stringify(summary)}.`);
			// Then define and call a method to handle active entitlement summary updated
			// handleEntitlementUpdated(subscription);
			break;
		default:
			// Unexpected event type
			console.log(`[Unhandled]: Unhandled event type ${c.event.type}.`);
	}
	return result
}
interface Context{
	stripe: Stripe
	env: Env
	req: Request
	event: Stripe.Event
}
export async function handleStripeWebhook(request: Request, env: Env) {
	const stripe = new Stripe(env.STRIPE_SECRET_KEY)
	if(!env.STRIPE_WEBHOOK_SECRET)
		// throw new HTTPException(500, {message: 'Invalid configuration'})
		return Response.json({message: 'Invalid configuration'}, {status: 500})

	// const signature = c.req.header('stripe-signature');
	const signature = request.headers.get('stripe-signature');
	if(!signature) return Response.json({message: 'Invalid signature'}, {status: 400})

	let event: Stripe.Event|undefined = undefined;
	try {
		// const rawBody = await c.req.text();
		const rawBody = await request.text();
		event = await stripe.webhooks.constructEventAsync(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
	} catch (err) {
		console.error(`⚠️  Webhook signature verification failed.`, (err as any)?.message);
		return Response.json({message: 'Webhook signature verification failed'}, {status: 400})
	}
	return await handleWebhookEvent({stripe, env, req: request, event})
}

export async function handleCreateCheckoutSession(request: Request, env: Env, uid: string) {
	// uid is required just from jwt to verify email is sent properly.
	if(!uid) return new Response('Unauthorized', { status: 401, headers: { 'Content-Type': 'text/plain', ...corsHeaders } });

	const supabase = new SupabaseWrapper(env, request)
	const uidEmail = await supabase.rpcPost('get_email_for_uid', {user_id: uid}, true)
	const email1 = uidEmail.ok ? (await uidEmail.text()) : ''
	if(!uidEmail.ok) console.log('failed to get email for uid', uid, email1, await uidEmail.text()) // todo remove later.
	console.log('got email from db for uid', email1) // todo remove later.

	const stripe = new Stripe(env.STRIPE_SECRET_KEY)
	const formData = await request.formData()
	const user_email = formData.get('email') // we don-t really need this from frontend

	if(!user_email || !email1 || ("\""+user_email+"\"") !== email1) {
		console.log('Invalid email', user_email, email1)
		return Response.json({message: 'Invalid email'}, {status: 400})
	}

	const lookup_key = formData.get('lookup_key')
	const return_url = formData.get('return_url')
	if(!user_email || !lookup_key || !return_url) return Response.json({message: 'Invalid form data'}, {status: 400})
	if(!return_url.startsWith(env.STRIPE_DOMAIN_VERIFY)) return Response.json({message: 'Invalid return url'}, {status: 400})

	const prices = await stripe.prices.list({
		lookup_keys: [lookup_key],
		expand: ['data.product'],
	});

	// get existing customer, this is required because stipe can create multiple customers for an email.
	const customers = await stripe.customers.list({email: user_email, limit: 2})
	const customer = customers.data[0]?.id
	if(customers.data.length > 1) console.error('SUBSCRIPTION_AUTH_STRIPE: Multiple customers found for email', user_email, customer)
	const customerData: Pick<Stripe.Checkout.SessionCreateParams, 'customer'|'customer_email'> = {}
	if(customer) customerData.customer = customer;
	else customerData.customer_email = user_email;

	const session = await stripe.checkout.sessions.create({
		billing_address_collection: 'auto',
		line_items: [
			{
				price: prices.data[0].id,
				quantity: 1,
			},
		],
		...customerData,
		mode: 'subscription',
		success_url: `${return_url}?success=true&session_id={CHECKOUT_SESSION_ID}`,
		cancel_url: `${return_url}?canceled=true`,
	});
	if(!session.url)
		// throw new HTTPException(500, {message: 'Failed to create session'})
		return Response.json({message: 'Failed to create session'}, {status: 500})

	console.log(session.url)
	return Response.json({url: session.url}, {status: 200})
}
