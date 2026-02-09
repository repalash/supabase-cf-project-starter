import {Env} from "./worker";
import Stripe from "stripe";
import {SupabaseWrapper} from "./supabase";
import {corsHeaders} from "./cors";
import {discordNotify} from "./discordNotify";

function getItemData(subscription: Stripe.Subscription) {
	const itemData = subscription.items.data[0] || subscription.items.data['0']
	if (!itemData) {
		console.error('No item found in subscription', subscription.id)
		return null
	}
	return itemData
}
async function updateSubscription(subscription: Stripe.Subscription, c: Context) {
	const itemData = getItemData(subscription)
	if(!itemData) {
		throw new HTTPException(400, {message: 'No item found in subscription'})
	}
	const product = itemData.plan.product
	const productId = typeof product === 'string' ? product : product?.id
	// if (!productId?.startsWith('prod_')) {
	// 	console.log('Invalid product id', productId)
	// 	return Response.json({message: 'Invalid product id'}, {status: 400})
	// }

	// using lookup key
	// using lookup key (should not use lookup_key here as it can be assigned to another price, so it will be empty here.
	const lookupKey = itemData.price.lookup_key || ''

	// @ts-ignore
	const product_plan = productId ? c.env['STRIPE_'+productId] : c.env['STRIPE_'+lookupKey] // STRIPE_lookup_key = 'plan_name'
	if (!product_plan || typeof product_plan !== 'string' || !product_plan.length) {
		console.warn('Invalid product id, unable to find product by lookup key', lookupKey)
		throw new HTTPException(200, {message: 'Invalid product id, unable to find product'})
	}

	// get the customer details
	const customer1 = subscription.customer
	const customerId = typeof customer1 === 'string' ? customer1 : customer1.id
	if (!customerId) throw new HTTPException(400, {message: 'Expected string customer id, got object/null'})
	const customer = await c.stripe.customers.retrieve(customerId, {expand: ['subscriptions']})
	if (!customer.id) throw new HTTPException(400, {message: 'Unable to find customer with ID'})
	if(customer.deleted) throw new HTTPException(400, {message: 'Customer has been deleted'})
	if(!customer.email) throw new HTTPException(400, {message: 'Customer email not found'})
	const email = customer.email

	const subId = subscription.id
	const expire = subscription.current_period_end
	const supabase = new SupabaseWrapper(c.env, c.req)
	const status = subscription.status
	const isActive = status === 'active'
	// todo check for any other active subscription before expiring.
	const isExpiredOrEnded = status === 'canceled' || status === 'unpaid'

	const userSubs = customer.subscriptions?.data
	if (customer.subscriptions?.has_more) {
		// todo notify admin
	}

	const products = {
		'premium': 'prod_QMNSxgs7RnrtOT',
		'business': 'prod_RWBVrGfNRCqTIH',
	}

	const businessSubs = userSubs?.filter(sub => sub.id !== subscription.id && getItemData(sub)?.plan.product === products.business && (sub.status === 'active' || sub.status === 'trialing')) || []
	const premiumSubs = userSubs?.filter(sub => sub.id !== subscription.id && getItemData(sub)?.plan.product === products.premium && (sub.status === 'active' || sub.status === 'trialing')) || []
	const firstSub = businessSubs[0] || premiumSubs[0]
	if (firstSub) {
		// if first sub is higher than new sub, then ignore new sub and keep the subscription
		// if first sub is lower than new sub, then continue and update the subscription with new sub
		// notify admin
		const firstSubLevel = firstSub === businessSubs[0] ? 2 : 1
		const newSubLevel = product_plan === 'business' ? 2 : 1
		if(isExpiredOrEnded || firstSubLevel > newSubLevel) {
			const message = !isExpiredOrEnded ?
				'Ignoring new subscription as it is lower than existing subscription' :
				'Ignoring expired subscription as another active subscription in account'
			// console.log(message, firstSub.id, subscription.id)
			await discordNotify(`iJewel Design - MULTIPLE SUBSCRIPTIONS - ${message}`, [
				new File([JSON.stringify(subscription)], 'new_subscription.json'),
				new File([JSON.stringify([...businessSubs, ...premiumSubs])], 'existing_subscription.json'),
			])
			// return Response.json({received: true, message: "Ignored Product"}, {status: 200}) // returning 200 as we don't want to retry webhook
			throw new HTTPException(200, {message: 'Ignored Product'})
		}else{
			console.log('Ignoring old subscription as it is lower than new subscription', firstSub.id, subscription.id)
			c.ctx.waitUntil(discordNotify('iJewel Design - MULTIPLE SUBSCRIPTIONS - Ignoring old subscription as it is lower than new subscription', [
				new File([JSON.stringify(subscription)], 'new_subscription.json'),
				new File([JSON.stringify([...businessSubs, ...premiumSubs])], 'existing_subscription.json'),
			]))
		}
	}else if(!isExpiredOrEnded && businessSubs.length + premiumSubs.length > 0){
		c.ctx.waitUntil(discordNotify('iJewel Design - MULTIPLE SUBSCRIPTIONS - User has multiple subscriptions', [
			new File([JSON.stringify(subscription)], 'new_subscription.json'),
			new File([JSON.stringify([...businessSubs, ...premiumSubs])], 'existing_subscription.json'),
		]))
	}

	let result = ''
	if(isActive) {
		const res = await supabase.rpcPost('update_profile_plan', {
			user_email: email,
			user_plan: product_plan,
			user_plan_expiry: expire,
			stripe_customer_id: customerId,
		}, true)
		const resp = await res.json() as any
		// console.log('response from update_plan', JSON.stringify(resp)) // todo check for fail and return with error
		if (!res.ok || !resp?.id) {
			console.error('Failed to set plan for profile', JSON.stringify(resp))
			throw new HTTPException(500, {message: 'Failed to set plan for profile'})
		}
		result = `Updated profile (${resp.id}:${email}) to ${product_plan} till ${new Date(expire * 1000).toISOString()}`

		// Link customer if not already linked - added to update_profile_plan
		/*await supabase.rpcPost('update_user_meta_customer', {
			user_id: resp.id,
			customer_data: { provider: 'stripe', id: customerId }
		}, true)*/
	}else if(isExpiredOrEnded){
		// todo check any other active subscriptions in stripe, is if_current_plan enough?
		const res = await supabase.rpcPost('expire_profile_plan', { // todo update_user_meta_customer here?
			user_email: email,
			if_current_plan: product_plan,
		}, true)
		const resp = await res.json() as any
		// console.log('response from expire_profile_plan', JSON.stringify(resp)) // todo check for fail and return with error
		if (!res.ok || !resp?.id) {
			console.error('Failed to update profile to free plan', email, JSON.stringify(resp))
			throw new HTTPException(500, {message: 'Failed to update profile to free plan'})
		}
		result = `Expired profile (${resp.id}:${email}) from ${product_plan}`
	}else if(subscription.status === 'past_due') {
		result = `Subscription is in grace period (${email}) for ${product_plan}`
	}/*else {
		result = 'Ignoring subscription as it is not active or expired'
	}*/
	if(result.length)
		c.ctx.waitUntil(discordNotify(`iJewel Design - ${result}`, [
			// new File([JSON.stringify(subscription)], 'new_subscription.json'),
			// new File([JSON.stringify([...businessSubs, ...premiumSubs])], 'existing_subscription.json'),
		]))
	return Response.json({received: true, message: result}, {status: 200})
}

async function handleWebhookEvent(c: Context) {
	let subscription: Stripe.Subscription;
	let status: Stripe.Subscription.Status;
	let result = Response.json({received: true}, {status: 200})
	// Handle the event
	try {
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
				console.log(`created Subscription ${subscription.id} status is ${status}.`);
				result = await updateSubscription(subscription, c)
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
		
	} catch (error) {
		console.error('Error processing webhook event:', error);
		
		ctx.waitUntil(discordNotify(`iJewel Design - Error processing webhook event`, [
			new File([JSON.stringify(error)], 'error.json'),
		]))

		if(error instanceof HTTPException){
			return Response.json({message: error.message}, {status: error.status})
		}
			

		return Response.json({message: 'Error processing webhook event'}, {status: 500})
	}
	return result
}
interface Context{
	stripe: Stripe
	env: Env
	req: Request
	event: Stripe.Event
	ctx: ExecutionContext
}
export async function handleStripeWebhook(request: Request, env: Env, ctx: ExecutionContext) {
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
	return await handleWebhookEvent({stripe, env, req: request, event, ctx})
}

async function initStripeUser(supabase: SupabaseWrapper, stripe: Stripe, uid: string, formEmail?: string) {
	const res = await supabase.rpcPost('get_customer_details', { user_id: uid }, true)
	if (!res.ok) {
		console.error('Failed to get customer details', await res.text())
		return Response.json({message: 'Failed to get customer details'}, {status: 500})
	}
	const data = await res.json() as { email: string, customer: { provider: string, id: string } | null }
	const dbEmail = data.email

	if (!dbEmail) return Response.json({message: 'User email not found'}, {status: 400})
	if (formEmail && formEmail !== dbEmail) {
		console.log('Invalid email', formEmail, dbEmail)
		return Response.json({message: 'Invalid email'}, {status: 400})
	}

	let customerId = data.customer?.id

	if (!customerId) {
		const customers = await stripe.customers.list({ email: dbEmail, limit: 2 })
		const foundCustomer = customers.data[0]?.id
		if (customers.data.length > 1) console.error('SUBSCRIPTION_AUTH_STRIPE: Multiple customers found for email', dbEmail, foundCustomer)

		if (foundCustomer) {
			customerId = foundCustomer
			// Link it
			await supabase.rpcPost('update_user_meta_customer', {
				user_id: uid,
				customer_data: { provider: 'stripe', id: customerId }
			}, true)
		}
	}
	return { email: dbEmail, customerId }
}

export async function handleCreateCheckoutSession(request: Request, env: Env, uid: string) {
	// uid is required just from jwt to verify email is sent properly.
	if(!uid) throw new HTTPException(401, {message: 'Unauthorized'})

	const supabase = new SupabaseWrapper(env, request)
	const stripe = new Stripe(env.STRIPE_SECRET_KEY)

	const userResult = await initStripeUser(supabase, stripe, uid)
	if(userResult instanceof Response) {
		throw new HTTPException(userResult.status, {message: userResult.statusText})
	}
	const { email: user_email, customerId } = userResult

	const formData = await request.formData()
	const lookup_key = formData.get('lookup_key')
	const return_url = formData.get('return_url')
	if(!lookup_key || !return_url) throw new HTTPException(400, {message: 'Invalid form data'})
	if(!return_url.startsWith(env.STRIPE_DOMAIN_VERIFY)) throw new HTTPException(400, {message: 'Invalid return url'})

	const prices = await stripe.prices.list({
		lookup_keys: [lookup_key],
		expand: ['data.product'],
	});

	const customerData: Pick<Stripe.Checkout.SessionCreateParams, 'customer'|'customer_email'> = {}
	if(customerId) customerData.customer = customerId;
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
		allow_promotion_codes: true,
		mode: 'subscription',
		success_url: `${return_url}?success=true&session_id={CHECKOUT_SESSION_ID}`,
		cancel_url: `${return_url}?canceled=true`,
	}).catch(e => {
		console.error('Failed to create checkout session', e.message)
		return null
	})
	if(!session?.url)
		throw new HTTPException(500, {message: 'Failed to create session'})

	return Response.json({url: session.url}, {status: 200})
}

export async function handleCreatePortalSession(request: Request, env: Env, uid: string) {
	// uid is required just from jwt to verify email is sent properly.
	if(!uid) throw new HTTPException(401, {message: 'Unauthorized'})

	const supabase = new SupabaseWrapper(env, request)
	const stripe = new Stripe(env.STRIPE_SECRET_KEY)

	const userResult = await initStripeUser(supabase, stripe, uid)
	if(userResult instanceof Response) return userResult
	const { customerId: customer } = userResult

	if(!customer) throw new HTTPException(400, {message: 'Customer not found'})

	const formData = await request.formData()
	const return_url = formData.get('return_url')
	if(!return_url) throw new HTTPException(400, {message: 'Invalid form data'})
	if(!return_url.startsWith(env.STRIPE_DOMAIN_VERIFY)) throw new HTTPException(400, {message: 'Invalid return url'})


	const session = await stripe.billingPortal.sessions.create({
		customer,
		return_url
	}).catch(e => {
		console.error('Failed to create portal session', e.message)
		return null
	});
	if(!session?.url)
		throw new HTTPException(500, {message: 'Failed to create session'})

	// console.log('portal session', session.url)
	return Response.json({url: session.url}, {status: 200})
}
