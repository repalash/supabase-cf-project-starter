export async function discordNotify(content: string, files?: File[], webhookPath?: string) {
	const webhook = "https://discord.com/api/webhooks/" + (webhookPath||'1257290206839705661/P8TTI1HUu0SX7B_2EL1tjV414r5kuwjI2QuzXSJ08oQTKJPAZU2o-qlTuIkRe0pGzuwa')
	let init = {
		method: 'POST',
	} as RequestInit
	if (!files) init = {
		...init,
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({content: content})
	}
	else {
		const form = new FormData()
		// form.append('payload_json', new Blob([JSON.stringify({content: content})], {type: 'application/json'}))
		form.append('content', content)
		files.forEach((file, index) => {
			form.append(`files[${index}]`, file, file.name)
		})
		init = {
			...init,
			// DO NOT pass headers here as it overrides the boundary https://stackoverflow.com/questions/35192841/how-do-i-post-with-multipart-form-data-using-fetch#comment91367674_40714217
			// headers: {
			//     'Content-Type': 'multipart/form-data',
			// },
			body: form
		}
	}
	const res = await fetch(webhook, init).catch((err) => ({ok: false, statusText: err.message}))
	if (!res.ok) console.error('Failed to call discord webhook', res.statusText)
	return res.ok
}
